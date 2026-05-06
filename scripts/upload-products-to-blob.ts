import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { uploadToBlob } from "../src/lib/pipeline/upload";

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("usage: upload-products-to-blob.ts <product_id> [<product_id> ...]");
    process.exit(1);
  }
  const overrides: Record<string, string> = {};
  for (const id of ids) {
    const path = resolve(`public/products/${id}/image.png`);
    const bytes = readFileSync(path);
    console.log(`uploading ${id} (${bytes.length} bytes) ...`);
    const url = await uploadToBlob(`products/${id}/image.png`, bytes, "image/png");
    overrides[id] = url;
    console.log(`  -> ${url}`);
  }
  console.log("");
  console.log("PRODUCT_URL_OVERRIDES=" + JSON.stringify(overrides));
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
