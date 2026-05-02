// src/lib/pipeline/orchestrator.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { analyzeReferenceFace } from "./face-analysis";
import { orchestratePrompts } from "./orchestrate";
import { compositeKeyframe } from "./keyframe";
import { judgeKeyframe } from "./judge";
import { generateVideoFromKeyframe } from "./kling";
import { updateRun, getRun } from "./run-store";
import type {
  TemplateAsset,
  ProductAsset,
  TemplateMetadata,
  ProductMetadata,
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

export async function runPipeline(
  run_id: string,
  input: { referenceFaceBytes: Buffer; referenceFaceMimeType: string },
) {
  try {
    const run = getRun(run_id);
    if (!run) throw new Error(`unknown run_id ${run_id}`);

    const template = loadTemplate(run.template_id);
    const products = run.product_ids.map(loadProduct);

    const runDir = resolve("public/runs", run_id);
    mkdirSync(runDir, { recursive: true });

    // Stage 3 — face analysis
    updateRun(run_id, { status: "analyzing_face" });
    const face = await analyzeReferenceFace({
      imageBytes: input.referenceFaceBytes,
      mimeType: input.referenceFaceMimeType,
    });

    // Stage 4 — orchestration
    updateRun(run_id, { status: "orchestrating" });
    const prompts = await orchestratePrompts({
      template: template.metadata,
      products: products.map((p) => p.metadata),
      face,
    });

    // Stage 5 — keyframe (with judge + retry)
    updateRun(run_id, { status: "compositing_keyframe" });
    const templateFirstFrame = readFileSync(resolve("public", template.first_frame_path));
    const productImages = products.map((p) => ({
      bytes: readFileSync(resolve("public", p.image_path)),
      mimeType: "image/png" as const,
      description: buildProductDescription(p),
    }));

    let keyframe = await compositeKeyframe({
      keyframePrompt: prompts.keyframe_prompt,
      templateFirstFrame: { bytes: templateFirstFrame, mimeType: "image/png" },
      referenceFace: {
        bytes: input.referenceFaceBytes,
        mimeType: input.referenceFaceMimeType,
      },
      products: productImages,
    });

    const judgement = await judgeKeyframe({
      keyframe: { bytes: keyframe.imageBytes, mimeType: keyframe.mimeType },
      referenceFace: {
        bytes: input.referenceFaceBytes,
        mimeType: input.referenceFaceMimeType,
      },
      products: productImages.map((p) => ({ bytes: p.bytes, mimeType: p.mimeType })),
    });

    if (
      !judgement.identity_preserved ||
      !judgement.all_products_present ||
      !judgement.products_correctly_placed
    ) {
      console.warn("[orchestrator] judge flagged issues, retrying once:", judgement.issues);
      const retryPrompt = `${prompts.keyframe_prompt}

CORRECTIONS based on the previous attempt — fix these issues explicitly:
${judgement.issues.map((i) => `- ${i}`).join("\n")}`;
      keyframe = await compositeKeyframe({
        keyframePrompt: retryPrompt,
        templateFirstFrame: { bytes: templateFirstFrame, mimeType: "image/png" },
        referenceFace: {
          bytes: input.referenceFaceBytes,
          mimeType: input.referenceFaceMimeType,
        },
        products: productImages,
      });
    }

    const keyframePath = join(runDir, "composite_keyframe.png");
    writeFileSync(keyframePath, keyframe.imageBytes);
    const keyframe_url = `/runs/${run_id}/composite_keyframe.png`;
    updateRun(run_id, { keyframe_url });

    // Stage 6 — Kling
    updateRun(run_id, { status: "generating_video" });
    const video = await generateVideoFromKeyframe({
      keyframeBytes: keyframe.imageBytes,
      keyframeMimeType: keyframe.mimeType,
      motionPrompt: prompts.motion_prompt,
      negativePrompt: prompts.negative_prompt,
      durationSeconds: 5,
      aspectRatio: "9:16",
    });

    const videoPath = join(runDir, "output.mp4");
    writeFileSync(videoPath, video.videoBytes);
    const video_url = `/runs/${run_id}/output.mp4`;

    return updateRun(run_id, { status: "succeeded", video_url });
  } catch (err: any) {
    return updateRun(run_id, {
      status: "failed",
      error: err.message ?? String(err),
    });
  }
}
