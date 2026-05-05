// src/lib/pipeline/kie-seedance.ts
import { withRetry } from "./retry";

const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_ATTEMPTS = 240; // 20 min wall clock — kie.ai queues can be slow

function getApiKey(): string {
  const k = process.env.KIE_API_KEY ?? "";
  if (!k) throw new Error("KIE_API_KEY must be set in .env.local");
  return k;
}
function getApiBase(): string {
  return process.env.KIE_API_BASE || "https://api.kie.ai";
}
function getModelId(): string {
  return process.env.KIE_MODEL_ID || "bytedance/seedance-2";
}
function getResolution(): "480p" | "720p" | "1080p" {
  const r = process.env.KIE_RESOLUTION;
  if (r === "480p" || r === "720p" || r === "1080p") return r;
  return "720p";
}

async function fetchKie(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _rawText: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

/**
 * Generate a video via kie.ai's bytedance/seedance-2 multimodal mode.
 * Uses keyframe as reference_image_urls[0] and template as reference_video_urls[0].
 * Falls back to first_frame_url mode if no motionReferenceUrl is provided
 * (mutually exclusive with reference_video_urls per kie.ai's API).
 *
 * Additional identity anchors (master subject, original creator face) and product
 * images can be passed via identityReferenceUrls and productReferenceUrls.
 * kie.ai Seedance accepts up to 9 reference_image_urls — we dedupe + cap at 9.
 */
export async function generateViaKieSeedance(input: {
  keyframeUrl: string;
  /** ADDITIONAL reference images (master subject, original creator photo, product images)
   *  to anchor identity AND product fidelity in the generated video. */
  identityReferenceUrls?: string[];      // master + original creator face URLs
  productReferenceUrls?: string[];       // product images for visual consistency
  motionReferenceUrl?: string;
  motionPrompt: string;
  negativePrompt?: string;
  durationSeconds?: 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
  aspectRatio?: "9:16" | "16:9" | "1:1" | "4:3" | "3:4" | "21:9";
  resolution?: "480p" | "720p" | "1080p";
}): Promise<{ videoBytes: Buffer; videoUrl: string }> {
  const model = getModelId();
  const resolution = input.resolution ?? getResolution();
  const aspectRatio = input.aspectRatio ?? "9:16";
  const duration = input.durationSeconds ?? 5;

  // Build the deduplicated, capped reference image list:
  // keyframe first, then identity anchors, then product images (max 9 per kie.ai cap)
  const allRefImages = [
    input.keyframeUrl,
    ...(input.identityReferenceUrls ?? []),
    ...(input.productReferenceUrls ?? []),
  ].filter((u, i, a) => a.indexOf(u) === i).slice(0, 9); // dedupe + cap at 9

  console.log(
    `[kie-seedance] sending ${allRefImages.length} reference images (1 keyframe + ${input.identityReferenceUrls?.length ?? 0} identity + ${input.productReferenceUrls?.length ?? 0} products)`,
  );

  // Build input — multimodal if motionReferenceUrl given, else first_frame mode
  const reqInput: Record<string, unknown> = {
    prompt: input.motionPrompt,
    resolution,
    aspect_ratio: aspectRatio,
    duration,
    generate_audio: false, // we mux template audio ourselves
    nsfw_checker: false,
  };
  if (input.motionReferenceUrl) {
    reqInput.reference_image_urls = allRefImages;
    reqInput.reference_video_urls = [input.motionReferenceUrl];
  } else {
    // first_frame mode: use keyframe as first_frame_url; skip extra refs as
    // kie.ai docs do not allow reference_image_urls alongside first_frame_url.
    reqInput.first_frame_url = input.keyframeUrl;
  }

  const body = { model, input: reqInput };

  console.log(
    `[kie-seedance] submitting model=${model} resolution=${resolution} aspect=${aspectRatio} duration=${duration}s ` +
      `keyframe=${input.keyframeUrl.slice(0, 80)} ` +
      `reference_video=${input.motionReferenceUrl?.slice(0, 80) ?? "<none — first_frame mode>"}`,
  );

  // Submit with retry for transient network blips
  const submit = await withRetry(
    () =>
      fetchKie("/api/v1/jobs/createTask", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    { label: "kie-seedance-submit" },
  );

  if (submit.status !== 200 || !submit.json?.data?.taskId) {
    throw new Error(
      `[kie-seedance] submit failed HTTP ${submit.status}: ${JSON.stringify(submit.json).slice(0, 400)}`,
    );
  }
  const taskId: string = submit.json.data.taskId;
  console.log(`[kie-seedance] task submitted: ${taskId}`);

  // Poll until success/fail
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await fetchKie(`/api/v1/jobs/recordInfo?taskId=${taskId}`);
    const state: string | undefined = poll.json?.data?.state;
    const failMsg: string | undefined = poll.json?.data?.failMsg;
    console.log(
      `[kie-seedance] poll ${attempt + 1}/${POLL_MAX_ATTEMPTS}: state=${state}${failMsg ? ` failMsg=${failMsg.slice(0, 100)}` : ""}`,
    );

    if (state === "success") {
      const resultJsonStr = poll.json?.data?.resultJson;
      let videoUrl: string | undefined;
      try {
        const parsed = JSON.parse(resultJsonStr);
        videoUrl = parsed?.resultUrls?.[0];
      } catch {
        // fallthrough
      }
      if (!videoUrl) {
        throw new Error(
          `[kie-seedance] succeeded but no video URL: ${JSON.stringify(poll.json).slice(0, 400)}`,
        );
      }
      console.log(`[kie-seedance] task ${taskId} succeeded — downloading video`);
      const videoRes = await fetch(videoUrl);
      if (!videoRes.ok) {
        throw new Error(`[kie-seedance] download HTTP ${videoRes.status}`);
      }
      const videoBytes = Buffer.from(await videoRes.arrayBuffer());
      return { videoBytes, videoUrl };
    }
    if (state === "fail") {
      throw new Error(
        `[kie-seedance] task ${taskId} failed — failCode=${poll.json?.data?.failCode} failMsg=${failMsg ?? "(none)"}`,
      );
    }
  }
  throw new Error(
    `[kie-seedance] polling exceeded ${POLL_MAX_ATTEMPTS} attempts`,
  );
}
