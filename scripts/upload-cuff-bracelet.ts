import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { uploadToBlob } from "../src/lib/pipeline/upload";

async function main() {
  const bytes = readFileSync(resolve("public/products/cuff-bracelet/image.png"));
  console.log(`uploading ${bytes.length} bytes...`);
  const url = await uploadToBlob("products/cuff-bracelet/image.png", bytes, "image/png");
  console.log(`URL: ${url}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
