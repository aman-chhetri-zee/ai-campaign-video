import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { uploadToBlob } from "../src/lib/pipeline/upload";

async function main() {
  const tplPath = resolve("public/templates/template-7/video.mp4");
  const tplBytes = readFileSync(tplPath);
  console.log(`uploading template-7/video.mp4 (${tplBytes.length} bytes)...`);
  const tplUrl = await uploadToBlob(
    "templates/template-7/video.mp4",
    tplBytes,
    "video/mp4",
  );
  console.log("TEMPLATE-7 URL:", tplUrl);

  const prodPath = resolve("public/products/tom-ford/image.png");
  const prodBytes = readFileSync(prodPath);
  console.log(`uploading products/tom-ford/image.png (${prodBytes.length} bytes)...`);
  const prodUrl = await uploadToBlob(
    "products/tom-ford/image.png",
    prodBytes,
    "image/png",
  );
  console.log("TOM-FORD URL:", prodUrl);

  console.log("\n--- env vars to set ---");
  console.log(`MOTION_REFERENCE_URL_OVERRIDE=${tplUrl}`);
  console.log(`PRODUCT_URL_OVERRIDES={"tom-ford":"${prodUrl}"}`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
