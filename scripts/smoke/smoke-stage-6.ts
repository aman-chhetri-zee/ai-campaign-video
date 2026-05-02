// scripts/smoke/smoke-stage-6.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateVideoFromKeyframe } from "../../src/lib/pipeline/kling";

const MOTION_PROMPT_FIXTURE =
  "Subject smiles softly and tilts head slightly. Camera slowly pushes in from medium-close to closeup over 5 seconds. Natural facial expression changes, hair moves subtly with breeze.";

const NEGATIVE_PROMPT_FIXTURE =
  "blurry face, distorted hands, deformed limbs, extra fingers, missing necklace, floating objects, face morphing, identity drift, warped product";

async function main() {
  const keyframe = readFileSync(
    resolve("test-fixtures/runs/template-1__product-1__face-A/keyframe.png"),
  );
  const outputPath = resolve(
    "test-fixtures/runs/template-1__product-1__face-A/output.mp4",
  );

  console.log("[smoke-6] generating video... this may take 30-120 seconds");
  const result = await generateVideoFromKeyframe({
    keyframeBytes: keyframe,
    keyframeMimeType: "image/png",
    motionPrompt: MOTION_PROMPT_FIXTURE,
    negativePrompt: NEGATIVE_PROMPT_FIXTURE,
    durationSeconds: 5,
    aspectRatio: "9:16",
  });

  writeFileSync(outputPath, result.videoBytes);
  console.log(`[smoke-6] saved video to ${outputPath} (${result.videoBytes.length} bytes)`);

  if (result.videoBytes.length < 50_000) {
    throw new Error("video is suspiciously small");
  }

  console.log("[smoke-6] PASS — eyeball the video at the path above");
}

main().catch((err) => {
  console.error("[smoke-6] FAIL:", err);
  process.exit(1);
});
