import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runPipeline } from "../src/lib/pipeline/orchestrator";
import { createRun } from "../src/lib/pipeline/run-store";

async function main() {
  const facePath = resolve("public/creators/ai-model.jpg");
  const faceMimeType = facePath.toLowerCase().endsWith(".jpg") || facePath.toLowerCase().endsWith(".jpeg")
    ? "image/jpeg"
    : "image/png";

  // Test subject_absent state: template-7 (perfume commercial — 4 product-only
  // shots + 1 person shot) + only the tom-ford perfume bottle as product.
  // Should produce: 1 wearing keyframe (creator holds bottle) + 1 product-only
  // keyframe (bottle alone in scene), then a single multishot kie.ai call.
  // template-7 (perfume commercial, mixed subject_states) + creator-3 +
  // free-perfume (vintage ornate bottle — visually distinct from modern
  // fragrance brands, lower IP-filter risk).
  // template-8 (15s closet product review, single outfit slot) + creator-2 +
  // tumbler. Single-outfit single-look case → isSingleOutfit shortcut fires
  // (keyframe + reference_video, no extra refs).
  const run = createRun({
    template_id: "template-8",
    looks: [
      { product_ids: ["tumbler"] },
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
