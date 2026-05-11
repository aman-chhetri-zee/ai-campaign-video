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
 * Internal helper — POST createTask + poll recordInfo + download the result mp4.
 * Shared by per-shot and multi-shot public functions.
 */
async function submitAndPollKieTask(body: {
  model: string;
  input: Record<string, unknown>;
}): Promise<{ videoBytes: Buffer; videoUrl: string }> {
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
  /** When true, Seedance generates audio (dialogue / SFX / BGM) and lip-syncs
   *  mouth movements to any dialogue wrapped in double quotes inside the
   *  motionPrompt. Default false — non-lip-sync templates stay silent and we
   *  mux template audio downstream as today. */
  generateAudio?: boolean;
}): Promise<{ videoBytes: Buffer; videoUrl: string }> {
  const model = getModelId();
  const resolution = input.resolution ?? getResolution();
  const aspectRatio = input.aspectRatio ?? "9:16";
  const duration = input.durationSeconds ?? 5;
  const generateAudio = input.generateAudio ?? false;

  const allRefImages = [
    input.keyframeUrl,
    ...(input.identityReferenceUrls ?? []),
    ...(input.productReferenceUrls ?? []),
  ].filter((u, i, a) => a.indexOf(u) === i).slice(0, 9);

  console.log(
    `[kie-seedance] sending ${allRefImages.length} reference images (1 keyframe + ${input.identityReferenceUrls?.length ?? 0} identity + ${input.productReferenceUrls?.length ?? 0} products); generate_audio=${generateAudio}`,
  );

  const reqInput: Record<string, unknown> = {
    prompt: input.motionPrompt,
    resolution,
    aspect_ratio: aspectRatio,
    duration,
    generate_audio: generateAudio,
    nsfw_checker: false,
  };
  if (input.motionReferenceUrl) {
    reqInput.reference_image_urls = allRefImages;
    reqInput.reference_video_urls = [input.motionReferenceUrl];
  } else {
    reqInput.first_frame_url = input.keyframeUrl;
  }

  console.log(
    `[kie-seedance] submitting model=${model} resolution=${resolution} aspect=${aspectRatio} duration=${duration}s ` +
      `keyframe=${input.keyframeUrl.slice(0, 80)} ` +
      `reference_video=${input.motionReferenceUrl?.slice(0, 80) ?? "<none — first_frame mode>"}`,
  );

  return submitAndPollKieTask({ model, input: reqInput });
}

/**
 * Generate a SINGLE multi-shot video that swaps outfits across the template's
 * jump cuts in one kie.ai call. Pass one keyframe per outfit slot (in shot
 * order) plus the full template as the motion reference video.
 *
 * Seedance composes the multi-shot output structure from the reference_video,
 * picking visual material from the supplied reference_image_urls. Outfit
 * alignment to specific shots is steered by the prompt — kie.ai docs do not
 * promise per-image-to-shot mapping, so the prompt must spell out which
 * outfit appears in which shot with timestamps.
 */
export async function generateMultiShotViaKieSeedance(input: {
  /** One keyframe per outfit slot, in shot order. */
  keyframeUrls: string[];
  /** Identity anchors (master subject, original creator photo). */
  identityReferenceUrls?: string[];
  /** Optional unique product image URLs (deduped across all looks). */
  productReferenceUrls?: string[];
  /** Full template video URL — drives shot structure and motion timing. */
  motionReferenceUrl: string;
  /** Comprehensive prompt with per-shot timestamps and outfit assignments. */
  motionPrompt: string;
  durationSeconds: 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  resolution?: "480p" | "720p" | "1080p";
  /** When true, Seedance generates audio (dialogue / SFX / BGM) and lip-syncs
   *  mouth movements to any dialogue wrapped in double quotes inside the
   *  motionPrompt. Default false. */
  generateAudio?: boolean;
}): Promise<{ videoBytes: Buffer; videoUrl: string }> {
  const model = getModelId();
  const resolution = input.resolution ?? getResolution();
  const aspectRatio = input.aspectRatio ?? "9:16";
  const generateAudio = input.generateAudio ?? false;

  // Build deduped, capped reference image list (kie.ai max 9):
  // keyframes first (each carries an outfit), then identity, then products.
  const allRefImages = [
    ...input.keyframeUrls,
    ...(input.identityReferenceUrls ?? []),
    ...(input.productReferenceUrls ?? []),
  ].filter((u, i, a) => a.indexOf(u) === i).slice(0, 9);

  console.log(
    `[kie-seedance][multishot] sending ${allRefImages.length} reference images (${input.keyframeUrls.length} keyframes + ${input.identityReferenceUrls?.length ?? 0} identity + ${input.productReferenceUrls?.length ?? 0} products, deduped/capped to 9); generate_audio=${generateAudio}`,
  );

  const reqInput: Record<string, unknown> = {
    prompt: input.motionPrompt,
    resolution,
    aspect_ratio: aspectRatio,
    duration: input.durationSeconds,
    generate_audio: generateAudio,
    nsfw_checker: false,
    reference_image_urls: allRefImages,
    reference_video_urls: [input.motionReferenceUrl],
  };

  console.log(
    `[kie-seedance][multishot] submitting model=${model} resolution=${resolution} aspect=${aspectRatio} duration=${input.durationSeconds}s ` +
      `keyframes=${input.keyframeUrls.length} reference_video=${input.motionReferenceUrl.slice(0, 80)}`,
  );

  return submitAndPollKieTask({ model, input: reqInput });
}
