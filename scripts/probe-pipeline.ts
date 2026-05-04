import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runPipeline } from "../src/lib/pipeline/orchestrator";
import { createRun } from "../src/lib/pipeline/run-store";

async function main() {
  const facePath = resolve(
    "test-fixtures/runs/template-1__product-1__face-A/reference_face.png",
  );

  const run = createRun({
    template_id: "template-3",
    looks: [
      // Single look — product-1 (maroon top + necklace + jeans as one outfit)
      { product_ids: ["product-1"] },
    ],
    reference_face_path: facePath,
  });

  console.log("=== probe: starting pipeline ===");
  console.log("template:", run.template_id);
  console.log("looks:", JSON.stringify(run.looks));
  console.log("face:", facePath);
  console.log("env: KLING_USE_MOTION_CONTROL =", process.env.KLING_USE_MOTION_CONTROL);
  console.log("env: BLOB_READ_WRITE_TOKEN =", process.env.BLOB_READ_WRITE_TOKEN ? "<set>" : "<missing>");
  console.log("env: VERCEL_DEPLOYMENT_URL =", process.env.VERCEL_DEPLOYMENT_URL);
  console.log("===");

  const final = await runPipeline(run.run_id, {
    referenceFaceBytes: readFileSync(facePath),
    referenceFaceMimeType: "image/png",
  });

  console.log("=== probe: final state ===");
  console.log(JSON.stringify(final, null, 2));
}

main().catch((err) => {
  console.error("probe FAIL:", err);
  process.exit(1);
});
