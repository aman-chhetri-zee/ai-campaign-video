// scripts/ingest-templates.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { extractFirstFrame } from "../src/lib/pipeline/ffmpeg";
import { analyzeTemplateVideo } from "../src/lib/pipeline/template-analysis";

const SEGMENT_COUNT = 4;

async function trimSegments(
  videoPath: string,
  outputDir: string,
  segmentCount: number = SEGMENT_COUNT,
): Promise<void> {
  // Check if all segments already exist (idempotent)
  const allExist = Array.from({ length: segmentCount }, (_, i) =>
    existsSync(join(outputDir, `segment-${i}.mp4`)),
  ).every(Boolean);
  if (allExist) {
    console.log(`  -> segments already exist, skipping`);
    return;
  }

  // Probe duration
  const duration = await new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err) return reject(err);
      const dur = data.format?.duration;
      if (typeof dur !== "number") return reject(new Error("no duration in probe"));
      resolve(dur);
    });
  });

  const segDuration = duration / segmentCount;
  for (let i = 0; i < segmentCount; i++) {
    const start = i * segDuration;
    const out = join(outputDir, `segment-${i}.mp4`);
    if (existsSync(out)) {
      console.log(`  -> segment-${i}.mp4 already exists, skipping`);
      continue;
    }
    await new Promise<void>((res, rej) => {
      ffmpeg(videoPath)
        .setStartTime(start)
        .setDuration(segDuration)
        .videoCodec("libx264")
        .audioCodec("aac")
        .outputOptions(["-preset veryfast", "-crf 23", "-pix_fmt yuv420p", "-movflags +faststart"])
        .output(out)
        .on("end", () => res())
        .on("error", (err) => rej(err))
        .run();
    });
    console.log(`  -> wrote segment-${i}.mp4 (${start.toFixed(1)}s–${(start + segDuration).toFixed(1)}s)`);
  }
}

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
      // Still generate segments even if metadata exists (segments may be missing)
      console.log(`[ingest-templates] checking segments for ${id}...`);
      await trimSegments(videoPath, dir, SEGMENT_COUNT);
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

    // Split into segments for per-look motion reference
    await trimSegments(videoPath, dir, SEGMENT_COUNT);
  }
  console.log("[ingest-templates] DONE");
}

main().catch((err) => {
  console.error("[ingest-templates] FAIL:", err);
  process.exit(1);
});
