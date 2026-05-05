// src/lib/pipeline/orchestrator.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { analyzeReferenceFace } from "./face-analysis";
import { orchestratePrompts } from "./orchestrate";
import { compositeKeyframe } from "./keyframe";
import { inferFramingScope } from "./framing";
import { judgeKeyframe } from "./judge";
import { generateVideoFromKeyframe } from "./kling";
import { generateMultiShotViaSeedance } from "./seedance";
import { concatClips } from "./concat";
import { generateMasterSubjectReference } from "./master-subject";
import { updateRun, getRun } from "./run-store";
import { uploadToBlob } from "./upload";
import type {
  TemplateAsset,
  ProductAsset,
  TemplateMetadata,
  ProductMetadata,
  Look,
} from "./types";

const VERCEL_DEPLOYMENT_URL =
  process.env.VERCEL_DEPLOYMENT_URL ?? "https://ai-campaign-video.vercel.app";

const USE_MOTION_CONTROL = () => process.env.KLING_USE_MOTION_CONTROL === "true";

// ---------------------------------------------------------------------------
// Feature flag — when true, Seedance handles multi-shot generation natively
// (one API call for all looks) instead of the per-look Kling loop.
// ---------------------------------------------------------------------------
const USE_SEEDANCE = () => process.env.USE_SEEDANCE === "true";

// ---------------------------------------------------------------------------
// Feature flag — when true, stop after keyframe generation and skip Kling
// motion-control calls and the final concat. Useful for testing image quality
// without burning Kling credits.
// ---------------------------------------------------------------------------
const SKIP_KLING = () => process.env.SKIP_KLING === "true";

function loadTemplate(template_id: string): TemplateAsset {
  const dir = resolve("public/templates", template_id);
  const metadata = JSON.parse(
    readFileSync(join(dir, "metadata.json"), "utf-8"),
  ) as TemplateMetadata;
  return {
    id: template_id,
    title: template_id,
    description: "",
    video_path: `templates/${template_id}/video.mp4`,
    first_frame_path: `templates/${template_id}/first_frame.png`,
    metadata,
  };
}

function loadProduct(product_id: string): ProductAsset {
  const dir = resolve("public/products", product_id);
  const metadata = JSON.parse(
    readFileSync(join(dir, "metadata.json"), "utf-8"),
  ) as ProductMetadata;
  return {
    id: product_id,
    name: product_id,
    description: "",
    image_path: `products/${product_id}/image.png`,
    metadata,
  };
}

function loadSourcePrompt(template_id: string): string | null {
  const p = resolve("public/templates", template_id, "source_prompt.txt");
  if (!existsSync(p)) return null;
  const content = readFileSync(p, "utf-8").trim();
  return content || null;
}

function buildProductDescription(p: ProductAsset): string {
  const filtered = p.metadata.items
    .filter((it) => it.attachment_strategy !== "placed_on_surface")
    .map((it) => it.visual_description)
    .join("; ");
  return filtered || p.metadata.overall_description;
}

