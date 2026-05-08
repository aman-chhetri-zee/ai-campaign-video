// service/examples/generate-video.ts
//
// End-to-end generation example. Given a template_id, an array of looks
// (each look = an outfit = a list of product_ids), and a reference face
// image, runs the full pipeline and writes output.mp4 to public/runs/<run_id>/.
//
// Prerequisites:
//   - The template referenced by template_id must already be ingested
//     (public/templates/<template_id>/{video.mp4, first_frame.png, metadata.json})
//   - All product_ids referenced by the looks must already be ingested
//     (public/products/<id>/{image.png, metadata.json})
//   - All required env vars are set (see service/.env.example)
//
// Run with: npx tsx service/examples/generate-video.ts

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRun, runPipeline, getRun } from "../index";

async function main() {
  const facePath = resolve("public/creators/creator-1.jpeg");
  const faceMimeType = facePath.toLowerCase().endsWith(".jpg") || facePath.toLowerCase().endsWith(".jpeg")
    ? "image/jpeg"
    : "image/png";

  // 1. Initialize the run state. createRun returns a run_id you'll use to
  //    poll status throughout the run.
  const run = createRun({
    template_id: "template-2",
    looks: [
      { product_ids: ["black-top", "skirt", "black-boots"] },
      { product_ids: ["blue-tshirt", "baggy-jeans", "sneakers", "purse"] },
      { product_ids: ["black-top", "baggy-jeans", "black-boots", "satchel-bag"] },
    ],
    reference_face_path: facePath,
  });

  console.log(`starting run ${run.run_id}`);

  // 2. Kick off the pipeline. runPipeline updates the run-store as it
  //    progresses through stages (analyzing_face, orchestrating,
  //    compositing_keyframe, generating_video, concatenating, succeeded).
  //
  //    In a backend service you'd typically not await this — fire it
  //    off in the background and return run.run_id to your client, who
  //    polls /runs/:id for status.
  const final = await runPipeline(run.run_id, {
    referenceFaceBytes: readFileSync(facePath),
    referenceFaceMimeType: faceMimeType,
  });

  console.log("run state:", JSON.stringify(final, null, 2));

  // 3. Read back the final state. video_url is relative to public/.
  const state = getRun(run.run_id);
  if (state?.status === "succeeded" && state.video_url) {
    console.log(`✓ output: public${state.video_url}`);
  } else {
    console.error(`✗ run ${run.run_id} did not succeed:`, state?.error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("generate-video FAILED:", err);
  process.exit(1);
});
