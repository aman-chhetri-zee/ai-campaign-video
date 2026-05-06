import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runPipeline } from "../src/lib/pipeline/orchestrator";
import { createRun } from "../src/lib/pipeline/run-store";

async function main() {
  // AI-generated model (avoids Seedance's privacy filter on real-person photos)
  const facePath = resolve("public/creators/creator-1.jpeg");
  const faceMimeType = facePath.toLowerCase().endsWith(".jpg") || facePath.toLowerCase().endsWith(".jpeg")
    ? "image/jpeg"
    : "image/png";

  const run = createRun({
    template_id: "template-1",
    looks: [
      // Four distinct outfits — each full-body (top + bottom + footwear, sometimes a bag)
      { product_ids: ["black-top", "skirt", "black-boots"] },                    // monochrome elegant, no bag
      { product_ids: ["blue-tshirt", "baggy-jeans", "sneakers", "purse"] },      // casual streetwear with handbag
      { product_ids: ["black-top", "baggy-jeans", "black-boots", "satchel-bag"] }, // edgy with shoulder satchel
      { product_ids: ["blue-tshirt", "skirt", "sneakers"] },                     // playful, no bag
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