async function processLook(args: {
  run_id: string;
  look_index: number;
  total_looks: number;
  template: TemplateAsset;
  templateFirstFrame: Buffer;
  face_metadata: Awaited<ReturnType<typeof analyzeReferenceFace>>;
  faceDescription: string;
  referenceFaceBytes: Buffer;
  referenceFaceMimeType: string;
  look: Look;
  runDir: string;
}): Promise<{ keyframePath: string; clipPath: string | null; keyframe_url: string; clip_url: string | null }> {
  const products = args.look.product_ids.map(loadProduct);
  const framingScope = inferFramingScope(products.map((p) => p.metadata));
  console.log(`[orchestrator] look ${args.look_index} framing_scope: ${framingScope}`);

  const backgrounds = args.template.metadata.shot_backgrounds && args.template.metadata.shot_backgrounds.length > 0
    ? args.template.metadata.shot_backgrounds
    : ["clean neutral solid backdrop"];
  const backgroundForLook = backgrounds[args.look_index % backgrounds.length];
  console.log(`[orchestrator] look ${args.look_index} background: ${backgroundForLook.slice(0, 80)}`);

  // Per-look motion-script slice — only the entries that fall within this
  // segment's time window (so Gemini's motion_prompt is shot-specific).
  const SEGMENT_COUNT = 4;
  const segmentIdx = args.look_index % SEGMENT_COUNT;
  const totalDuration = args.template.metadata.motion_script.at(-1)?.t_end ?? 1;
  const segDur = totalDuration / SEGMENT_COUNT;
  const segStart = segmentIdx * segDur;
  const segEnd = (segmentIdx + 1) * segDur;
  const motionScriptForLook = args.template.metadata.motion_script.filter(
    (e) => e.t_end > segStart && e.t_start < segEnd,
  );

  // Stage 4 — orchestrate prompts for THIS look
  updateRun(args.run_id, {
    status: "orchestrating",
    progress_label: `Composing look ${args.look_index + 1} of ${args.total_looks}…`,
    current_look_index: args.look_index,
  });
  const prompts = await orchestratePrompts({
    template: args.template.metadata,
    products: products.map((p) => p.metadata),
    face: args.face_metadata,
    options: {
      look_index: args.look_index,
      total_looks: args.total_looks,
      framing_scope: framingScope,
      background_for_look: backgroundForLook,
      motion_script_for_this_look: motionScriptForLook,
    },
  });

  // Override motion_prompt with source_prompt.txt if present (Higgsfield-generated prompt)
  const sourcePrompt = loadSourcePrompt(args.template.id);
  if (sourcePrompt) {
    console.log(`[orchestrator] using source_prompt.txt for ${args.template.id} — overriding motion_prompt`);
    prompts.motion_prompt = sourcePrompt;
  }

  // Stage 5 — keyframe
  updateRun(args.run_id, {
    status: "compositing_keyframe",
    progress_label: `Placing products for look ${args.look_index + 1} of ${args.total_looks}…`,
    current_look_index: args.look_index,
  });

  const productImages = products.map((p) => ({
    bytes: readFileSync(resolve("public", p.image_path)),
    mimeType: "image/png" as const,
    description: buildProductDescription(p),
  }));

  let keyframe = await compositeKeyframe({
    keyframePrompt: prompts.keyframe_prompt,
    templateFirstFrame: { bytes: args.templateFirstFrame, mimeType: "image/png" },
    referenceFace: { bytes: args.referenceFaceBytes, mimeType: args.referenceFaceMimeType },
    products: productImages,
    faceDescription: args.faceDescription,
    framingScope,
    backgroundDescription: backgroundForLook,
  });

  // Stage 5b — judge with one retry
  const judgement = await judgeKeyframe({
    keyframe: { bytes: keyframe.imageBytes, mimeType: keyframe.mimeType },
    referenceFace: { bytes: args.referenceFaceBytes, mimeType: args.referenceFaceMimeType },
    products: productImages.map((p) => ({ bytes: p.bytes, mimeType: p.mimeType })),
  });

  if (
    !judgement.identity_preserved ||
    !judgement.all_products_present ||
    !judgement.products_correctly_placed
  ) {
    console.warn(
      `[orchestrator] look ${args.look_index} judge flagged issues, retrying once:`,
      judgement.issues,
    );
    const retryPrompt = `${prompts.keyframe_prompt}

CORRECTIONS based on the previous attempt — fix these issues explicitly:
${judgement.issues.map((i) => `- ${i}`).join("\n")}`;
    keyframe = await compositeKeyframe({
      keyframePrompt: retryPrompt,
      templateFirstFrame: { bytes: args.templateFirstFrame, mimeType: "image/png" },
      referenceFace: { bytes: args.referenceFaceBytes, mimeType: args.referenceFaceMimeType },
      products: productImages,
      faceDescription: args.faceDescription,
      framingScope,
      backgroundDescription: backgroundForLook,
    });
  }

  const keyframePath = join(args.runDir, `keyframe-${args.look_index}.png`);
  writeFileSync(keyframePath, keyframe.imageBytes);
  const keyframe_url = `/runs/${args.run_id}/keyframe-${args.look_index}.png`;

  // SKIP_KLING early exit — return without calling Kling; clipPath is null
  if (SKIP_KLING()) {
    console.log(`[orchestrator] SKIP_KLING=true — keyframe ${args.look_index} saved, skipping Kling`);
    return { keyframePath, clipPath: null, keyframe_url, clip_url: null };
  }

  // Stage 6 — Kling
  updateRun(args.run_id, {
    status: "generating_video",
    progress_label: `Rendering motion for look ${args.look_index + 1} of ${args.total_looks}…`,
    current_look_index: args.look_index,
  });

  const archetypes =
    args.template.metadata.pose_archetypes &&
    args.template.metadata.pose_archetypes.length > 0
      ? args.template.metadata.pose_archetypes
      : ["confident"];
  const poseArchetype = archetypes[args.look_index % archetypes.length];
  const motionReferenceVideoPath = resolve("public", args.template.video_path);

  // Per-look segment URL — use segment-{segmentIdx}.mp4 instead of full video.
  // Kling motion-control requires reference video >= 3s; fall back to full video
  // if the computed segment duration is too short.
  const KLING_MIN_SEGMENT_DURATION_S = 3;
  const segmentPath = args.template.video_path.replace("/video.mp4", "") + `/segment-${segmentIdx}.mp4`;
  const usePerLookSegment = segDur >= KLING_MIN_SEGMENT_DURATION_S;
  const perLookSegmentUrl = usePerLookSegment
    ? `${VERCEL_DEPLOYMENT_URL}/${segmentPath}`
    : `${VERCEL_DEPLOYMENT_URL}/${args.template.video_path}`;
  if (usePerLookSegment) {
    console.log(`[orchestrator] look ${args.look_index} motion segment: segment-${segmentIdx}.mp4 (${segDur.toFixed(1)}s) → ${perLookSegmentUrl}`);
  } else {
    console.log(`[orchestrator] look ${args.look_index} segment too short (${segDur.toFixed(1)}s < ${KLING_MIN_SEGMENT_DURATION_S}s) — using full video as motion reference`);
  }

  let keyframeUrl: string | undefined;
  let motionReferenceUrl: string | undefined;

  if (USE_MOTION_CONTROL()) {
    // Use the per-look segment as the motion reference instead of the full video
    motionReferenceUrl = perLookSegmentUrl;

    // Upload this look's keyframe to Vercel Blob, get a public URL
    try {
      keyframeUrl = await uploadToBlob(
        `keyframes/${args.run_id}/look-${args.look_index}.png`,
        keyframe.imageBytes,
        keyframe.mimeType,
      );
      console.log(
        `[orchestrator] uploaded keyframe ${args.look_index} to blob: ${keyframeUrl}`,
      );
    } catch (err) {
      console.warn(
        `[orchestrator] keyframe upload failed for look ${args.look_index}, falling back to image-to-video:`,
        (err as Error).message,
      );
      keyframeUrl = undefined;
      motionReferenceUrl = undefined;
    }
  }

  const video = await generateVideoFromKeyframe({
    keyframeBytes: keyframe.imageBytes,
    keyframeMimeType: keyframe.mimeType,
    motionPrompt: prompts.motion_prompt,
    negativePrompt: prompts.negative_prompt,
    durationSeconds: 5,
    aspectRatio: "9:16",
    poseArchetype,                 // drives camera_control (Path 1)
    motionReferenceVideoPath,      // reference video for Motion Control (Path 2, legacy fallback)
    keyframeUrl,                   // HTTPS URL for motion control (Path 2)
    motionReferenceUrl,            // HTTPS URL for motion control (Path 2)
  });

  const clipPath = join(args.runDir, `clip-${args.look_index}.mp4`);
  writeFileSync(clipPath, video.videoBytes);
  const clip_url = `/runs/${args.run_id}/clip-${args.look_index}.mp4`;

  return { keyframePath, clipPath, keyframe_url, clip_url };
}

