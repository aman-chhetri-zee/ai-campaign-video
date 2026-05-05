// src/lib/pipeline/master-subject.ts
//
// Generates the canonical full-body master subject via Nano Banana Pro
// (gemini-3-pro-image-preview on Vertex global). The output is the
// identity-locked anchor used as a secondary reference in every per-look
// keyframe to eliminate cross-shot identity drift.

import { GoogleAuth } from "google-auth-library";
import type { FaceMetadata } from "./types";
import { withRetry } from "./retry";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "creatoreconomy-479409";
const MODEL_ID = "gemini-3-pro-image-preview";
const LOCATION = "global";
const HOST = "aiplatform.googleapis.com";
const TIMEOUT_MS = 180_000;

let _auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!_auth) {
    _auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  }
  return _auth;
}

async function getAccessToken(): Promise<string> {
  const auth = getAuth();
  const authClient = await auth.getClient();
  const tokenResponse = await authClient.getAccessToken();
  if (!tokenResponse.token) throw new Error("master-subject: failed to obtain access token");
  return tokenResponse.token;
}

export async function generateMasterSubjectReference(input: {
  faceImageBytes: Buffer;
  faceImageMimeType: string;
  faceMetadata: FaceMetadata;
}): Promise<{ imageBytes: Buffer; mimeType: string } | null> {
  const fm = input.faceMetadata;

  const bodyClause = fm.is_full_body && fm.body_description
    ? `BODY — preserve the body type and proportions from the reference image: ${fm.body_description}. Match the build, weight, and overall shape exactly.`
    : `BODY — use an AVERAGE adult build with natural healthy proportions. Not slim, not muscular, not plus-sized — just a typical, average, realistic body shape. Do not default to a fashion-model slim build.`;

  const prompt = [
    "Generate a clean, full-body, head-to-toe vertical 9:16 portrait of the person shown in the reference image.",
    "The person stands in a neutral frontal pose, arms relaxed at their sides, looking straight at camera, against a plain neutral light-grey backdrop with even soft studio lighting.",
    "They wear a simple plain white t-shirt and plain light-blue straight-cut jeans — minimal, basic, no patterns, no accessories, no jewelry beyond what is visible in the reference image.",
    "STRICT IDENTITY PRESERVATION: physical traits must match the reference image EXACTLY — preserve every detail. Specifically:",
    `  - HAIR: preserve the exact length, exact color, exact texture, exact part, exact volume, exact styling shown in the reference. Hair description from analysis: "${fm.hair || "as shown in the reference image"}". DO NOT cut, shorten, restyle, straighten, curl, or alter the hair in any way. If the reference hair extends to chest level, the master's hair must extend to chest level. If it's wavy, keep it wavy. If it's parted center, keep it parted center.`,
    "  - FACE: same exact face shape, jawline, cheekbone structure, eye shape and size, eye color, nose shape, lip shape and size, eyebrow shape and thickness.",
    "  - SKIN: same exact skin tone, undertone, texture, and any visible distinctive marks (moles, freckles, scars).",
    `  - DISTINCTIVE FEATURES: preserve all of: ${fm.distinctive_features || "(see reference)"}. These features must remain visible and unchanged in the master image.`,
    `  - ${bodyClause}`,
    fm.visible_clothing_in_reference
      ? `  - CLOTHING CONTEXT (reference only, do NOT replicate) — in the reference image the person is wearing: ${fm.visible_clothing_in_reference}. Use this context to understand their body shape and proportions, but the master should wear the neutral white t-shirt and light jeans described above.`
      : "",
    "The shot is wide enough to show the entire person from the very top of the head to below the feet — feet must be in the lower third of the frame.",
    "No text, no logos, no watermarks. Clean studio fashion-photography aesthetic.",
    "Identity preservation is the absolute highest priority. The master image must look like the SAME PERSON from the reference, simply standing in a neutral pose against a neutral backdrop. Do not introduce any creative interpretation that alters their physical appearance.",
  ]
    .filter(Boolean)
    .join(" ");

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: input.faceImageMimeType,
              data: input.faceImageBytes.toString("base64"),
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "9:16" },
    },
  };

  const endpoint = `https://${HOST}/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:generateContent`;

  try {
    const resp = await withRetry(
      async () => {
        const token = await getAccessToken();
        const r = await Promise.race([
          fetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("master-subject HTTP timed out")), TIMEOUT_MS),
          ),
        ]);
        if (r.status >= 500 && r.status < 600) {
          throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        }
        return r;
      },
      { label: "master-subject" },
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(`[master-subject] HTTP ${resp.status}: ${errText.slice(0, 300)}`);
      return null;
    }

    const data = await resp.json();
    const candidate = data.candidates?.[0];
    const imagePart = candidate?.content?.parts?.find((p: any) => p.inlineData?.data);

    if (!imagePart) {
      const finishReason = candidate?.finishReason ?? "unknown";
      console.warn(
        `[master-subject] no image in response (finishReason=${finishReason}): ${JSON.stringify(data).slice(0, 300)}`,
      );
      return null;
    }

    return {
      imageBytes: Buffer.from(imagePart.inlineData.data, "base64"),
      mimeType: imagePart.inlineData.mimeType ?? "image/png",
    };
  } catch (err) {
    console.warn(`[master-subject] failed: ${(err as Error).message}`);
    return null;
  }
}
