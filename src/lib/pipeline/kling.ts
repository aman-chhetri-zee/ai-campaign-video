// src/lib/pipeline/kling.ts
import { createHmac } from "node:crypto";
import { withRetry } from "./retry";

// Read env vars lazily (inside functions) so dotenv.config() in the calling
// script has time to populate process.env before these are evaluated.
// ESM import hoisting means module-level const reads happen before the
// config() call in the smoke script runs.

const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_ATTEMPTS = 180; // 180 × 5s = 15 min wall clock — Motion Control occasionally takes 6+ min

// Lazy getters — read at call time, not at module load time.
function getModelId(): string {
  return process.env.KLING_MODEL_ID ?? "kling-v1-5";
}

// ---------------------------------------------------------------------------
// Camera control types
// ---------------------------------------------------------------------------

type CameraControlPreset =
  | "down_back"
  | "forward_up"
  | "right_turn_forward"
  | "left_turn_forward";

type CameraControlSimpleConfig = {
  horizontal?: number;
  vertical?: number;
  pan?: number;
  tilt?: number;
  roll?: number;
  zoom?: number;
};

type CameraControl =
  | { type: "simple"; config: CameraControlSimpleConfig }
  | { type: CameraControlPreset };

function cameraControlForArchetype(archetype: string): CameraControl {
  switch (archetype.toLowerCase()) {
    case "confident":
      return { type: "simple", config: { zoom: 5 } }; // dolly in
    case "playful":
      return { type: "right_turn_forward" }; // playful arc
    case "cool":
      return { type: "forward_up" }; // hero rise
    case "cute":
      return { type: "simple", config: { tilt: 3 } }; // gentle nod
    case "surprised":
      return { type: "simple", config: { zoom: 7 } }; // crash zoom
    case "stylish":
      return { type: "left_turn_forward" }; // stylish swing
    case "energetic":
      return { type: "simple", config: { horizontal: 4 } }; // truck across
    case "dramatic":
      return { type: "down_back" }; // dramatic pull-back
    default:
      return { type: "simple", config: { zoom: 3 } }; // safe default
  }
}

// ---------------------------------------------------------------------------
// Auth / JWT
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Path 1 — image-to-video with camera_control (kling-v1-6)
// ---------------------------------------------------------------------------

async function generateViaImageToVideoWithCamera(input: {
  keyframeBytes: Buffer;
  keyframeMimeType: string;
  motionPrompt: string;
  negativePrompt: string;
  durationSeconds: 5 | 10;
  aspectRatio: "9:16" | "1:1" | "16:9";
  poseArchetype?: string;
}): Promise<{ videoBytes: Buffer; videoUrl: string }> {
  // Only add camera_control (and the required pro mode) when poseArchetype is
  // explicitly provided; omit both for cheaper std-mode calls.
  const cameraControl = input.poseArchetype
    ? cameraControlForArchetype(input.poseArchetype)
    : undefined;

  // Build the camera_control payload: when type="simple" keep config; for
  // named presets omit config entirely (the preset defines motion).
  const cameraControlPayload: Record<string, unknown> | undefined =
    cameraControl
      ? cameraControl.type === "simple"
        ? { type: "simple", config: (cameraControl as { type: "simple"; config: CameraControlSimpleConfig }).config }
        : { type: cameraControl.type }
      : undefined;

  const submitController = new AbortController();
  const submitTimeout = setTimeout(
    () => submitController.abort(),
    SUBMIT_TIMEOUT_MS,
  );

  let taskId: string;
  let usedCameraControl = !!cameraControlPayload;
  try {
    let submit: any;
    try {
      const body: Record<string, unknown> = {
        model_name: getModelId(),
        image: input.keyframeBytes.toString("base64"),
        prompt: input.motionPrompt,
        negative_prompt: input.negativePrompt,
        duration: String(input.durationSeconds),
        aspect_ratio: input.aspectRatio,
        cfg_scale: 0.5,
      };
      if (cameraControlPayload) {
        body.camera_control = cameraControlPayload;
        body.mode = "pro"; // pro mode required when using camera_control
      }
      submit = await withRetry(
        () =>
          fetchJson("/v1/videos/image2video", {
            method: "POST",
            signal: submitController.signal,
            body: JSON.stringify(body),
          }),
        { label: "kling-submit-i2v" },
      );
    } catch (camErr) {
      const msg = (camErr as Error).message ?? "";
      // camera_control / pro mode rejected — fall back gracefully without it
      if (
        msg.includes("camera_control") ||
        msg.includes("pro mode") ||
        msg.includes("mode") ||
        msg.includes("400")
      ) {
        console.warn(
          "[kling][image2video] camera_control/mode:pro rejected — retrying without camera_control.",
          "\n  Error:", msg.slice(0, 300),
        );
        usedCameraControl = false;
        submit = await withRetry(
          () =>
            fetchJson("/v1/videos/image2video", {
              method: "POST",
              body: JSON.stringify({
                model_name: getModelId(),
                image: input.keyframeBytes.toString("base64"),
                prompt: input.motionPrompt,
                negative_prompt: input.negativePrompt,
                duration: String(input.durationSeconds),
                aspect_ratio: input.aspectRatio,
                cfg_scale: 0.5,
              }),
            }),
          { label: "kling-submit-i2v" },
        );
      } else {
        throw camErr;
      }
    }
    taskId = submit.data?.task_id ?? submit.task_id;
    if (!taskId) {
      throw new Error(
        `Kling submit: no task_id in response: ${JSON.stringify(submit).slice(0, 300)}`,
      );
    }
    console.log(
      `[kling][image2video] submitted task ${taskId} (model=${getModelId()}, mode=${usedCameraControl ? "pro" : "std"}, camera=${usedCameraControl ? JSON.stringify(cameraControlPayload) : "none"})`,
    );
  } finally {
    clearTimeout(submitTimeout);
  }

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await fetchJson(`/v1/videos/image2video/${taskId}`);
    const status = poll.data?.task_status ?? poll.task_status;
    console.log(
      `[kling][image2video] poll ${attempt + 1}/${POLL_MAX_ATTEMPTS}: status=${status}`,
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
    `Kling polling exceeded ${POLL_MAX_ATTEMPTS} attempts (15 min)`,
  );
}

