// src/lib/pipeline/orchestrator.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { analyzeReferenceFace } from "./face-analysis";
import { orchestratePrompts } from "./orchestrate";
import { compositeKeyframe, compositeProductOnlyKeyframe } from "./keyframe";
import { inferFramingScope } from "./framing";
import { judgeKeyframe } from "./judge";
import { generateVideoFromKeyframe } from "./kling";
import { generateMultiShotViaSeedance } from "./seedance";
import {
  generateViaKieSeedance,
  generateMultiShotViaKieSeedance,
} from "./kie-seedance";
import { concatClips } from "./concat";
import { conformClipDuration } from "./clip-conform";
import { generateMasterSubjectReference } from "./master-subject";
import { updateRun, getRun } from "./run-store";
import { uploadToBlob } from "./upload";
import type {
  TemplateAsset,
  ProductAsset,
  TemplateMetadata,
  ProductMetadata,
  Look,
  MotionScriptEntry,
  OutfitSegment,
  SubjectState,
} from "./types";

const VERCEL_DEPLOYMENT_URL =
  process.env.VERCEL_DEPLOYMENT_URL ?? "https://ai-campaign-video.vercel.app";

const USE_MOTION_CONTROL = () => process.env.KLING_USE_MOTION_CONTROL === "true";

// ---------------------------------------------------------------------------
// Provider switching — VIDEO_PROVIDER enum: kling | seedance | kie_seedance
// Backward compat: USE_SEEDANCE=true maps to "seedance" when VIDEO_PROVIDER unset.
// ---------------------------------------------------------------------------
type VideoProvider = "kling" | "seedance" | "kie_seedance";

function getVideoProvider(): VideoProvider {
  const explicit = process.env.VIDEO_PROVIDER?.trim().toLowerCase();
  if (
    explicit === "kling" ||
    explicit === "seedance" ||
    explicit === "kie_seedance"
  ) {
    return explicit;
  }
  // Backward compat — old USE_SEEDANCE boolean
  if (process.env.USE_SEEDANCE === "true") return "seedance";
  return "kie_seedance";
}

// ---------------------------------------------------------------------------
// Feature flag — when true, stop after keyframe generation and skip all video
// generation calls and the final concat. Useful for testing image quality
// without burning credits.
// ---------------------------------------------------------------------------
const SKIP_KLING = () => process.env.SKIP_KLING === "true";

// ---------------------------------------------------------------------------
// kie.ai video strategy — switch between two architectures for comparison.
//   multishot_single_call (default) — ONE kie.ai call with all outfit keyframes
//                                     + the full template as reference video, at
//                                     the template's full duration. Skips concat.
//                                     Cheapest + fastest; output duration matches
//                                     the template natively.
//   per_shot_conform                 — N kie.ai calls (one per outfit segment),
//                                     ffmpeg-speed-conform each clip to its true
//                                     segment span (max 2.5x speedup, trim above),
//                                     then concat. Use when you need guaranteed
//                                     per-outfit visual fidelity.
// ---------------------------------------------------------------------------
type KieVideoStrategy = "per_shot_conform" | "multishot_single_call";
const getKieVideoStrategy = (): KieVideoStrategy => {
  const v = process.env.KIE_VIDEO_STRATEGY?.trim().toLowerCase();
  return v === "per_shot_conform" ? "per_shot_conform" : "multishot_single_call";
};

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

// ---------------------------------------------------------------------------
// Outfit-driven segmentation
// ---------------------------------------------------------------------------
//
// `outfit_segments[]` in template metadata declares the canonical outfit slots
// for that template. For look N, we use outfit_segments[N % outfit_segments.length].
//
// If outfit_segments is missing (legacy metadata), we synthesize a single
// segment covering the full motion_script — i.e. treat the template as
// single-outfit. This keeps the pipeline behaving consistently for any
// template that hasn't been migrated yet.
function pickOutfitSegment(
  metadata: TemplateMetadata,
  look_index: number,
): { index: number; segment: OutfitSegment } {
  const segments = metadata.outfit_segments && metadata.outfit_segments.length > 0
    ? metadata.outfit_segments
    : ([
        {
          t_start: metadata.motion_script[0]?.t_start ?? 0,
          t_end: metadata.motion_script.at(-1)?.t_end ?? 1,
          shot_indices: metadata.motion_script.map((_, i) => i),
        },
      ] as OutfitSegment[]);
  const idx = look_index % segments.length;
  return { index: idx, segment: segments[idx] };
}

