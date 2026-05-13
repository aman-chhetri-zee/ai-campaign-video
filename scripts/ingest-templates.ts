// scripts/ingest-templates.ts
//
// For each template dir under public/templates/, run analyzeTemplateVideo
// (Gemini video analysis) to produce metadata.json, and extract first_frame.png.
//
// Note: this script used to also split each template into 4 equal segments
// for the legacy Kling motion-control path. Removed — the current
// kie_seedance multishot_single_call pipeline uses the full video.mp4 as
// the motion reference, so per-shot segments are unused.

import { config } from "dotenv";
config({ path: ".env.local" });

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { extractFirstFrame } from "../src/lib/pipeline/ffmpeg";
import { analyzeTemplateVideo } from "../src/lib/pipeline/template-analysis";

async function main() {
  const root = resolve("public/templates");
  const ids = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const id of ids) {
    const dir = join(root, id);
    const videoPath = join(dir, "video.mp4");
    const framePath = join(dir, "first_frame.png");
    const metaPath = join(dir, "metadata.json");

    if (!existsSync(videoPath)) {
      console.warn(`[ingest-templates] skipping ${id}: no video.mp4`);
      continue;
    }
    if (existsSync(metaPath)) {
      console.log(`[ingest-templates] skipping ${id}: metadata.json exists (delete to re-ingest)`);
      continue;
    }

    console.log(`[ingest-templates] processing ${id}...`);
    if (!existsSync(framePath)) {
      await extractFirstFrame(videoPath, framePath);
      console.log(`  -> extracted first_frame.png`);
    }

    const metadata = await analyzeTemplateVideo({
      videoBytes: readFileSync(videoPath),
      mimeType: "video/mp4",
    });
    writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    console.log(`  -> wrote metadata.json`);
  }
  console.log("[ingest-templates] DONE");
}

main().catch((err) => {
  console.error("[ingest-templates] FAIL:", err);
  process.exit(1);
});