export async function runPipeline(
  run_id: string,
  input: { referenceFaceBytes: Buffer; referenceFaceMimeType: string },
) {
  try {
    const run = getRun(run_id);
    if (!run) throw new Error(`unknown run_id ${run_id}`);
    if (!run.looks || run.looks.length === 0) throw new Error("no looks in run");

    const template = loadTemplate(run.template_id);
    const runDir = resolve("public/runs", run_id);
    mkdirSync(runDir, { recursive: true });

    // Stage 3 — face analysis (once)
    updateRun(run_id, { status: "analyzing_face", total_looks: run.looks.length, current_look_index: 0 });
    const face = await analyzeReferenceFace({
      imageBytes: input.referenceFaceBytes,
      mimeType: input.referenceFaceMimeType,
    });

    const faceDescription = [
      face.perceived_gender,
      face.age_range,
      face.skin_tone + " skin",
      face.hair,
      face.distinctive_features,
      face.ethnicity_cues,
    ].filter(Boolean).join(", ");

    const templateFirstFrame = readFileSync(resolve("public", template.first_frame_path));

    // -----------------------------------------------------------------------
    // Master subject reference — generate once, use as identity anchor for
    // every per-look keyframe to eliminate cross-shot identity drift.
    // -----------------------------------------------------------------------
    updateRun(run_id, {
      status: "analyzing_face",
      progress_label: "Generating master subject reference for identity consistency…",
    });
    console.log("[orchestrator] generating master subject reference for identity anchor...");
    const master = await generateMasterSubjectReference({
      faceImageBytes: input.referenceFaceBytes,
      faceImageMimeType: input.referenceFaceMimeType,
      faceMetadata: face,
    });

    let anchorFaceBytes = input.referenceFaceBytes;
    let anchorFaceMimeType = input.referenceFaceMimeType;
    if (master) {
      const masterPath = join(runDir, "master-subject.png");
      writeFileSync(masterPath, master.imageBytes);
      anchorFaceBytes = master.imageBytes;
      anchorFaceMimeType = master.mimeType;
      console.log(`[orchestrator] master subject saved (${master.imageBytes.length} bytes) — using as identity anchor for all looks`);
    } else {
      console.warn("[orchestrator] master subject generation failed — falling back to original reference photo");
    }

    // -----------------------------------------------------------------------
    // SEEDANCE PATH — single multi-shot call for all looks
    // -----------------------------------------------------------------------
    if (USE_SEEDANCE()) {
      console.log("[orchestrator] USE_SEEDANCE=true — using Seedance 2.0 multi-shot path");

      // Build the reference video URL (template served from Vercel deployment)
      const motionReferenceUrl = `${VERCEL_DEPLOYMENT_URL}/${template.video_path}`;

      // Generate keyframes for every look and upload them to Blob
      const keyframeUrls: string[] = [];
      const blobKeyframeUrls: string[] = [];
      // Capture the first look's motion prompt to drive the Seedance call
      let seedanceMotionPrompt = "";
      let seedanceNegativePrompt = "";

      for (let i = 0; i < run.looks.length; i++) {
        updateRun(run_id, {
          status: "compositing_keyframe",
          progress_label: `Placing products for look ${i + 1} of ${run.looks.length}…`,
          current_look_index: i,
        });

        const products = run.looks[i].product_ids.map(loadProduct);
        const framingScope = inferFramingScope(products.map((p) => p.metadata));
        const backgrounds =
          template.metadata.shot_backgrounds &&
          template.metadata.shot_backgrounds.length > 0
            ? template.metadata.shot_backgrounds
            : ["clean neutral solid backdrop"];
        const backgroundForLook = backgrounds[i % backgrounds.length];

        const prompts = await orchestratePrompts({
          template: template.metadata,
          products: products.map((p) => p.metadata),
          face,
          options: {
            look_index: i,
            total_looks: run.looks.length,
            framing_scope: framingScope,
            background_for_look: backgroundForLook,
          },
        });

        // Capture look-0 prompt as the primary motion prompt for Seedance
        if (i === 0) {
          seedanceMotionPrompt = prompts.motion_prompt;
          seedanceNegativePrompt = prompts.negative_prompt;

          // Override with source_prompt.txt if present (Higgsfield-generated prompt)
          const sourcePrompt = loadSourcePrompt(template.id);
          if (sourcePrompt) {
            console.log(`[orchestrator] using source_prompt.txt for ${template.id} — overriding motion_prompt`);
            seedanceMotionPrompt = sourcePrompt;
          }
        }

        const productImages = products.map((p) => ({
          bytes: readFileSync(resolve("public", p.image_path)),
          mimeType: "image/png" as const,
          description: buildProductDescription(p),
        }));

        let keyframe = await compositeKeyframe({
          keyframePrompt: prompts.keyframe_prompt,
          templateFirstFrame: { bytes: templateFirstFrame, mimeType: "image/png" },
          referenceFace: { bytes: anchorFaceBytes, mimeType: anchorFaceMimeType },
          products: productImages,
          faceDescription,
          framingScope,
          backgroundDescription: backgroundForLook,
        });

        // Judge with one retry
        const judgement = await judgeKeyframe({
          keyframe: { bytes: keyframe.imageBytes, mimeType: keyframe.mimeType },
          referenceFace: { bytes: anchorFaceBytes, mimeType: anchorFaceMimeType },
          products: productImages.map((p) => ({ bytes: p.bytes, mimeType: p.mimeType })),
        });

        if (
          !judgement.identity_preserved ||
          !judgement.all_products_present ||
          !judgement.products_correctly_placed
        ) {
          console.warn(
            `[orchestrator][seedance] look ${i} judge flagged issues, retrying once:`,
            judgement.issues,
          );
          const retryPrompt = `${prompts.keyframe_prompt}\n\nCORRECTIONS based on the previous attempt — fix these issues explicitly:\n${judgement.issues.map((x) => `- ${x}`).join("\n")}`;
          keyframe = await compositeKeyframe({
            keyframePrompt: retryPrompt,
            templateFirstFrame: { bytes: templateFirstFrame, mimeType: "image/png" },
            referenceFace: { bytes: anchorFaceBytes, mimeType: anchorFaceMimeType },
            products: productImages,
            faceDescription,
            framingScope,
            backgroundDescription: backgroundForLook,
          });
        }

        const keyframePath = join(runDir, `keyframe-${i}.png`);
        writeFileSync(keyframePath, keyframe.imageBytes);
        keyframeUrls.push(`/runs/${run_id}/keyframe-${i}.png`);

        // Upload to Blob for Seedance (needs HTTPS URL)
        try {
          const blobUrl = await uploadToBlob(
            `keyframes/${run_id}/look-${i}.png`,
            keyframe.imageBytes,
            keyframe.mimeType,
          );
          console.log(`[orchestrator][seedance] uploaded keyframe ${i}: ${blobUrl}`);
          blobKeyframeUrls.push(blobUrl);
        } catch (err) {
          throw new Error(
            `[orchestrator][seedance] keyframe upload failed for look ${i} (Seedance requires HTTPS URLs): ${(err as Error).message}`,
          );
        }
      }

      updateRun(run_id, { per_look_keyframe_urls: keyframeUrls });

      // Single Seedance call — first keyframe is the identity anchor;
      // remaining keyframes are passed as outfit reference images.
      const [primaryKeyframeUrl, ...outfitImageUrls] = blobKeyframeUrls;

      updateRun(run_id, {
        status: "generating_video",
        progress_label: "Rendering multi-shot video via Seedance 2.0…",
        current_look_index: 0,
      });

      const seedanceResult = await generateMultiShotViaSeedance({
        keyframeUrl: primaryKeyframeUrl,
        outfitImageUrls,
        motionReferenceUrl,
        motionPrompt: seedanceMotionPrompt,
        negativePrompt: seedanceNegativePrompt,
        durationSeconds: 5,
        aspectRatio: "9:16",
      });

      // Save the raw video (no concat needed — Seedance produces multi-shot natively)
      const rawPath = join(runDir, "seedance-raw.mp4");
      writeFileSync(rawPath, seedanceResult.videoBytes);

      // Mux audio from the template (Seedance audio is disabled; we add template BGM)
      updateRun(run_id, {
        status: "concatenating",
        progress_label: "Muxing audio…",
      });
      const finalPath = join(runDir, "output.mp4");
      const templateVideoPath = resolve("public", template.video_path);
      // concatClips with a single clip just copies + muxes audio
      await concatClips([rawPath], finalPath, templateVideoPath);

      return updateRun(run_id, {
        status: "succeeded",
        video_url: `/runs/${run_id}/output.mp4`,
      });
    }

    // -----------------------------------------------------------------------
    // KLING PATH (default) — per-look loop, unchanged
    // -----------------------------------------------------------------------

    const keyframeUrls: string[] = [];
    const clipUrls: string[] = [];
    const clipPaths: string[] = [];

    for (let i = 0; i < run.looks.length; i++) {
      const result = await processLook({
        run_id,
        look_index: i,
        total_looks: run.looks.length,
        template,
        templateFirstFrame,
        face_metadata: face,
        faceDescription,
        referenceFaceBytes: anchorFaceBytes,        // CHANGED — was input.referenceFaceBytes
        referenceFaceMimeType: anchorFaceMimeType,  // CHANGED — was input.referenceFaceMimeType
        look: run.looks[i],
        runDir,
      });
      keyframeUrls.push(result.keyframe_url);
      if (result.clip_url) clipUrls.push(result.clip_url);
      if (result.clipPath) clipPaths.push(result.clipPath);
      updateRun(run_id, {
        per_look_keyframe_urls: [...keyframeUrls],
        ...(clipUrls.length > 0 ? { per_look_clip_urls: [...clipUrls] } : {}),
      });
    }

    // If SKIP_KLING, stop here — no concat, no audio mux, no output.mp4
    if (SKIP_KLING()) {
      console.log("[orchestrator] SKIP_KLING=true — stopping after keyframe generation; not calling Kling/concat");
      return updateRun(run_id, {
        status: "succeeded",
        progress_label: "Keyframes generated (Kling skipped)",
        per_look_keyframe_urls: keyframeUrls,
      });
    }

    // Concat stage
    updateRun(run_id, {
      status: "concatenating",
      progress_label: "Stitching final video…",
    });
    const finalPath = join(runDir, "output.mp4");
    const templateVideoPath = resolve("public", template.video_path);
    await concatClips(clipPaths, finalPath, templateVideoPath);

    return updateRun(run_id, {
      status: "succeeded",
      video_url: `/runs/${run_id}/output.mp4`,
    });
  } catch (err: any) {
    return updateRun(run_id, {
      status: "failed",
      error: err.message ?? String(err),
    });
  }
}
