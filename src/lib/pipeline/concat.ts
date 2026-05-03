// src/lib/pipeline/concat.ts
import ffmpeg from "fluent-ffmpeg";
import { writeFileSync, copyFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Concatenate multiple mp4 clips into one mp4. Optionally mux audio from
 * an external source (e.g., the template video) over the result, looping
 * the audio if it's shorter than the video.
 *
 * If `audioSourcePath` is omitted or has no usable audio, the output is
 * silent (matches Kling's native silent output).
 */
export async function concatClips(
  clipPaths: string[],
  outputPath: string,
  audioSourcePath?: string,
): Promise<void> {
  if (clipPaths.length === 0) throw new Error("concatClips: no clips to concat");

  const wantsAudio = !!audioSourcePath && existsSync(audioSourcePath);

  // Build the intermediate (or final) silent concat path
  const silentPath = wantsAudio
    ? join(tmpdir(), `silent-${Date.now()}.mp4`)
    : outputPath;

  if (clipPaths.length === 1) {
    // Single clip — just copy
    copyFileSync(clipPaths[0], silentPath);
  } else {
    // Multi-clip concat via demuxer
    const listPath = join(tmpdir(), `concat-${Date.now()}.txt`);
    const listContent = clipPaths
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join("\n");
    writeFileSync(listPath, listContent);

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(["-f concat", "-safe 0"])
        .outputOptions([
          "-c:v libx264",
          "-preset veryfast",
          "-crf 23",
          "-an", // strip audio (Kling clips are silent anyway, but be explicit)
          "-movflags +faststart",
        ])
        .output(silentPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });

    try {
      unlinkSync(listPath);
    } catch {}
  }

  if (!wantsAudio) {
    return; // silentPath === outputPath; we're done
  }

  // Stage 2: mux audio from audioSourcePath onto the silent video
  // -stream_loop -1 on the audio input loops it forever; -shortest truncates
  // to the shorter stream (which will be the video).
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(silentPath)
        .input(audioSourcePath!)
        .inputOptions(["-stream_loop -1"]) // applies to LAST input added (the audio source)
        .outputOptions([
          "-c:v copy",
          "-c:a aac",
          "-b:a 192k",
          "-map 0:v:0",
          "-map 1:a:0",
          "-shortest",
          "-movflags +faststart",
        ])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });
  } catch (err) {
    console.warn(
      "[concat] audio mux failed (template may have no audio track); using silent output. Error:",
      (err as Error).message ?? err,
    );
    // Fall back: copy the silent file to the final output path
    copyFileSync(silentPath, outputPath);
  }

  // Clean up intermediate
  try {
    if (silentPath !== outputPath) unlinkSync(silentPath);
  } catch {}
}
