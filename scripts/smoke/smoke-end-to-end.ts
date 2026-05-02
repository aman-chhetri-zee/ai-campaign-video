// scripts/smoke/smoke-end-to-end.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runPipeline } from "../../src/lib/pipeline/orchestrator";
import { createRun } from "../../src/lib/pipeline/run-store";

async function main() {
  const facePath = resolve(
    "test-fixtures/runs/template-1__product-1__face-A/reference_face.png",
  );

  const run = createRun({
    template_id: "template-1",
    product_ids: ["product-1"],
    reference_face_path: facePath,
  });

  console.log("[smoke-e2e] starting pipeline for", run.run_id);
  const final = await runPipeline(run.run_id, {
    referenceFaceBytes: readFileSync(facePath),
    referenceFaceMimeType: "image/png",
  });

  console.log("[smoke-e2e] final state:", JSON.stringify(final, null, 2));

  if (final.status !== "succeeded") {
    throw new Error(`pipeline did not succeed: ${final.status} ${final.error}`);
  }
  if (!final.video_url) throw new Error("missing video_url");
  if (!final.keyframe_url) throw new Error("missing keyframe_url");

  console.log("[smoke-e2e] PASS — video at:", final.video_url);
}

main().catch((err) => {
  console.error("[smoke-e2e] FAIL:", err);
  process.exit(1);
});
