// Recover a kie.ai task that was submitted but whose poll loop died on
// a transient fetch failed. Polls until success, downloads the video to
// the existing run dir, and runs conform+concat with preserveAudio.
import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { conformClipDuration } from "../src/lib/pipeline/clip-conform";
import { concatClips } from "../src/lib/pipeline/concat";

const TASK_ID = process.env.KIE_TASK_ID || "55ff22b8620a6bfc5edc6c7aae9f1b66";
const RUN_ID = process.env.RUN_ID || "run_1778579103175_uzvk78";
const TARGET_DURATION = Number(process.env.TARGET_DURATION || "15");
const PRESERVE_AUDIO = (process.env.PRESERVE_AUDIO ?? "true") === "true";

const KIE_BASE = process.env.KIE_API_BASE || "https://api.kie.ai";
const KIE_KEY = process.env.KIE_API_KEY!;

async function fetchKie(path: string) {
  const r = await fetch(`${KIE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${KIE_KEY}`, "Content-Type": "application/json" },
  });
  return r.json();
}

async function main() {
  const runDir = resolve("public/runs", RUN_ID);
  if (!existsSync(runDir)) throw new Error(`run dir missing: ${runDir}`);

  console.log(`Polling kie.ai task ${TASK_ID}…`);
  let videoUrl: string | undefined;
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const j: any = await fetchKie(`/api/v1/jobs/recordInfo?taskId=${TASK_ID}`);
    const state = j?.data?.state;
    console.log(`  poll ${i + 1}/240: state=${state}`);
    if (state === "success") {
      const rj = j.data.resultJson;
      try {
        videoUrl = JSON.parse(rj).resultUrls?.[0];
      } catch {}
      if (!videoUrl) throw new Error(`success but no videoUrl: ${rj}`);
      break;
    }
    if (state === "fail") throw new Error(`task failed: ${j.data.failMsg}`);
  }
  if (!videoUrl) throw new Error("polling exceeded");

  console.log(`Downloading ${videoUrl}…`);
  const videoBytes = Buffer.from(await (await fetch(videoUrl)).arrayBuffer());
  const rawPath = join(runDir, "kie-multishot-raw.mp4");
  writeFileSync(rawPath, videoBytes);
  console.log(`  -> ${rawPath} (${videoBytes.length} bytes)`);

  const actualDur = await new Promise<number>((res) => {
    ffmpeg.ffprobe(rawPath, (err, data) => res(err ? 0 : data.format?.duration ?? 0));
  });
  console.log(`Raw duration: ${actualDur.toFixed(2)}s, target: ${TARGET_DURATION}s, preserveAudio: ${PRESERVE_AUDIO}`);

  const conformedPath = join(runDir, "kie-multishot-conformed.mp4");
  await conformClipDuration({
    inputPath: rawPath,
    outputPath: conformedPath,
    actualDurationSeconds: actualDur,
    targetDurationSeconds: TARGET_DURATION,
    preserveAudio: PRESERVE_AUDIO,
  });
  console.log(`  -> ${conformedPath}`);

  const outputPath = join(runDir, "output.mp4");
  await concatClips([conformedPath], outputPath, undefined, PRESERVE_AUDIO);
  console.log(`  -> ${outputPath}`);

  await new Promise<void>((res) => {
    ffmpeg.ffprobe(outputPath, (err, data) => {
      if (!err) {
        console.log(`Final mp4 verify: duration=${data.format?.duration}s, streams=${data.streams?.length}`);
      }
      res();
    });
  });
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
