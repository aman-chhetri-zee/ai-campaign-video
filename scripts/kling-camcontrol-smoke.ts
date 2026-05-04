import { config } from "dotenv";
config({ path: ".env.local" });
process.env.KLING_MODEL_ID = "kling-v1-6";

import { generateVideoFromKeyframe } from "../src/lib/pipeline/kling";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const keyframe = readFileSync(
    resolve(
      "test-fixtures/runs/template-1__product-1__face-A/keyframe.png",
    ),
  );

  const result = await generateVideoFromKeyframe({
    keyframeBytes: keyframe,
    keyframeMimeType: "image/png",
    motionPrompt: "Subject leans toward camera with a confident smolder.",
    negativePrompt: "blurry, distorted",
    durationSeconds: 5,
    aspectRatio: "9:16",
    poseArchetype: "confident",
  });

  console.log("OK", result.videoBytes.length, "bytes", "url=", result.videoUrl);
  writeFileSync("/tmp/kling-camcontrol-test.mp4", result.videoBytes);
  console.log("saved /tmp/kling-camcontrol-test.mp4");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
