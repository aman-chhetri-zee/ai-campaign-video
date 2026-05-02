// scripts/smoke/smoke-stage-2.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeProduct } from "../../src/lib/pipeline/product-analysis";

const VALID_ATTACHMENT = new Set([
  "worn_on_wrist",
  "worn_on_face",
  "held_in_hand",
  "carried_on_shoulder",
  "worn_around_neck",
  "placed_on_surface",
]);

async function main() {
  const path = resolve("public/products/product-1/image.png");
  const buffer = readFileSync(path);

  console.log(`[smoke-2] analyzing ${path}...`);
  const result = await analyzeProduct({
    imageBytes: buffer,
    mimeType: "image/png",
  });

  console.log("[smoke-2] result:", JSON.stringify(result, null, 2));

  if (!result.product_type) throw new Error("missing product_type");
  if (!VALID_ATTACHMENT.has(result.attachment_strategy)) {
    throw new Error(`invalid attachment_strategy: ${result.attachment_strategy}`);
  }
  if (!result.visual_description) throw new Error("missing visual_description");
  if (!Array.isArray(result.key_features)) throw new Error("key_features not array");

  console.log("[smoke-2] PASS");
}

main().catch((err) => {
  console.error("[smoke-2] FAIL:", err);
  process.exit(1);
});
