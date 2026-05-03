// src/lib/pipeline/concat.ts
import ffmpeg from "fluent-ffmpeg";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Concatenate multiple mp4 clips into one mp4 with hard cuts.
 * Re-encodes to ensure all clips have compatible streams (Kling clips
 * may have slightly different metadata).
 */
export async function concatClips(
  clipPaths: string[],
  outputPath: string,
): Promise<void> {
  if (clipPaths.length === 0) throw new Error("concatClips: no clips to concat");
  if (clipPaths.length === 1) {
    // single clip — just copy
    const { copyFileSync } = await import("node:fs");
    copyFileSync(clipPaths[0], outputPath);
    return;
  }

  // Write a concat list file in /tmp
  const listPath = join(tmpdir(), `concat-${Date.now()}.txt`);
  const listContent = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  writeFileSync(listPath, listContent);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions([
        "-c:v libx264",
        "-preset veryfast",
        "-crf 23",
        "-c:a aac",
        "-b:a 128k",
        "-movflags +faststart",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}
