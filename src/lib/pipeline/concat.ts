// src/lib/pipeline/concat.ts
import ffmpeg from "fluent-ffmpeg";
import { copyFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Concatenate multiple mp4 clips into one mp4 with normalized streams so the
 * final output has a clean continuous PTS/DTS timeline (no scrub-reset bug).
 *
 * Process:
 *   1. Normalize each input clip to canonical format (1080x1920, 30fps, yuv420p,
 *      libx264 + aac if present, SAR 1:1).
 *   2. Use concat filter (re-encode) to assemble the final timeline.
 *   3. Add genpts + faststart so the file is seekable and streamable.
 *
 * Optionally mux audio from `audioSourcePath` over the final video.
 */
export async function concatClips(
  clipPaths: string[],
  outputPath: string,
  audioSourcePath?: string,
): Promise<void> {
  if (clipPaths.length === 0) throw new Error("concatClips: no clips");

  mkdirSync(dirname(outputPath), { recursive: true });
  const wantsAudio = !!audioSourcePath && existsSync(audioSourcePath);

  // Step 1: normalize each clip to canonical format (silent — we'll mux audio after)
  const tmpRoot = join(tmpdir(), `concat-norm-${Date.now()}`);
  mkdirSync(tmpRoot, { recursive: true });
  const normalized: string[] = [];

  for (let i = 0; i < clipPaths.length; i++) {
    const out = join(tmpRoot, `norm-${i}.mp4`);
    await new Promise<void>((resolve, reject) => {
      ffmpeg(clipPaths[i])
        .videoFilters([
          "scale=1080:1920:force_original_aspect_ratio=decrease",
          "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
          "setsar=1",
          "fps=30",
        ])
        .videoCodec("libx264")
        .outputOptions([
          "-preset veryfast",
          "-crf 23",
          "-pix_fmt yuv420p",
          "-an",
          "-fflags +genpts",
          "-movflags +faststart",
        ])
        .output(out)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });
    normalized.push(out);
  }

  // Step 2: concat filter (re-encodes the normalized clips into one timeline)
  // For a single clip, skip the filter graph and just copy the normalized file.
  const silentPath = wantsAudio ? join(tmpRoot, "silent-final.mp4") : outputPath;

  if (normalized.length === 1) {
    copyFileSync(normalized[0], silentPath);
  } else {
    const concatFilter =
      normalized.map((_, i) => `[${i}:v:0]`).join("") +
      `concat=n=${normalized.length}:v=1:a=0[outv]`;

    await new Promise<void>((resolve, reject) => {
      let cmd = ffmpeg();
      for (const n of normalized) cmd = cmd.input(n);
      cmd
        .complexFilter(concatFilter, ["outv"])
        .videoCodec("libx264")
        .outputOptions([
          "-preset veryfast",
          "-crf 23",
          "-pix_fmt yuv420p",
          "-fflags +genpts",
          "-movflags +faststart",
          "-an",
        ])
        .output(silentPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });
  }

  // Step 3: optional audio mux
  if (wantsAudio) {
    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(silentPath)
          .input(audioSourcePath!)
          .inputOptions(["-stream_loop -1"])
          .outputOptions([
            "-c:v copy",
            "-c:a aac",
            "-b:a 192k",
            "-map 0:v:0",
            "-map 1:a:0",
            "-shortest",
            "-fflags +genpts",
            "-movflags +faststart",
          ])
          .output(outputPath)
          .on("end", () => resolve())
          .on("error", (err) => reject(err))
          .run();
      });
    } catch (err) {
      console.warn("[concat] audio mux failed; copying silent output:", (err as Error).message);
      copyFileSync(silentPath, outputPath);
    }
  }

  // cleanup
  try {
    for (const f of normalized) if (existsSync(f)) unlinkSync(f);
    if (silentPath !== outputPath && existsSync(silentPath)) unlinkSync(silentPath);
  } catch {}
}
