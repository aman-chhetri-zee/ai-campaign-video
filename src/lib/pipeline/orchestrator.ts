// src/lib/pipeline/orchestrator.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { analyzeReferenceFace } from "./face-analysis";
import { orchestratePrompts } from "./orchestrate";
import { compositeKeyframe } from "./keyframe";
import { judgeKeyframe } from "./judge";
import { generateVideoFromKeyframe } from "./kling";
import { concatClips } from "./concat";
import { updateRun, getRun } from "./run-store";
import type {
  TemplateAsset,
  ProductAsset,
  TemplateMetadata,
  ProductMetadata,
  Look,
} from "./types";

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

function buildProductDescription(p: ProductAsset): string {
  return p.metadata.items.map((it) => it.visual_description).join("; ");
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
}): Promise<{ keyframePath: string; clipPath: string; keyframe_url: string; clip_url: string }> {
  const products = args.look.product_ids.map(loadProduct);

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
    options: { look_index: args.look_index, total_looks: args.total_looks },
  });

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
    });
  }

  const keyframePath = join(args.runDir, `keyframe-${args.look_index}.png`);
  writeFileSync(keyframePath, keyframe.imageBytes);
  const keyframe_url = `/runs/${args.run_id}/keyframe-${args.look_index}.png`;

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

  const video = await generateVideoFromKeyframe({
    keyframeBytes: keyframe.imageBytes,
    keyframeMimeType: keyframe.mimeType,
    motionPrompt: prompts.motion_prompt,
    negativePrompt: prompts.negative_prompt,
    durationSeconds: 5,
    aspectRatio: "9:16",
    poseArchetype,                 // drives camera_control (Path 1)
    motionReferenceVideoPath,      // reference video for Motion Control (Path 2)
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

    // Per-look loop
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
        look: run.looks[i],
        runDir,
      });
      keyframeUrls.push(result.keyframe_url);
      clipUrls.push(result.clip_url);
      clipPaths.push(result.clipPath);
      updateRun(run_id, {
        per_look_keyframe_urls: [...keyframeUrls],
        per_look_clip_urls: [...clipUrls],
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
