// src/lib/pipeline/ffmpeg.ts
import ffmpeg from "fluent-ffmpeg";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

export async function extractFirstFrame(
  videoPath: string,
  outputPngPath: string,
): Promise<void> {
  await mkdir(dirname(outputPngPath), { recursive: true });
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .frames(1)
      .output(outputPngPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}

/**
 * Extract a single frame at a specific timestamp (in seconds) and write it
 * to outputPngPath. Useful for grabbing per-shot scene references when
 * building custom prompts or doing template inspection.
 */
export async function extractFrameAtTime(
  videoPath: string,
  timestampSeconds: number,
  outputPngPath: string,
): Promise<void> {
  await mkdir(dirname(outputPngPath), { recursive: true });
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(Math.max(0, timestampSeconds))
      .frames(1)
      .output(outputPngPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}
