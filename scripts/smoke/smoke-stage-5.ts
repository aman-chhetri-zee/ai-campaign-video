// scripts/smoke/smoke-stage-5.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractFirstFrame } from "../../src/lib/pipeline/ffmpeg";
import { compositeKeyframe } from "../../src/lib/pipeline/keyframe";

const KEYFRAME_PROMPT_FIXTURE = `
Compose a single still image that recreates the scene and pose shown in IMAGE 1,
but featuring the person from IMAGE 2 (preserving their face exactly), naturally
wearing all the items shown in IMAGE 3.

Framing: a head-and-shoulders to chest-up portrait — the FACE MUST be fully
visible in the frame, not cropped. The shot extends from the top of the head
down to roughly the waistline. Do NOT crop above the chin.

The product look from IMAGE 3 includes the maroon top worn on the torso AND the
black-beaded choker necklace with a small cross pendant worn around the neck,
center front. Both items must be visible and rendered as shown.

The scene's lighting, framing, camera angle, and composition style draw inspiration
from IMAGE 1. Vertical 9:16 aspect ratio.

The face must match IMAGE 2 EXACTLY — same eye shape, same skin tone, same hair,
same distinctive features (nose stud, mole). Do not generate a different face.
Do not stylize the face. Identity preservation is the highest priority.
`.trim();

async function main() {
  const templateVideo = resolve("public/templates/template-1/video.mp4");
  const firstFrame = resolve("public/templates/template-1/first_frame.png");
  await extractFirstFrame(templateVideo, firstFrame);
  console.log(`[smoke-5] extracted first frame to ${firstFrame}`);

  const facePath = resolve(
    "test-fixtures/runs/template-1__product-1__face-A/reference_face.png",
  );
  const necklacePath = resolve("public/products/product-1/image.png");

  const outputPath = resolve(
    "test-fixtures/runs/template-1__product-1__face-A/keyframe.png",
  );

  const productMetadataPath = resolve("public/products/product-1/metadata.json");
  if (!existsSync(productMetadataPath)) {
    throw new Error("product metadata not found — run `npm run ingest:products` first");
  }
  const productMetadata = JSON.parse(readFileSync(productMetadataPath, "utf-8"));
  const productDescription = productMetadata.items
    .map((it: any) => it.visual_description)
    .join("; ");

  console.log("[smoke-5] compositing keyframe (this can take 30-60s)...");
  const result = await compositeKeyframe({
    keyframePrompt: KEYFRAME_PROMPT_FIXTURE,
    templateFirstFrame: { bytes: readFileSync(firstFrame), mimeType: "image/png" },
    referenceFace: { bytes: readFileSync(facePath), mimeType: "image/png" },
    products: [
      {
        bytes: readFileSync(necklacePath),
        mimeType: "image/png",
        description: productDescription,
      },
    ],
  });

  writeFileSync(outputPath, result.imageBytes);
  console.log(`[smoke-5] saved keyframe to ${outputPath} (${result.imageBytes.length} bytes)`);

  if (result.imageBytes.length < 1000) {
    throw new Error("keyframe is suspiciously small");
  }

  console.log("[smoke-5] PASS — IMPORTANT: eyeball the keyframe before committing");
}

main().catch((err) => {
  console.error("[smoke-5] FAIL:", err);
  process.exit(1);
});
