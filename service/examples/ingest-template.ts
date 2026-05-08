// service/examples/ingest-template.ts
//
// Ingest a template video: extracts the first frame, runs Gemini analysis to
// produce metadata.json (scene_description, motion_script, shot_backgrounds,
// etc.), and trims 4 equal segment slices for legacy Kling motion-control
// fallback. Then prompts you to declare outfit_segments[] manually — the
// pipeline cannot infer outfit slot boundaries on its own.
//
// Run with: npx tsx service/examples/ingest-template.ts <template_id> <input_video_path>

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  analyzeTemplateVideo,
  extractFirstFrame,
  type TemplateMetadata,
} from "../index";

async function main() {
  const [templateId, inputVideoPath] = process.argv.slice(2);
  if (!templateId || !inputVideoPath) {
    console.error(
      "usage: ingest-template <template_id> <input_video_path>\n" +
        "  example: ingest-template template-9 ./incoming/montage.mp4",
    );
    process.exit(1);
  }

  const dir = resolve("public/templates", templateId);
  mkdirSync(dir, { recursive: true });
  const videoPath = join(dir, "video.mp4");
  const framePath = join(dir, "first_frame.png");
  const metaPath = join(dir, "metadata.json");

  if (existsSync(metaPath)) {
    console.error(`template ${templateId} already has metadata.json — delete to re-ingest`);
    process.exit(1);
  }

  // Copy the input video into the template directory (Vercel-compatible layout).
  const videoBytes = readFileSync(inputVideoPath);
  writeFileSync(videoPath, videoBytes);
  console.log(`✓ wrote ${videoPath}`);

  // Extract first_frame.png — used as the scene reference for keyframes.
  await extractFirstFrame(videoPath, framePath);
  console.log(`✓ wrote ${framePath}`);

  // Gemini reverse-engineers the metadata.
  console.log(`analyzing ${templateId} (${videoBytes.length} bytes)...`);
  const metadata: TemplateMetadata = await analyzeTemplateVideo({
    videoBytes,
    mimeType: "video/mp4",
  });

  writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
  console.log(`✓ wrote ${metaPath}`);

  console.log("");
  console.log("⚠️  outfit_segments was NOT auto-populated.");
  console.log(
    `Open ${metaPath} and append an outfit_segments[] array describing the outfit slots. Examples:`,
  );
  console.log(`  - Single-outfit (model walk, product review): one slot covering all shots`);
  console.log(`  - Multi-outfit (try-on / lookbook): one slot per outfit change`);
  console.log(
    `  - Ad-style with product-only shots: declare subject_states with "absent" for product hero shots`,
  );
  console.log("");
  console.log(
    "Without outfit_segments, the pipeline falls back to a single full-template segment.",
  );
}

main().catch((err) => {
  console.error("ingest-template FAILED:", err);
  process.exit(1);
});
