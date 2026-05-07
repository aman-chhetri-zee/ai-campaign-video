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
