import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { uploadToBlob } from "../src/lib/pipeline/upload";

async function uploadFile(label: string, localPath: string, blobPath: string, mime: string) {
  const bytes = readFileSync(resolve(localPath));
  console.log(`uploading ${label} (${bytes.length} bytes)...`);
  const url = await uploadToBlob(blobPath, bytes, mime);
  console.log(`  -> ${url}`);
  return url;
}

async function main() {
  const t9 = await uploadFile("template-9 video",  "public/templates/template-9/video.mp4",   "templates/template-9/video.mp4",  "video/mp4");
  const t10 = await uploadFile("template-10 video", "public/templates/template-10/video.mp4", "templates/template-10/video.mp4", "video/mp4");
  const watch = await uploadFile("diesel-red-watch", "public/products/diesel-red-watch/image.png", "products/diesel-red-watch/image.png", "image/png");
  const serum = await uploadFile("cetaphil-serum",  "public/products/cetaphil-serum/image.png",  "products/cetaphil-serum/image.png",  "image/png");

  console.log("\n--- env vars ---");
  console.log(`# for template-9 probe:`);
  console.log(`MOTION_REFERENCE_URL_OVERRIDE=${t9}`);
  console.log(`PRODUCT_URL_OVERRIDES={"diesel-red-watch":"${watch}"}`);
  console.log();
  console.log(`# for template-10 probe:`);
  console.log(`MOTION_REFERENCE_URL_OVERRIDE=${t10}`);
  console.log(`PRODUCT_URL_OVERRIDES={"cetaphil-serum":"${serum}"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
