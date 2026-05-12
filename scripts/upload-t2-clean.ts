import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { uploadToBlob } from "../src/lib/pipeline/upload";

async function main() {
  const path = resolve("public/templates/template-2/video-clean.mp4");
  const bytes = readFileSync(path);
  console.log(`uploading ${bytes.length} bytes...`);
  const url = await uploadToBlob(
    "templates/template-2/video-clean.mp4",
    bytes,
    "video/mp4",
  );
  console.log("URL:", url);
  console.log("\n--- export ---");
  console.log(`MOTION_REFERENCE_URL_OVERRIDE=${url}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
