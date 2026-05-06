import { resolve } from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { concatClips } from "../src/lib/pipeline/concat";

async function main() {
  const runDir = resolve("public/runs/run_1777986623380_buquvn");
  const clips = [0, 1, 2].map((i) => resolve(runDir, `clip-${i}.mp4`));
  const outPath = resolve(runDir, "output.mp4");
  const audioSource = resolve("public/templates/template-2/video.mp4");

  console.log("=== concat-partial ===");
  console.log("clips:", clips);
  console.log("out:", outPath);
  console.log("audio source:", audioSource);

  await concatClips(clips, outPath, audioSource);

  // Verify the output
  await new Promise<void>((res) => {
    ffmpeg.ffprobe(outPath, (err, data) => {
      if (err) {
        console.error("ffprobe err:", err);
      } else {
        console.log("=== final mp4 verify ===");
        console.log("duration:", data.format?.duration, "s");
        console.log("size:", data.format?.size, "bytes");
        for (const s of data.streams ?? []) {
          console.log(`  stream[${s.index}]: ${s.codec_type} / ${s.codec_name} / ${s.codec_type === "video" ? `${s.width}x${s.height}@${s.r_frame_rate}` : `${s.sample_rate}Hz/${s.channels}ch`} / nb_frames=${s.nb_frames}`);
        }
      }
      res();
    });
  });

  console.log("\nopen:", outPath);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
