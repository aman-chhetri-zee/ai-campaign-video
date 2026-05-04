// src/lib/pipeline/seedance.ts
//
// ============================================================================
// Phase-1 Research Findings — Seedance 2.0 / BytePlus Ark API
// ============================================================================
//
// ENDPOINT (international BytePlus):
//   https://ark.ap-southeast.bytepluses.com/api/v3
//
// ENDPOINT (Volcengine China):
//   https://ark.cn-beijing.volces.com/api/v3
//
// MODEL IDs (probe-verified 2026-05-02):
//   dreamina-seedance-2-0-260128    — CONFIRMED valid on BytePlus international
//                                     (ark.ap-southeast.bytepluses.com)
//   doubao-seedance-2-0-260128      — Volcengine China endpoint alias
//                                     (ark.cn-beijing.volces.com)
//   doubao-seedance-2-0-fast-260128 — fast/cheaper variant (not tested)
//
//   Note: The probe returned HTTP 400 InvalidParameter on the image URL
//   (via.placeholder.com not reachable from Volcengine), NOT 404 on the model —
//   confirming the model ID "dreamina-seedance-2-0-260128" is correct and
//   the API key is accepted on the BytePlus international endpoint.
//
// AUTHENTICATION:
//   Authorization: Bearer <SEEDANCE_API_KEY>
//   Content-Type: application/json
//
// TASK SUBMISSION:
//   POST /api/v3/contents/generations/tasks
//   Body (image-to-video with optional reference video):
//   {
//     "model": "<model_id>",
//     "content": [
//       { "type": "text", "text": "<motion prompt>" },
//       { "type": "image_url", "image_url": { "url": "<HTTPS keyframe URL>" } },
//       // optional additional outfit images:
//       { "type": "image_url", "image_url": { "url": "<outfit URL>" }, "role": "reference_image" },
//       // optional reference video (drives multi-shot structure):
//       { "type": "video_url", "video_url": { "url": "<template video URL>" }, "role": "reference_video" }
//     ],
//     "ratio": "9:16",          // "16:9" | "9:16" | "1:1" | "adaptive"
//     "duration": 5,            // seconds — 4-15
//     "generate_audio": false,  // we handle audio ourselves via concatClips
//     "watermark": false
//   }
//
// SUBMISSION RESPONSE:
//   { "id": "cgt-2025xxxxxxxx-xxxx", ... }   ← top-level "id" field
//
// POLL:
//   GET /api/v3/contents/generations/tasks/<task_id>
//   Response status field: "queued" | "running" | "succeeded" | "failed" | "expired" | "cancelled"
//   Video URL when succeeded: response.content[].video_url  (first item with type "video_url")
//   or: response.output.video_url  (varies by SDK version)
//
// NOTES:
//   - Seedance handles multi-shot natively when a reference video is supplied;
//     no client-side concat is required for the video track.
//   - The returned video URL is a temporary Volcengine object-storage URL valid
//     for 24 hours — download immediately.
//   - Audio must still be muxed client-side using concatClips / ffmpeg because
//     generate_audio=false keeps us on a faster tier and avoids music licensing.
// ============================================================================

import { withRetry } from "./retry";

const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_ATTEMPTS = 180; // 180 × 5 s = 15 min — matches Kling's cap

// ---------------------------------------------------------------------------
// Lazy env getters — read at call time, not at module load time
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const k = process.env.SEEDANCE_API_KEY ?? "";
  if (!k) throw new Error("SEEDANCE_API_KEY must be set");
  return k;
}

function getApiBase(): string {
  // Use || (not ??) so that an empty string also falls back to the default
  return (
    process.env.SEEDANCE_API_BASE ||
    "https://ark.ap-southeast.bytepluses.com"
  );
}

