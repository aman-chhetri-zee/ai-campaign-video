import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { uploadToBlob } from "../src/lib/pipeline/upload";

async function main() {
  const path = resolve("public/templates/template-6/video.mp4");
  const bytes = readFileSync(path);
  console.log(`uploading ${bytes.length} bytes to Vercel Blob...`);
  const url = await uploadToBlob(
    "templates/template-6/video.mp4",
    bytes,
    "video/mp4",
  );
  console.log("URL:", url);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