// ---------------------------------------------------------------------------
// Path 2 — Motion Control product (kling-v2-6+, URL-based)
// ---------------------------------------------------------------------------

async function generateViaMotionControl(input: {
  keyframeUrl: string;
  motionReferenceUrl: string;
  motionPrompt: string;
  negativePrompt: string;
  durationSeconds: 5 | 10;
  aspectRatio: "9:16" | "1:1" | "16:9";
}): Promise<{ videoBytes: Buffer; videoUrl: string }> {
  const model = process.env.KLING_MOTION_CONTROL_MODEL ?? "kling-v2-6";
  console.log(
    `[kling][motion-control] model=${model} keyframe=${input.keyframeUrl.slice(0, 80)} reference=${input.motionReferenceUrl.slice(0, 80)}`,
  );

  let taskId: string;
  try {
    const submit = await withRetry(
      () =>
        fetchJson("/v1/videos/motion-control", {
          method: "POST",
          body: JSON.stringify({
            model_name: model,
            image_url: input.keyframeUrl,
            video_url: input.motionReferenceUrl,
            mode: "pro",                    // motion control likely requires pro mode
            character_orientation: "image", // output proportions match keyframe
            prompt: input.motionPrompt,
            negative_prompt: input.negativePrompt,
          }),
        }),
      { label: "kling-submit-mc" },
    );
    taskId = submit.data?.task_id ?? submit.task_id;
    if (!taskId)
      throw new Error(
        `no task_id in motion-control response: ${JSON.stringify(submit).slice(0, 300)}`,
      );
    console.log(`[kling][motion-control] submitted task ${taskId}`);
  } catch (err) {
    throw new Error(
      `Kling motion-control submit failed: ${(err as Error).message}`,
    );
  }

  // Poll
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await fetchJson(`/v1/videos/motion-control/${taskId}`);
    const status = poll.data?.task_status ?? poll.task_status;
    console.log(
      `[kling][motion-control] poll ${attempt + 1}/${POLL_MAX_ATTEMPTS}: status=${status}`,
    );

    if (status === "succeed" || status === "succeeded") {
      const videoUrl =
        poll.data?.task_result?.videos?.[0]?.url ??
        poll.task_result?.videos?.[0]?.url;
      if (!videoUrl)
        throw new Error(
          `no video URL in motion-control result: ${JSON.stringify(poll).slice(0, 300)}`,
        );
      const videoRes = await fetch(videoUrl);
      const buf = Buffer.from(await videoRes.arrayBuffer());
      return { videoBytes: buf, videoUrl };
    }
    if (status === "failed") {
      throw new Error(
        `Kling motion-control task failed: ${poll.data?.task_status_msg ?? JSON.stringify(poll).slice(0, 300)}`,
      );
    }
  }

  throw new Error("Kling motion-control polling exceeded max attempts");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateVideoFromKeyframe(input: {
  keyframeBytes: Buffer;
  keyframeMimeType: string;
  motionPrompt: string;
  negativePrompt: string;
  durationSeconds: 5 | 10;
  aspectRatio: "9:16" | "1:1" | "16:9";
  /** Drives camera_control on the image-to-video path (Path 1). */
  poseArchetype?: string;
  /** Absolute fs path to the template reference video (kept for fallback / legacy callers). */
  motionReferenceVideoPath?: string;
  /** HTTPS URL for the keyframe image — required for motion control (Path 2). */
  keyframeUrl?: string;
  /** HTTPS URL for the reference video — required for motion control (Path 2). */
  motionReferenceUrl?: string;
}): Promise<{ videoBytes: Buffer; videoUrl: string }> {
  const useMotionControl =
    process.env.KLING_USE_MOTION_CONTROL === "true" &&
    !!input.keyframeUrl &&
    !!input.motionReferenceUrl;

  if (useMotionControl) {
    return generateViaMotionControl({
      keyframeUrl: input.keyframeUrl!,
      motionReferenceUrl: input.motionReferenceUrl!,
      motionPrompt: input.motionPrompt,
      negativePrompt: input.negativePrompt,
      durationSeconds: input.durationSeconds,
      aspectRatio: input.aspectRatio,
    });
  }

  return generateViaImageToVideoWithCamera(input);
}