// Expand an outfit_segment's subject_states (if present) into per-state groups.
// Each group has its own state, shot_indices, motion_script entries, and
// derived t_start/t_end. When subject_states is omitted (legacy metadata),
// returns a single "wearing" group covering the whole segment — this preserves
// today's behavior for all existing templates.
type StateGroup = {
  state: SubjectState;
  shot_indices: number[];
  motion_script_entries: MotionScriptEntry[];
  t_start: number;
  t_end: number;
};

function expandSegmentStates(
  segment: OutfitSegment,
  motionScript: MotionScriptEntry[],
): StateGroup[] {
  if (!segment.subject_states || segment.subject_states.length === 0) {
    const entries = segment.shot_indices
      .map((i) => motionScript[i])
      .filter(Boolean) as MotionScriptEntry[];
    return [
      {
        state: "wearing",
        shot_indices: segment.shot_indices,
        motion_script_entries: entries,
        t_start: segment.t_start,
        t_end: segment.t_end,
      },
    ];
  }
  return segment.subject_states.map((s) => {
    const entries = s.shot_indices
      .map((i) => motionScript[i])
      .filter(Boolean) as MotionScriptEntry[];
    const t_start = entries.length > 0 ? entries[0].t_start : segment.t_start;
    const t_end = entries.length > 0 ? entries.at(-1)!.t_end : segment.t_end;
    return {
      state: s.state,
      shot_indices: s.shot_indices,
      motion_script_entries: entries,
      t_start,
      t_end,
    };
  });
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
  masterSubjectBytes?: Buffer;
  masterSubjectMimeType?: string;
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

  // Per-look slice driven by template.outfit_segments (the canonical outfit
  // slots for this template). Look N → outfit_segments[N] (capped at length).
  const segmentPlan = pickOutfitSegment(args.template.metadata, args.look_index);
  const segmentIdx = segmentPlan.index;
  const segStart = segmentPlan.segment.t_start;
  const segEnd = segmentPlan.segment.t_end;
  const segDur = segEnd - segStart;
  const motionScriptForLook = segmentPlan.segment.shot_indices
    .map((i) => args.template.metadata.motion_script[i])
    .filter(Boolean);

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
    masterSubject: args.masterSubjectBytes && args.masterSubjectMimeType
      ? { bytes: args.masterSubjectBytes, mimeType: args.masterSubjectMimeType }
      : undefined,
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
      masterSubject: args.masterSubjectBytes && args.masterSubjectMimeType
        ? { bytes: args.masterSubjectBytes, mimeType: args.masterSubjectMimeType }
        : undefined,
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

  // Compute per-segment target duration from the motion_script slice.
  // Kling supports 5s or 10s only — snap to whichever is closer.
  const klingSegmentSpan =
    motionScriptForLook.length > 0
      ? motionScriptForLook.at(-1)!.t_end - motionScriptForLook[0].t_start
      : 5;
  const klingDuration: 5 | 10 = klingSegmentSpan <= 7 ? 5 : 10;
  console.log(
    `[orchestrator] look ${args.look_index} segment_span=${klingSegmentSpan.toFixed(1)}s → requesting ${klingDuration}s Kling clip`,
  );

  const video = await generateVideoFromKeyframe({
    keyframeBytes: keyframe.imageBytes,
    keyframeMimeType: keyframe.mimeType,
    motionPrompt: prompts.motion_prompt,
    negativePrompt: prompts.negative_prompt,
    durationSeconds: klingDuration,
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

    // Upload master subject + original reference face to Vercel Blob so kie.ai
    // can use them as identity anchors (needs public HTTPS URLs).
    const masterBlobUrl = master
      ? await uploadToBlob(
          `identity/${run_id}/master-subject.png`,
          master.imageBytes,
          master.mimeType,
        ).catch((e) => {
          console.warn("[orchestrator] master blob upload failed:", (e as Error).message);
          return undefined;
        })
      : undefined;

    const originalRefExt = input.referenceFaceMimeType.split("/")[1] ?? "jpg";
    const originalRefBlobUrl = await uploadToBlob(
      `identity/${run_id}/original-reference.${originalRefExt}`,
      input.referenceFaceBytes,
      input.referenceFaceMimeType,
    ).catch((e) => {
      console.warn("[orchestrator] original ref blob upload failed:", (e as Error).message);
      return undefined;
    });

    // Deduplicated identity reference URLs for kie.ai (master + original face)
    const identityReferenceUrls = [masterBlobUrl, originalRefBlobUrl].filter(
      (u): u is string => !!u,
    );

    const provider = getVideoProvider();
    console.log(`[orchestrator] video provider: ${provider}`);

    // -----------------------------------------------------------------------
    // SEEDANCE PATH — single multi-shot call for all looks
    // -----------------------------------------------------------------------
    if (provider === "seedance") {
      console.log("[orchestrator] provider=seedance — using Seedance 2.0 multi-shot path");

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
          referenceFace: { bytes: input.referenceFaceBytes, mimeType: input.referenceFaceMimeType },
          masterSubject: master ? { bytes: master.imageBytes, mimeType: master.mimeType } : undefined,
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
            referenceFace: { bytes: input.referenceFaceBytes, mimeType: input.referenceFaceMimeType },
            masterSubject: master ? { bytes: master.imageBytes, mimeType: master.mimeType } : undefined,
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
    // KIE_SEEDANCE PATH — per-look loop via kie.ai bytedance/seedance-2
    // Each look gets its own keyframe + reference_video call (parallel to Kling).
    // -----------------------------------------------------------------------
    if (provider === "kie_seedance") {
      const kieStrategy = getKieVideoStrategy();
      console.log(`[orchestrator] provider=kie_seedance strategy=${kieStrategy}`);

      // Template video URL served from Vercel deployment (kie.ai fetches it
      // server-side). For templates not yet deployed to production, set
      // MOTION_REFERENCE_URL_OVERRIDE to a public Blob URL.
      const motionReferenceUrl =
        process.env.MOTION_REFERENCE_URL_OVERRIDE?.trim() ||
        `${VERCEL_DEPLOYMENT_URL}/${template.video_path}`;
      if (process.env.MOTION_REFERENCE_URL_OVERRIDE) {
        console.log(`[orchestrator] using MOTION_REFERENCE_URL_OVERRIDE for template video: ${motionReferenceUrl.slice(0, 100)}`);
      }

      // Per-product URL overrides for products not yet deployed to production.
      // PRODUCT_URL_OVERRIDES is a JSON map of {product_id: blob_url}.
      let productUrlOverrides: Record<string, string> = {};
      if (process.env.PRODUCT_URL_OVERRIDES) {
        try {
          productUrlOverrides = JSON.parse(process.env.PRODUCT_URL_OVERRIDES);
          console.log(
            `[orchestrator] using PRODUCT_URL_OVERRIDES for: ${Object.keys(productUrlOverrides).join(", ")}`,
          );
        } catch (err) {
          console.warn(`[orchestrator] PRODUCT_URL_OVERRIDES parse failed: ${(err as Error).message}`);
        }
      }
      const productUrlFor = (p: ProductAsset): string =>
        productUrlOverrides[p.id] ?? `${VERCEL_DEPLOYMENT_URL}/${p.image_path}`;

      const keyframeUrls: string[] = [];
      const clipUrls: string[] = [];
      const clipPaths: string[] = [];

      // Collected only when kieStrategy === "multishot_single_call":
      // one entry per look — used to build the multi-shot prompt and the
      // single kie.ai call after the keyframe-only loop completes.
      const multishotKeyframeBlobUrls: string[] = [];
      const multishotShotPlan: {
        outfit_index: number;
        state: SubjectState;
        shot_indices: number[];
        t_start: number;
        t_end: number;
        motion_prompt: string;
        outfit_description: string;
      }[] = [];
      const multishotProductRefSet = new Set<string>();

      // Single-outfit special case — when there's exactly one outfit slot AND
      // one look AND the segment has no mixed subject_states (i.e., every shot
      // is "wearing"), Seedance's reference_video mode auto-detects shot
      // boundaries and rotates through reference_image_urls across them, which
      // bleeds different outfits when multiple distinct images are sent. We
      // keep the reference_video (so motion still matches template choreography)
      // but drop product/identity refs and send ONLY the keyframe — Seedance
      // has nothing to rotate through, so the same outfit appears in every
      // perceived shot.
      //
      // For ad-style templates with mixed subject_states (template-7), this
      // shortcut would discard the product-only keyframes. We detect that and
      // fall through to the regular multishot path so all keyframes get used.
      const hasMixedSubjectStates =
        (template.metadata.outfit_segments?.length ?? 0) > 0 &&
        (template.metadata.outfit_segments ?? []).some(
          (seg) =>
            seg.subject_states &&
            seg.subject_states.length > 1 &&
            new Set(seg.subject_states.map((s) => s.state)).size > 1,
        );
      const isSingleOutfit =
        (template.metadata.outfit_segments?.length ?? 1) === 1 &&
        run.looks.length === 1 &&
        !hasMixedSubjectStates;
      if (isSingleOutfit) {
        console.log(
          "[orchestrator] single-outfit template + single look — keeping reference_video for motion, but sending ONLY the keyframe as reference image (no identity / product refs) to prevent outfit bleeding while preserving template choreography",
        );
      } else if (hasMixedSubjectStates) {
        console.log(
          "[orchestrator] template has mixed subject_states (wearing + absent) — using multi-keyframe multishot path instead of single-outfit shortcut",
        );
      }

      for (let i = 0; i < run.looks.length; i++) {
        console.log(`[orchestrator] look ${i} video provider: kie_seedance`);

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

        const segmentPlan = pickOutfitSegment(template.metadata, i);
        const segmentIdx = segmentPlan.index;
        const segStart = segmentPlan.segment.t_start;
        const segEnd = segmentPlan.segment.t_end;
        const segDur = segEnd - segStart;
        const motionScriptForLook = segmentPlan.segment.shot_indices
          .map((idx) => template.metadata.motion_script[idx])
          .filter(Boolean);

        const prompts = await orchestratePrompts({
          template: template.metadata,
          products: products.map((p) => p.metadata),
          face,
          options: {
            look_index: i,
            total_looks: run.looks.length,
            framing_scope: framingScope,
            background_for_look: backgroundForLook,
            motion_script_for_this_look: motionScriptForLook,
          },
        });

        // Override motion_prompt with source_prompt.txt if present
        const sourcePrompt = loadSourcePrompt(template.id);
        if (sourcePrompt) {
          console.log(`[orchestrator] using source_prompt.txt for ${template.id} — overriding motion_prompt`);
          prompts.motion_prompt = sourcePrompt;
        }

        const productImages = products.map((p) => ({
          bytes: readFileSync(resolve("public", p.image_path)),
          mimeType: "image/png" as const,
          description: buildProductDescription(p),
        }));

        let keyframe = await compositeKeyframe({
          keyframePrompt: prompts.keyframe_prompt,
          templateFirstFrame: { bytes: templateFirstFrame, mimeType: "image/png" },
          referenceFace: { bytes: input.referenceFaceBytes, mimeType: input.referenceFaceMimeType },
          masterSubject: master ? { bytes: master.imageBytes, mimeType: master.mimeType } : undefined,
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
            `[orchestrator][kie-seedance] look ${i} judge flagged issues, retrying once:`,
            judgement.issues,
          );
          const retryPrompt = `${prompts.keyframe_prompt}\n\nCORRECTIONS based on the previous attempt — fix these issues explicitly:\n${judgement.issues.map((x) => `- ${x}`).join("\n")}`;
          keyframe = await compositeKeyframe({
            keyframePrompt: retryPrompt,
            templateFirstFrame: { bytes: templateFirstFrame, mimeType: "image/png" },
            referenceFace: { bytes: input.referenceFaceBytes, mimeType: input.referenceFaceMimeType },
            masterSubject: master ? { bytes: master.imageBytes, mimeType: master.mimeType } : undefined,
            products: productImages,
            faceDescription,
            framingScope,
            backgroundDescription: backgroundForLook,
          });
        }

        const keyframePath = join(runDir, `keyframe-${i}.png`);
        writeFileSync(keyframePath, keyframe.imageBytes);
        keyframeUrls.push(`/runs/${run_id}/keyframe-${i}.png`);

        // SKIP_KLING early exit
        if (SKIP_KLING()) {
          console.log(`[orchestrator] SKIP_KLING=true — keyframe ${i} saved, skipping video generation`);
          continue;
        }

        // Upload keyframe to Blob for kie.ai (needs HTTPS URL)
        let keyframeBlobUrl: string;
        try {
          keyframeBlobUrl = await uploadToBlob(
            `keyframes/${run_id}/look-${i}.png`,
            keyframe.imageBytes,
            keyframe.mimeType,
          );
          console.log(`[orchestrator][kie-seedance] uploaded keyframe ${i} to blob: ${keyframeBlobUrl}`);
        } catch (err) {
          throw new Error(
            `[orchestrator][kie-seedance] keyframe upload failed for look ${i}: ${(err as Error).message}`,
          );
        }

        // Compute per-segment target duration from the motion_script slice
        const segmentSpan =
          motionScriptForLook.length > 0
            ? motionScriptForLook.at(-1)!.t_end - motionScriptForLook[0].t_start
            : 5;

        // Build product reference URLs (public deployment, with PRODUCT_URL_OVERRIDES applied per id)
        const productReferenceUrls = products.map(productUrlFor);

        if (kieStrategy === "multishot_single_call") {
          // Multishot mode — collect per-shot context and skip per-shot kie.ai calls.
          // The single multi-shot call happens once after the loop.
          //
          // Expand the segment into state groups. Templates without
          // subject_states declared yield 1 wearing group covering everything
          // (legacy behavior preserved). Ad-style templates yield multiple
          // groups including "absent" — render product-only keyframes for those.
          const stateGroups = expandSegmentStates(
            segmentPlan.segment,
            template.metadata.motion_script,
          );

          const outfitDescription = products
            .map((p) => buildProductDescription(p))
            .join("; ");

          for (let g = 0; g < stateGroups.length; g++) {
            const group = stateGroups[g];

            if (group.state === "wearing") {
              // The keyframe we already generated above is the wearing keyframe.
              // Reuse its blob URL for any wearing groups (typically 1 per segment).
              multishotKeyframeBlobUrls.push(keyframeBlobUrl);
              const groupActions = group.motion_script_entries
                .map((e) => e.action)
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
              multishotShotPlan.push({
                outfit_index: i,
                state: "wearing",
                shot_indices: group.shot_indices,
                t_start: group.t_start,
                t_end: group.t_end,
                motion_prompt: groupActions || prompts.motion_prompt,
                outfit_description: outfitDescription,
              });
              for (const u of productReferenceUrls) multishotProductRefSet.add(u);
              console.log(
                `[orchestrator][multishot] look ${i} group ${g} (wearing) plan collected — shots [${group.shot_indices.join(",")}], ${group.t_start.toFixed(2)}-${group.t_end.toFixed(2)}s`,
              );
            } else {
              // "absent" — generate one product-only keyframe PER motion_script
              // entry in this group. Each entry gets its own scene-specific
              // keyframe (e.g., crystals vs ice vs cave) so Seedance has a 1:1
              // visual reference for each perceived shot. Without this, multiple
              // absent shots share a single keyframe and Seedance falls back to
              // reproducing the reference video's content for the unmapped shots.
              const shotBackgrounds = template.metadata.shot_backgrounds ?? [];
              for (let entryIdx = 0; entryIdx < group.motion_script_entries.length; entryIdx++) {
                const entry = group.motion_script_entries[entryIdx];
                const motionScriptIndex = group.shot_indices[entryIdx];
                const shotBackground =
                  shotBackgrounds[motionScriptIndex] ?? backgroundForLook;
                const action = entry.action.replace(/\s+/g, " ").trim();
                const productOnly = await compositeProductOnlyKeyframe({
                  templateFirstFrame: { bytes: templateFirstFrame, mimeType: "image/png" },
                  products: productImages,
                  shotDescription: action,
                  backgroundDescription: shotBackground,
                });
                const absentKeyframePath = join(
                  runDir,
                  `keyframe-${i}-absent-shot${motionScriptIndex}.png`,
                );
                writeFileSync(absentKeyframePath, productOnly.imageBytes);
                const absentBlobUrl = await uploadToBlob(
                  `keyframes/${run_id}/look-${i}-absent-shot${motionScriptIndex}.png`,
                  productOnly.imageBytes,
                  productOnly.mimeType,
                );
                console.log(
                  `[orchestrator][multishot] look ${i} group ${g} (absent) shot ${motionScriptIndex} keyframe uploaded — scene "${shotBackground.slice(0, 60)}..."`,
                );

                multishotKeyframeBlobUrls.push(absentBlobUrl);
                multishotShotPlan.push({
                  outfit_index: i,
                  state: "absent",
                  shot_indices: [motionScriptIndex],
                  t_start: entry.t_start,
                  t_end: entry.t_end,
                  motion_prompt: action || prompts.motion_prompt,
                  outfit_description: outfitDescription,
                });
                for (const u of productReferenceUrls) multishotProductRefSet.add(u);
              }
            }
          }
          continue; // skip per-shot call
        }

        // per_shot_conform path doesn't currently support subject_states —
        // log a warning so the user knows to use multishot for ad-style templates.
        const hasAbsent = expandSegmentStates(
          segmentPlan.segment,
          template.metadata.motion_script,
        ).some((g) => g.state === "absent");
        if (hasAbsent) {
          console.warn(
            `[orchestrator] look ${i} segment has subject_states with "absent" shots, but per_shot_conform mode treats every shot as "wearing". Use KIE_VIDEO_STRATEGY=multishot_single_call for ad-style templates.`,
          );
        }

        // ── per_shot_conform path (default) ────────────────────────────────
        // kie.ai Seedance accepts integer 4–15s. Clamp + round.
        const targetDurationSeconds = Math.max(
          4,
          Math.min(15, Math.round(segmentSpan)),
        ) as 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
        console.log(
          `[orchestrator] look ${i} segment_span=${segmentSpan.toFixed(1)}s → requesting ${targetDurationSeconds}s clip`,
        );

        updateRun(run_id, {
          status: "generating_video",
          progress_label: `Rendering motion for look ${i + 1} of ${run.looks.length}…`,
          current_look_index: i,
        });

        const kieResult = await generateViaKieSeedance({
          keyframeUrl: keyframeBlobUrl,
          // Single-outfit case: keep reference_video for template motion, but
          // strip identity + product refs so Seedance has only the keyframe
          // as visual material — no alternative outfits to rotate through.
          identityReferenceUrls: isSingleOutfit ? undefined : identityReferenceUrls,
          productReferenceUrls: isSingleOutfit ? undefined : productReferenceUrls,
          motionReferenceUrl,
          motionPrompt: prompts.motion_prompt,
          negativePrompt: prompts.negative_prompt,
          durationSeconds: targetDurationSeconds,
          aspectRatio: "9:16",
          resolution: "720p",
        });

        const rawClipPath = join(runDir, `clip-${i}-raw.mp4`);
        writeFileSync(rawClipPath, kieResult.videoBytes);

        // Log actual vs requested duration
        const actualDuration = await new Promise<number>((resolve) => {
          ffmpeg.ffprobe(rawClipPath, (err, data) => {
            if (err) return resolve(0);
            resolve(data.format?.duration ?? 0);
          });
        });
        console.log(
          `[orchestrator] look ${i} duration check: requested=${targetDurationSeconds}s actual=${actualDuration.toFixed(2)}s`,
        );

        // Speed-conform the clip so its duration matches the segment's true span.
        const clipPath = join(runDir, `clip-${i}.mp4`);
        const conform = await conformClipDuration({
          inputPath: rawClipPath,
          outputPath: clipPath,
          actualDurationSeconds: actualDuration,
          targetDurationSeconds: segmentSpan,
        });
        console.log(
          `[orchestrator] look ${i} conform: target=${segmentSpan.toFixed(2)}s, speedup=${conform.speedupApplied.toFixed(2)}x${conform.trimmed ? " (trimmed)" : ""}, final=${conform.finalDurationSeconds.toFixed(2)}s`,
        );

        clipPaths.push(clipPath);
        clipUrls.push(`/runs/${run_id}/clip-${i}.mp4`);

        updateRun(run_id, {
          per_look_keyframe_urls: [...keyframeUrls],
          per_look_clip_urls: [...clipUrls],
        });
      }

      updateRun(run_id, { per_look_keyframe_urls: keyframeUrls });

      // SKIP_KLING stop — no concat
      if (SKIP_KLING()) {
        console.log("[orchestrator] SKIP_KLING=true — stopping after keyframe generation");
        return updateRun(run_id, {
          status: "succeeded",
          progress_label: "Keyframes generated (video generation skipped)",
          per_look_keyframe_urls: keyframeUrls,
        });
      }

      // ── multishot_single_call path: ONE kie.ai call after all keyframes ──
      if (kieStrategy === "multishot_single_call") {
        if (multishotKeyframeBlobUrls.length === 0) {
          throw new Error("[orchestrator][multishot] no keyframes collected");
        }
        const fullDuration = template.metadata.motion_script.at(-1)?.t_end ?? 5;
        const requestDuration = Math.max(
          4,
          Math.min(15, Math.round(fullDuration)),
        ) as 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

        // Single-outfit fallback: don't use the multishot function (which
        // requires reference_video and would trigger outfit bleeding).
        // Use the simple first_frame_url path with no reference video.
        if (isSingleOutfit) {
          updateRun(run_id, {
            status: "generating_video",
            progress_label: `Rendering single-outfit video (1 call, ${requestDuration}s)…`,
          });
          const simpleResult = await generateViaKieSeedance({
            keyframeUrl: multishotKeyframeBlobUrls[0],
            // Keep reference_video for template motion choreography. Drop
            // identity + product refs so Seedance only has the keyframe as
            // visual material — same outfit reused across all perceived shots.
            motionReferenceUrl,
            motionPrompt: multishotShotPlan[0].motion_prompt,
            durationSeconds: requestDuration,
            aspectRatio: "9:16",
            resolution: "720p",
          });
          const rawSinglePath = join(runDir, "kie-multishot-raw.mp4");
          writeFileSync(rawSinglePath, simpleResult.videoBytes);
          const actualDur = await new Promise<number>((resolve) => {
            ffmpeg.ffprobe(rawSinglePath, (err, data) => {
              if (err) return resolve(0);
              resolve(data.format?.duration ?? 0);
            });
          });
          console.log(
            `[orchestrator][multishot] single-outfit kie.ai returned ${actualDur.toFixed(2)}s clip (target = ${fullDuration.toFixed(2)}s)`,
          );
          const conformedSinglePath = join(runDir, "kie-multishot-conformed.mp4");
          await conformClipDuration({
            inputPath: rawSinglePath,
            outputPath: conformedSinglePath,
            actualDurationSeconds: actualDur,
            targetDurationSeconds: fullDuration,
          });
          updateRun(run_id, {
            status: "concatenating",
            progress_label: "Muxing template audio…",
          });
          const finalPathSingle = join(runDir, "output.mp4");
          const templateVideoPathSingle = resolve("public", template.video_path);
          await concatClips([conformedSinglePath], finalPathSingle, templateVideoPathSingle);
          ffmpeg.ffprobe(finalPathSingle, (err, data) => {
            if (err) return;
            console.log(
              `[orchestrator][multishot] final mp4 verify — duration=${data.format?.duration}s, streams=${data.streams?.length}`,
            );
          });
          return updateRun(run_id, {
            status: "succeeded",
            video_url: `/runs/${run_id}/output.mp4`,
          });
        }

        // Build the comprehensive prompt with per-shot timestamps + outfits.
        // STRICT outfit-to-shot binding language is the only lever we have
        // against Seedance's tendency to redistribute reference_image_urls
        // across perceived shots based on visual weight (longer/repeated
        // settings hijack outfits assigned to short/unique settings).
        const shotLines = multishotShotPlan.map((s, idx) => {
          const action = s.motion_prompt
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 350);
          if (s.state === "absent") {
            return [
              `SHOT ${idx + 1} (${s.t_start.toFixed(1)}-${s.t_end.toFixed(1)}s) — PRODUCT-ONLY HERO SHOT, NO PERSON:`,
              `  - This shot must contain NO human, NO model, NO body part, NO subject. The frame shows only the product(s) in the scene — keyframe ${idx + 1} is the visual reference for this shot.`,
              `  - DO NOT insert the person from the other shots' keyframes into this shot. Any human appearance here is INCORRECT.`,
              `  - Action: ${action}`,
            ].join("\n");
          }
          return [
            `SHOT ${idx + 1} (${s.t_start.toFixed(1)}-${s.t_end.toFixed(1)}s):`,
            `  - The subject wears the EXACT outfit shown in keyframe ${idx + 1} — ${s.outfit_description}.`,
            `  - This outfit is LOCKED to this shot's timestamp range and MUST appear in every frame within it.`,
            `  - This outfit MUST NEVER appear in any other shot's timestamp range. If you find yourself rendering this outfit at a timestamp outside ${s.t_start.toFixed(1)}-${s.t_end.toFixed(1)}s, that is INCORRECT.`,
            `  - Action: ${action}`,
          ].join("\n");
        });

        const hasAbsentShots = multishotShotPlan.some((s) => s.state === "absent");
        // Build a single canonical product-name string from the user's products
        // (deduped). Used for the product-substitution clause.
        const allProductNames = Array.from(
          new Set(multishotShotPlan.flatMap((s) => s.outfit_description.split("; "))),
        )
          .filter(Boolean)
          .join("; ")
          .slice(0, 600);

        const headerLines = hasAbsentShots
          ? [
              `Multi-shot commercial video, ${fullDuration.toFixed(1)} seconds total, ${multishotShotPlan.length} shots. Some shots feature the subject with the product; other shots are PRODUCT-ONLY hero shots with no person in frame. Match the reference video's shot structure and timing exactly.`,
              "Honor each shot's state — subject-present shots must show the subject; product-only shots must show NO person at all. Do not insert people into product-only shots, and do not omit the person from subject-present shots.",
            ]
          : [
              `Multi-shot fashion video, ${fullDuration.toFixed(1)} seconds total, ${multishotShotPlan.length} shots.`,
              "The subject changes outfits across the shots — match the reference video's shot structure and timing exactly.",
            ];

        const multishotPrompt = [
          ...headerLines,
          "Use jump cuts at the timestamps below. Keep identity consistent on shots that feature the subject; render product-only shots without any person.",
          "",
          "PRODUCT SUBSTITUTION (highest priority alongside identity):",
          `The product(s) visible in EVERY shot of the output must be the user's product(s) shown in the reference images: ${allProductNames}. The reference video MAY show a different product (the template's placeholder) — that placeholder is for choreography reference ONLY and must NOT appear in the output. Wherever the reference video shows its placeholder product (whether held by a person or as a hero shot), substitute the user's product in its place. Match every visible detail of the user's product (color, label, shape, finish, branding) exactly to the reference images. If you find yourself rendering the template's placeholder product instead of the user's product, that is INCORRECT.`,
          "",
          "STRICT SHOT-STATE BINDING:",
          "Each keyframe is bound to its assigned shot's timestamp range. The model MUST NOT redistribute, blend, or repeat keyframes across shots — even if some shots are short or some settings are revisited. Short shots must still receive their assigned keyframe; longer / revisited shots must not steal short shots' material. Subject-bearing keyframes appear ONLY in their assigned (wearing) shots; product-only keyframes appear ONLY in their assigned (absent) shots.",
          "",
          ...shotLines,
          "",
          "Identity match (for subject-present shots) and product substitution (for ALL shots) are tied for highest priority. Shot-state binding is second. These three rules outrank motion fidelity and scene reproduction. Do not insert the subject into product-only shots, do not blend outfits between subject-present shots, and do not let the template's placeholder product appear in the output.",
        ].join("\n");

        console.log(
          `[orchestrator][multishot] requesting ${requestDuration}s clip across ${multishotShotPlan.length} shots; prompt preview: ${multishotPrompt.slice(0, 250).replace(/\n/g, " ⏎ ")}`,
        );

        updateRun(run_id, {
          status: "generating_video",
          progress_label: `Rendering multi-shot video (1 call, ${requestDuration}s)…`,
        });

        // The keyframes already encode identity (the face/body baked in by
        // Nano Banana Pro from the master + creator photo) and the products
        // (wearing keyframes show the outfit; product-only keyframes show the
        // product alone). Sending identity + product refs separately to kie.ai
        // adds "loose" visual material that Seedance can treat as standalone
        // shots, observed bleeding both for absent-shot templates (raw creator
        // photo appearing as a still frame) and for multi-outfit templates
        // (master subject's white-tee + jeans appearing in a graffiti shot).
        // Drop both unconditionally — keyframes carry everything we need.
        const multishotResult = await generateMultiShotViaKieSeedance({
          keyframeUrls: multishotKeyframeBlobUrls,
          identityReferenceUrls: undefined,
          productReferenceUrls: undefined,
          motionReferenceUrl,
          motionPrompt: multishotPrompt,
          durationSeconds: requestDuration,
          aspectRatio: "9:16",
          resolution: "720p",
        });
        console.log(
          "[orchestrator][multishot] dropped identity + product refs (already encoded in keyframes) to prevent loose-image bleed",
        );

        const rawSinglePath = join(runDir, "kie-multishot-raw.mp4");
        writeFileSync(rawSinglePath, multishotResult.videoBytes);
        const actualDur = await new Promise<number>((resolve) => {
          ffmpeg.ffprobe(rawSinglePath, (err, data) => {
            if (err) return resolve(0);
            resolve(data.format?.duration ?? 0);
          });
        });
        console.log(
          `[orchestrator][multishot] kie.ai returned ${actualDur.toFixed(2)}s clip (target full template = ${fullDuration.toFixed(2)}s)`,
        );

        // Conform to true template duration (handles +0.04s overshoot from kie.ai)
        const conformedSinglePath = join(runDir, "kie-multishot-conformed.mp4");
        await conformClipDuration({
          inputPath: rawSinglePath,
          outputPath: conformedSinglePath,
          actualDurationSeconds: actualDur,
          targetDurationSeconds: fullDuration,
        });

        // Mux template audio onto the single clip via concatClips (it short-circuits
        // single-input to copyFileSync + handles audio mux)
        updateRun(run_id, {
          status: "concatenating",
          progress_label: "Muxing template audio…",
        });
        const finalPathMs = join(runDir, "output.mp4");
        const templateVideoPathMs = resolve("public", template.video_path);
        await concatClips([conformedSinglePath], finalPathMs, templateVideoPathMs);

        ffmpeg.ffprobe(finalPathMs, (err, data) => {
          if (err) return;
          console.log(
            `[orchestrator][multishot] final mp4 verify — duration=${data.format?.duration}s, streams=${data.streams?.length}`,
          );
        });

        return updateRun(run_id, {
          status: "succeeded",
          video_url: `/runs/${run_id}/output.mp4`,
        });
      }

      // ── per_shot_conform path (default): concat all per-look clips + audio ──
      updateRun(run_id, {
        status: "concatenating",
        progress_label: "Stitching final video…",
      });
      const finalPath = join(runDir, "output.mp4");
      const templateVideoPath = resolve("public", template.video_path);
      await concatClips(clipPaths, finalPath, templateVideoPath);

      // Verify the final output with ffprobe
      ffmpeg.ffprobe(finalPath, (err, data) => {
        if (err) return;
        console.log(
          `[orchestrator] final mp4 verify — duration=${data.format?.duration}s, streams=${data.streams?.length}, nb_frames=${data.streams?.[0]?.nb_frames ?? "n/a"}`,
        );
      });

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
        referenceFaceBytes: input.referenceFaceBytes,
        referenceFaceMimeType: input.referenceFaceMimeType,
        masterSubjectBytes: master?.imageBytes,
        masterSubjectMimeType: master?.mimeType,
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
