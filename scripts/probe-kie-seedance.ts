import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { uploadToBlob } from "../src/lib/pipeline/upload";

const KIE_API_BASE = "https://api.kie.ai";
const KIE_API_KEY = process.env.KIE_API_KEY!;
const TEMPLATE_VIDEO_URL = "https://ai-campaign-video.vercel.app/templates/template-2/video.mp4";
const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_ATTEMPTS = 180; // 15 min wall clock cap

if (!KIE_API_KEY) {
  console.error("KIE_API_KEY missing from .env.local");
  process.exit(1);
}

async function fetchJson(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${KIE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KIE_API_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { _rawText: text }; }
  return { status: res.status, json };
}

async function main() {
  console.log("=== Phase 0 probe: kie.ai bytedance/seedance-2 with face-bearing reference ===");

  // 1. Upload creator-1.jpeg to Vercel Blob → public HTTPS
  const facePath = resolve("public/creators/creator-1.jpeg");
  const faceBytes = readFileSync(facePath);
  console.log(`uploading creator-1.jpeg (${faceBytes.length} bytes) to Vercel Blob...`);
  const faceUrl = await uploadToBlob("kie-probe/face-" + Date.now() + ".jpg", faceBytes, "image/jpeg");
  console.log("face URL:", faceUrl.slice(0, 80) + "...");
  console.log("template URL:", TEMPLATE_VIDEO_URL);

  // 2. Build request body — multimodal video-input mode at 720p
  const body = {
    model: "bytedance/seedance-2",
    input: {
      prompt: "A young south asian woman walks through a doorway and turns to look at the camera with a confident expression. Natural daylight, modern home setting.",
      reference_image_urls: [faceUrl],
      reference_video_urls: [TEMPLATE_VIDEO_URL],
      resolution: "720p",
      aspect_ratio: "9:16",
      duration: 5,
      generate_audio: false,
      nsfw_checker: false,
    },
  };
  console.log("");
  console.log("=== submitting task ===");
  console.log("body keys:", Object.keys(body), "input keys:", Object.keys(body.input));

  // 3. Submit
  const submit = await fetchJson("/api/v1/jobs/createTask", {
    method: "POST",
    body: JSON.stringify(body),
  });
  console.log(`HTTP ${submit.status}, response:`, JSON.stringify(submit.json).slice(0, 600));

  if (submit.status !== 200 || !submit.json?.data?.taskId) {
    console.error("");
    console.error("=== SUBMIT FAILED — verdict below ===");
    if (JSON.stringify(submit.json).includes("InputImage") || JSON.stringify(submit.json).includes("InputVideo") || JSON.stringify(submit.json).toLowerCase().includes("real person") || JSON.stringify(submit.json).toLowerCase().includes("sensitive")) {
      console.error("VERDICT: kie.ai applies BytePlus face content filter — same wall as direct API");
    } else {
      console.error("VERDICT: submit failed for some other reason — see response above");
    }
    process.exit(1);
  }

  const taskId = submit.json.data.taskId;
  console.log(`\ntask submitted: ${taskId}`);
  console.log("");
  console.log("=== polling ===");

  // 4. Poll
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await fetchJson(`/api/v1/jobs/recordInfo?taskId=${taskId}`);
    const state = poll.json?.data?.state;
    const failMsg = poll.json?.data?.failMsg;
    console.log(`poll ${attempt + 1}/${POLL_MAX_ATTEMPTS}: state=${state}${failMsg ? " failMsg=" + failMsg.slice(0, 150) : ""}`);

    if (state === "success") {
      const resultJsonStr = poll.json?.data?.resultJson;
      let videoUrl: string | undefined;
      try {
        const parsed = JSON.parse(resultJsonStr);
        videoUrl = parsed?.resultUrls?.[0];
      } catch (e) {
        console.error("couldnt parse resultJson:", resultJsonStr?.slice?.(0, 300));
      }
      if (!videoUrl) {
        console.error("VERDICT: succeeded but no video URL in result. Full data:", JSON.stringify(poll.json).slice(0, 600));
        process.exit(1);
      }
      console.log("");
      console.log("=== SUCCESS — downloading video ===");
      console.log("video URL:", videoUrl.slice(0, 150) + "...");
      const videoRes = await fetch(videoUrl);
      if (!videoRes.ok) {
        console.error(`download HTTP ${videoRes.status}`);
        process.exit(1);
      }
      const buf = Buffer.from(await videoRes.arrayBuffer());
      const outPath = "/tmp/kie-probe.mp4";
      writeFileSync(outPath, buf);
      console.log(`saved ${outPath} (${buf.length} bytes)`);
      console.log("");
      console.log("=== VERDICT: kie.ai ACCEPTS face content — full integration is viable ===");
      return;
    }

    if (state === "fail") {
      console.error("");
      console.error("=== TASK FAILED — verdict below ===");
      console.error("failCode:", poll.json?.data?.failCode);
      console.error("failMsg:", failMsg);
      const msg = String(failMsg ?? "").toLowerCase();
      if (msg.includes("real person") || msg.includes("sensitive") || msg.includes("inputimage") || msg.includes("inputvideo")) {
        console.error("VERDICT: kie.ai applies BytePlus face content filter — same wall as direct API");
      } else {
        console.error("VERDICT: failed for some other reason — see message above");
      }
      process.exit(1);
    }

    // states: waiting, queuing, generating — keep polling
  }

  console.error("polling exceeded max attempts");
  process.exit(1);
}

main().catch((err) => {
  console.error("probe FAIL:", err);
  process.exit(1);
});
