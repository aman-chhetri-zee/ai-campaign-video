// service/examples/ingest-product.ts
//
// Ingest a product image through Gemini's product-analysis stage and write
// metadata.json + image.png to public/products/<product_id>/.
//
// Run with: npx tsx service/examples/ingest-product.ts <product_id> <input_image_path>

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeProduct } from "../index";

async function main() {
  const [productId, inputImagePath] = process.argv.slice(2);
  if (!productId || !inputImagePath) {
    console.error(
      "usage: ingest-product <product_id> <input_image_path>\n" +
        "  example: ingest-product perfume ./incoming/blue-bottle.jpg",
    );
    process.exit(1);
  }

  const dir = resolve("public/products", productId);
  mkdirSync(dir, { recursive: true });
  const outImagePath = resolve(dir, "image.png");
  const outMetaPath = resolve(dir, "metadata.json");

  if (existsSync(outMetaPath)) {
    console.error(`product ${productId} already has metadata.json — delete to re-ingest`);
    process.exit(1);
  }

  // For non-PNG inputs you'd want to convert via sharp / ffmpeg first; here
  // we assume the file is already a PNG/JPG that Gemini can read.
  const bytes = readFileSync(inputImagePath);
  const mimeType = inputImagePath.toLowerCase().endsWith(".png")
    ? "image/png"
    : "image/jpeg";

  console.log(`analyzing ${productId} (${bytes.length} bytes)...`);
  const metadata = await analyzeProduct({ imageBytes: bytes, mimeType });

  writeFileSync(outImagePath, bytes);
  writeFileSync(outMetaPath, JSON.stringify(metadata, null, 2));

  console.log(`✓ wrote ${outImagePath}`);
  console.log(`✓ wrote ${outMetaPath}`);
  console.log(`primary_item_type: ${metadata.primary_item_type}`);
  console.log(`description: ${metadata.overall_description.slice(0, 200)}`);
}

main().catch((err) => {
  console.error("ingest-product FAILED:", err);
  process.exit(1);
});
