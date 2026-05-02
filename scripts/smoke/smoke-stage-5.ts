// scripts/smoke/smoke-stage-5.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractFirstFrame } from "../../src/lib/pipeline/ffmpeg";
import { compositeKeyframe } from "../../src/lib/pipeline/keyframe";

const KEYFRAME_PROMPT_FIXTURE = `
Compose a single still image that recreates the scene and pose shown in IMAGE 1,
but featuring the person from IMAGE 2 (preserving their face exactly), naturally
wearing the product from IMAGE 3.

The product from IMAGE 3 — a double-strand black-beaded choker necklace with a
small black cross pendant — is worn around the neck, center, with the pendant
clearly visible at the front of the neck.

The scene's lighting, framing, camera angle, and composition style must match
IMAGE 1 verbatim. Vertical 9:16 aspect ratio.

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

  console.log("[smoke-5] compositing keyframe (this can take 30-60s)...");
  const result = await compositeKeyframe({
    keyframePrompt: KEYFRAME_PROMPT_FIXTURE,
    templateFirstFrame: { bytes: readFileSync(firstFrame), mimeType: "image/png" },
    referenceFace: { bytes: readFileSync(facePath), mimeType: "image/png" },
    products: [
      { bytes: readFileSync(necklacePath), mimeType: "image/png" },
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
