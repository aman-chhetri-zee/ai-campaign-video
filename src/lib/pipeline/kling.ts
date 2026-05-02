// src/lib/pipeline/kling.ts
import { createHmac } from "node:crypto";

// Read env vars lazily (inside functions) so dotenv.config() in the calling
// script has time to populate process.env before these are evaluated.
// ESM import hoisting means module-level const reads happen before the
// config() call in the smoke script runs.

const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_ATTEMPTS = 60;

function buildJwt(): string {
  const ACCESS_KEY = process.env.KLING_ACCESS_KEY ?? "";
  const SECRET_KEY = process.env.KLING_SECRET_KEY ?? "";
  if (!ACCESS_KEY || !SECRET_KEY) {
    throw new Error("KLING_ACCESS_KEY and KLING_SECRET_KEY must be set");
  }
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: ACCESS_KEY, exp: now + 1800, nbf: now - 5 };

  const b64 = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const data = `${b64(header)}.${b64(payload)}`;
  const sig = createHmac("sha256", SECRET_KEY)
    .update(data)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${data}.${sig}`;
}

async function fetchJson(path: string, init?: RequestInit): Promise<any> {
  const API_BASE = process.env.KLING_API_BASE ?? "https://api.klingai.com";
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${buildJwt()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Kling ${path} ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

export async function generateVideoFromKeyframe(input: {
  keyframeBytes: Buffer;
  keyframeMimeType: string;
  motionPrompt: string;
  negativePrompt: string;
  durationSeconds: 5 | 10;
  aspectRatio: "9:16" | "1:1" | "16:9";
}): Promise<{ videoBytes: Buffer; videoUrl: string }> {
  const submitController = new AbortController();
  const submitTimeout = setTimeout(
    () => submitController.abort(),
    SUBMIT_TIMEOUT_MS,
  );

  let taskId: string;
  try {
    const submit = await fetchJson("/v1/videos/image2video", {
      method: "POST",
      signal: submitController.signal,
      body: JSON.stringify({
        model_name: process.env.KLING_MODEL_ID ?? "kling-v1",
        image: input.keyframeBytes.toString("base64"),
        prompt: input.motionPrompt,
        negative_prompt: input.negativePrompt,
        duration: String(input.durationSeconds),
        aspect_ratio: input.aspectRatio,
        cfg_scale: 0.5,
      }),
    });
    taskId = submit.data?.task_id ?? submit.task_id;
    if (!taskId) {
      throw new Error(
        `Kling submit: no task_id in response: ${JSON.stringify(submit).slice(0, 300)}`,
      );
    }
    console.log(`[kling] submitted task ${taskId}`);
  } finally {
    clearTimeout(submitTimeout);
  }

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await fetchJson(`/v1/videos/image2video/${taskId}`);
    const status = poll.data?.task_status ?? poll.task_status;
    console.log(
      `[kling] poll ${attempt + 1}/${POLL_MAX_ATTEMPTS}: status=${status}`,
    );

    if (status === "succeed" || status === "succeeded") {
      const videoUrl =
        poll.data?.task_result?.videos?.[0]?.url ??
        poll.task_result?.videos?.[0]?.url;
      if (!videoUrl) {
        throw new Error(
          `Kling poll: no video URL in result: ${JSON.stringify(poll).slice(0, 300)}`,
        );
      }
      const videoRes = await fetch(videoUrl);
      const buf = Buffer.from(await videoRes.arrayBuffer());
      return { videoBytes: buf, videoUrl };
    }
    if (status === "failed") {
      throw new Error(
        `Kling task failed: ${poll.data?.task_status_msg ?? JSON.stringify(poll).slice(0, 300)}`,
      );
    }
  }

  throw new Error(
    `Kling polling exceeded ${POLL_MAX_ATTEMPTS} attempts (5 min)`,
  );
}
