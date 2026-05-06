import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runPipeline } from "../src/lib/pipeline/orchestrator";
import { createRun } from "../src/lib/pipeline/run-store";

async function main() {
  const facePath = resolve("public/creators/creator-2.jpg");
  const faceMimeType = facePath.toLowerCase().endsWith(".jpg") || facePath.toLowerCase().endsWith(".jpeg")
    ? "image/jpeg"
    : "image/png";

  // template-5 is single-outfit (1 outfit_segment, 9.5s total). 1 keyframe →
  // 1 kie.ai call → 1 clip, audio muxed. No concat.
  const run = createRun({
    template_id: "template-5",
    looks: [
      { product_ids: ["black-top", "skirt", "black-boots", "purse"] },
    ],
    reference_face_path: facePath,
  });

  console.log("=== probe: starting pipeline ===");
  console.log("template:", run.template_id);
  console.log("looks:", JSON.stringify(run.looks));
  console.log("face:", facePath);
  console.log("env: KLING_USE_MOTION_CONTROL =", process.env.KLING_USE_MOTION_CONTROL);
  console.log("env: SKIP_KLING =", process.env.SKIP_KLING);
  console.log("env: BLOB_READ_WRITE_TOKEN =", process.env.BLOB_READ_WRITE_TOKEN ? "<set>" : "<missing>");
  console.log("env: VERCEL_DEPLOYMENT_URL =", process.env.VERCEL_DEPLOYMENT_URL);
  console.log("===");

  const final = await runPipeline(run.run_id, {
    referenceFaceBytes: readFileSync(facePath),
    referenceFaceMimeType: faceMimeType,
  });

  console.log("=== probe: final state ===");
  console.log(JSON.stringify(final, null, 2));
}

main().catch((err) => {
  console.error("probe FAIL:", err);
  process.exit(1);
});
