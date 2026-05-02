// scripts/smoke/smoke-stage-2.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeProduct } from "../../src/lib/pipeline/product-analysis";

const VALID_ATTACHMENT = new Set([
  "worn_on_wrist", "worn_on_face", "held_in_hand",
  "carried_on_shoulder", "worn_around_neck", "placed_on_surface",
  "worn_on_torso", "worn_on_legs",
]);

async function main() {
  const path = resolve("public/products/product-1/image.png");
  const buffer = readFileSync(path);

  console.log(`[smoke-2] analyzing ${path}...`);
  const result = await analyzeProduct({ imageBytes: buffer, mimeType: "image/png" });

  console.log("[smoke-2] result:", JSON.stringify(result, null, 2));

  if (!result.primary_item_type) throw new Error("missing primary_item_type");
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error("items array must be non-empty");
  }
  for (const item of result.items) {
    if (!item.item_type) throw new Error(`item missing item_type`);
    if (!VALID_ATTACHMENT.has(item.attachment_strategy)) {
      throw new Error(`invalid attachment_strategy on item: ${item.attachment_strategy}`);
    }
    if (!item.visual_description) throw new Error(`item missing visual_description`);
  }
  if (!result.overall_description) throw new Error("missing overall_description");
  if (!Array.isArray(result.key_features)) throw new Error("key_features not array");

  console.log(`[smoke-2] PASS — found ${result.items.length} item(s) in this product image`);
}

main().catch((err) => { console.error("[smoke-2] FAIL:", err); process.exit(1); });