function getModelId(): string {
  // Use || (not ??) so that an empty string also falls back to the default.
  // "dreamina-seedance-2-0-260128" is the confirmed valid model ID on the
  // BytePlus international endpoint (ark.ap-southeast.bytepluses.com).
  // Volcengine China uses "doubao-seedance-2-0-260128".
  return process.env.SEEDANCE_MODEL_ID || "dreamina-seedance-2-0-260128";
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function fetchArk(path: string, init?: RequestInit): Promise<any> {
  const base = getApiBase().replace(/\/$/, "");
  const url = `${base}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `[seedance] ${init?.method ?? "GET"} ${path} HTTP ${res.status}: ${body.slice(0, 500)}`,
    );
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Extract video URL from a succeeded task response
// Different SDK versions/regions return slightly different shapes; try both.
// ---------------------------------------------------------------------------

function extractVideoUrl(poll: any): string | undefined {
  // Shape A: content array with video_url items (BytePlus global docs)
  if (Array.isArray(poll.content)) {
    for (const item of poll.content) {
      if (item.video_url) return item.video_url;
      if (item.type === "video_url" && item.video_url?.url) return item.video_url.url;
    }
  }
  // Shape B: output.video_url
  if (poll.output?.video_url) return poll.output.video_url;
  // Shape C: result.video_url
  if (poll.result?.video_url) return poll.result.video_url;
  // Shape D: data.video_url
  if (poll.data?.video_url) return poll.data.video_url;
  return undefined;
}

// ---------------------------------------------------------------------------
// Public API — matches the contract the orchestrator uses
// ---------------------------------------------------------------------------

/**
 * Generate a multi-shot video using Seedance 2.0 via the BytePlus Ark API.
 *
 * Inputs are HTTPS URLs (consistent with Kling Motion Control's contract).
 * When a motionReferenceUrl (template video) is provided, Seedance handles
 * multi-shot cuts natively — no client-side concat is required for the video
 * track. Callers should still mux audio via concatClips/ffmpeg.
 *
 * Returns videoBytes (Buffer) + videoUrl (the temporary Volcengine CDN URL).
 */
export async function generateMultiShotViaSeedance(input: {
  /** Primary identity reference: composited keyframe (face + first look). */
  keyframeUrl: string;
  /** Additional reference images for other looks / outfit variants. */
  outfitImageUrls?: string[];
  /** Reference video URL (Vercel deployment URL for the template). */
  motionReferenceUrl: string;
  motionPrompt: string;
  negativePrompt?: string;
  durationSeconds?: number;
  aspectRatio?: "9:16" | "1:1" | "16:9";
}): Promise<{ videoBytes: Buffer; videoUrl: string }> {
  const model = getModelId();
  const duration = input.durationSeconds ?? 5;
  const ratio = input.aspectRatio ?? "9:16";

  // Build content array — text prompt first, then identity keyframe, then
  // optional outfit images, then the reference video for multi-shot structure.
  // Seedance has two mutually-exclusive content modes:
  //   - "first_frame" mode (image-to-video, no reference video allowed)
  //   - "reference_image" / "reference_video" mode (Creative Templates — multi-shot with motion reference)
  // We're using mode 2 because that's what enables multi-shot template-driven output.
  // ALL keyframes (primary + outfits) get role "reference_image"; the template gets role "reference_video".
  const content: any[] = [
    { type: "text", text: input.motionPrompt },
    {
      type: "image_url",
      image_url: { url: input.keyframeUrl },
      role: "reference_image", // primary identity/composition anchor
    },
  ];

  // Additional outfit images as reference_image items
  for (const url of input.outfitImageUrls ?? []) {
    content.push({
      type: "image_url",
      image_url: { url },
      role: "reference_image",
    });
  }

  // Reference video — Seedance uses this to infer multi-shot structure
  content.push({
    type: "video_url",
    video_url: { url: input.motionReferenceUrl },
    role: "reference_video",
  });

  const body = {
    model,
    content,
    ratio,
    duration,
    generate_audio: false, // audio muxed separately to avoid licensing issues
    watermark: false,
  };

  console.log(
    `[seedance] submitting task model=${model} duration=${duration}s ratio=${ratio} keyframe=${input.keyframeUrl.slice(0, 80)} outfits=${input.outfitImageUrls?.length ?? 0} reference=${input.motionReferenceUrl.slice(0, 80)}`,
  );

  // Submit with retry (handles transient 5xx / network blips)
  const submitResponse = await withRetry(
    () =>
      fetchArk("/api/v3/contents/generations/tasks", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    { label: "seedance-submit" },
  );

  // The task ID is at the top-level "id" field per BytePlus Ark docs
  const taskId: string =
    submitResponse.id ??
    submitResponse.task_id ??
    submitResponse.data?.task_id;

  if (!taskId) {
    throw new Error(
      `[seedance] no task_id in submit response: ${JSON.stringify(submitResponse).slice(0, 400)}`,
    );
  }

  console.log(`[seedance] task submitted: ${taskId}`);

  // Poll until succeeded / failed
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const poll = await fetchArk(
      `/api/v3/contents/generations/tasks/${taskId}`,
    );

    const status: string =
      poll.status ?? poll.task_status ?? poll.data?.status ?? "unknown";

    console.log(
      `[seedance] poll ${attempt + 1}/${POLL_MAX_ATTEMPTS}: status=${status}`,
    );

    if (status === "succeeded") {
      const videoUrl = extractVideoUrl(poll);
      if (!videoUrl) {
        throw new Error(
          `[seedance] no video URL in succeeded response: ${JSON.stringify(poll).slice(0, 400)}`,
        );
      }
      console.log(`[seedance] task ${taskId} succeeded — downloading video`);
      const videoRes = await fetch(videoUrl);
      if (!videoRes.ok) {
        throw new Error(
          `[seedance] video download failed HTTP ${videoRes.status}: ${videoUrl.slice(0, 200)}`,
        );
      }
      const videoBytes = Buffer.from(await videoRes.arrayBuffer());
      return { videoBytes, videoUrl };
    }

    if (
      status === "failed" ||
      status === "expired" ||
      status === "cancelled"
    ) {
      const reason =
        poll.error?.message ??
        poll.data?.error ??
        JSON.stringify(poll).slice(0, 300);
      throw new Error(`[seedance] task ${taskId} ${status}: ${reason}`);
    }

    // status is "queued" or "running" — keep polling
  }

  throw new Error(
    `[seedance] polling exceeded ${POLL_MAX_ATTEMPTS} attempts (${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 60_000} min) for task ${taskId}`,
  );
}
