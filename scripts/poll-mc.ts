import { config } from "dotenv";
config({ path: ".env.local" });

import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";

const TASK_ID = process.argv[2];
if (!TASK_ID) {
  console.error("usage: tsx scripts/poll-mc.ts <task_id>");
  process.exit(1);
}

function buildJwt(): string {
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
  return data + "." + sig;
}

async function main() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const res = await fetch(`https://api.klingai.com/v1/videos/motion-control/${TASK_ID}`, {
      headers: { Authorization: "Bearer " + buildJwt() },
    });
    const data = await res.json();
    const status = data.data?.task_status ?? data.task_status;
    console.log(`poll ${attempt + 1}/60: HTTP ${res.status} status=${status}`);

    if (status === "succeed" || status === "succeeded") {
      const videoUrl = data.data?.task_result?.videos?.[0]?.url;
      if (!videoUrl) {
        console.error("no video URL in result:", JSON.stringify(data).slice(0, 500));
        process.exit(1);
      }
      console.log("video URL:", videoUrl);
      const videoRes = await fetch(videoUrl);
      const buf = Buffer.from(await videoRes.arrayBuffer());
      writeFileSync("/tmp/motion-control-test.mp4", buf);
      console.log(`saved /tmp/motion-control-test.mp4 (${buf.length} bytes)`);
      return;
    }
    if (status === "failed") {
      console.error("task failed:", JSON.stringify(data).slice(0, 500));
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.error("polling exceeded max attempts");
  process.exit(1);
}

main();
