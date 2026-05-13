// src/lib/pipeline/clip-conform.ts
//
// Conforms a generated clip's duration to a target span by speeding up the
// video (setpts filter) and trimming if the speedup factor would exceed a
// safe ceiling. Used after kie.ai/Seedance returns a 4s clip when the
// template's outfit segment is shorter than that.
//
// Strategy:
//   - If targetSeconds >= actualSeconds: copy as-is (no conform needed)
//   - Else if actualSeconds/targetSeconds <= maxSpeedup: speed-up exactly to fit
//   - Else: speed-up at maxSpeedup cap, then trim the remainder
//
// Output is re-encoded with libx264, yuv420p, faststart so it's drop-in
// compatible with the concat normalization step that follows.

import ffmpeg from "fluent-ffmpeg";
import { copyFileSync } from "node:fs";

export type ConformResult = {
  speedupApplied: number;       // 1.0 = no change, >1 = sped up
  trimmed: boolean;             // true if trim was needed because speedup capped
  finalDurationSeconds: number; // approximate final duration
};

export async function conformClipDuration(args: {
  inputPath: string;
  outputPath: string;            // can equal inputPath; we'll write through a temp internally if so
  actualDurationSeconds: number;
  targetDurationSeconds: number;
  maxSpeedupFactor?: number;     // default 2.5 — beyond this, motion looks too unnatural
  /** When true, carry the input's audio stream through the conform step,
   *  speeding it up by the same factor as the video (atempo) so audio and
   *  video stay in sync. Required for lip-sync clips where Seedance generates
   *  the dialogue audio and stripping it would silence the output. */
  preserveAudio?: boolean;
}): Promise<ConformResult> {
  const maxSpeedup = args.maxSpeedupFactor ?? 2.5;
  const actualDur = args.actualDurationSeconds;
  const targetDur = args.targetDurationSeconds;
  const preserveAudio = args.preserveAudio ?? false;

  // No conform needed: target is already at or beyond actual
  if (targetDur >= actualDur - 0.05) {
    if (args.inputPath !== args.outputPath) {
      copyFileSync(args.inputPath, args.outputPath);
    }
    return { speedupApplied: 1, trimmed: false, finalDurationSeconds: actualDur };
  }

  const naturalSpeedup = actualDur / targetDur;
  const speedup = Math.min(maxSpeedup, naturalSpeedup);
  // setpts factor: a factor < 1 plays back faster (PTS shrinks)
  const setptsFactor = 1 / speedup;
  const expectedAfterSpeedup = actualDur / speedup;
  const trimmed = expectedAfterSpeedup > targetDur + 0.05;

  await new Promise<void>((resolve, reject) => {
    let cmd = ffmpeg(args.inputPath);
    if (preserveAudio) {
      cmd = cmd.complexFilter([
        `[0:v]setpts=${setptsFactor.toFixed(6)}*PTS[v]`,
        `[0:a]atempo=${speedup.toFixed(6)}[a]`,
      ]).outputOptions(["-map", "[v]", "-map", "[a]"]);
    } else {
      cmd = cmd.videoFilters([`setpts=${setptsFactor.toFixed(6)}*PTS`]);
    }
    cmd = cmd
      .videoCodec("libx264")
      .outputOptions([
        "-preset veryfast",
        "-crf 23",
        "-pix_fmt yuv420p",
        ...(preserveAudio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
        "-fflags +genpts",
        "-movflags +faststart",
      ]);
    if (trimmed) {
      cmd = cmd.outputOptions([`-t ${targetDur.toFixed(3)}`]);
    }
    cmd
      .output(args.outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });

  return {
    speedupApplied: speedup,
    trimmed,
    finalDurationSeconds: trimmed ? targetDur : expectedAfterSpeedup,
  };
}
