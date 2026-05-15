import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { uploadToBlob } from "../src/lib/pipeline/upload";

async function main() {
  const bytes = readFileSync(resolve("public/templates/biryani-template/video-240p.mp4"));
  console.log(`uploading ${bytes.length} bytes...`);
  const url = await uploadToBlob("templates/biryani-template/video-240p.mp4", bytes, "video/mp4");
  console.log(`URL: ${url}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
