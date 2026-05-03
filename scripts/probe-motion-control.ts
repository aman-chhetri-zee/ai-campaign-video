import { config } from "dotenv";
config({ path: ".env.local" });

import { uploadToBlob } from "../src/lib/pipeline/upload";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";

async function main() {
  const kfBytes = readFileSync(
    resolve("public/runs/run_1777832253604_btm3fa/keyframe-0.png"),
  );
  console.log("uploading keyframe to blob...");
  const kfUrl = await uploadToBlob("probe/kf-" + Date.now() + ".png", kfBytes, "image/png");
  console.log("keyframe URL:", kfUrl.slice(0, 80) + "...");

  const refUrl = "https://ai-campaign-video.vercel.app/templates/template-2/video.mp4";
  console.log("reference URL:", refUrl);

  const ACCESS_KEY = process.env.KLING_ACCESS_KEY!;
  const SECRET_KEY = process.env.KLING_SECRET_KEY!;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { iss: ACCESS_KEY, exp: now + 1800, nbf: now - 5 };
  const data = b64(header) + "." + b64(payload);
  const sig = createHmac("sha256", SECRET_KEY)
    .update(data)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const jwt = data + "." + sig;

  const body = {
    model_name: process.env.KLING_MOTION_CONTROL_MODEL ?? "kling-v2-6",
    image_url: kfUrl,
    video_url: refUrl,
    mode: "pro",
    character_orientation: "image",
    prompt: "Subject performs the motion shown in the reference video.",
    negative_prompt: "blurry",
  };
  console.log("submitting body keys:", Object.keys(body).join(","));
  const res = await fetch("https://api.klingai.com/v1/videos/motion-control", {
    method: "POST",
    headers: { Authorization: "Bearer " + jwt, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log("HTTP", res.status);
  const text = await res.text();
  console.log("response:", text.slice(0, 800));
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
