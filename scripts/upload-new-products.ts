import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { uploadToBlob } from "../src/lib/pipeline/upload";

const NEW_PRODUCTS = [
  "black-dress",
  "gucci-skirt",
  "silk-pant",
  "silk-shirt",
  "tom-ford-sandal",
  "top",
];

async function main() {
  const overrides: Record<string, string> = {};
  for (const id of NEW_PRODUCTS) {
    const path = resolve(`public/products/${id}/image.png`);
    const bytes = readFileSync(path);
    console.log(`uploading ${id} (${bytes.length} bytes)...`);
    const url = await uploadToBlob(
      `products/${id}/image.png`,
      bytes,
      "image/png",
    );
    overrides[id] = url;
    console.log(`  -> ${url}`);
  }

  console.log("\n--- PRODUCT_URL_OVERRIDES (single line) ---");
  console.log(`PRODUCT_URL_OVERRIDES=${JSON.stringify(overrides)}`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
