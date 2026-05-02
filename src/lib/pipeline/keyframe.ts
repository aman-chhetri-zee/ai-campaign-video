// src/lib/pipeline/keyframe.ts
//
// Stage 5 — Keyframe Compositing
//
// Architecture note:
//   gemini-3-pro-image (Nano Banana Pro) is the spec's primary model,
//   but it is not yet available on this Vertex AI project. The confirmed
//   available path is a two-stage pipeline:
//     Stage A: Gemini 2.5 Pro (vision) analyzes all three input images
//              and generates a detailed, scene-accurate Imagen prompt.
//     Stage B: Imagen 4.0 (text-to-image) renders the final keyframe
//              from that prompt in 9:16 aspect ratio.
//
//   When gemini-3-pro-image becomes available, Stage A can be collapsed
//   into a single multi-image-in / image-out call. The public API
//   (compositeKeyframe) and the smoke script do not change.

import { getGenAIClient } from "../genai-client";
import { GoogleAuth } from "google-auth-library";

const GEMINI_TEXT_MODEL = "gemini-2.5-pro";
const IMAGEN_MODEL = "imagen-4.0-generate-001";
const PROJECT_ID = process.env.GCP_PROJECT_ID || "creatoreconomy-479409";
const LOCATION = process.env.GCP_LOCATION || "us-central1";
const TIMEOUT_MS = 120_000;

export type ImageInput = { bytes: Buffer; mimeType: string };

let _auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!_auth) {
    _auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  }
  return _auth;
}

/**
 * Stage A: Use Gemini 2.5 Pro to analyse all input images and produce
 * a highly-detailed Imagen text prompt that:
 *   - Replicates the scene / pose / lighting from the template first frame
 *   - Precisely describes the face from the reference image
 *   - Includes the product being worn naturally
 */
async function buildImagenPrompt(input: {
  keyframePrompt: string;
  templateFirstFrame: ImageInput;
  referenceFace: ImageInput;
  products: ImageInput[];
}): Promise<string> {
  const ai = getGenAIClient();

  const systemInstruction = [
    "You are generating a single Imagen text-to-image prompt.",
    "Combine the following three inputs into one concise prompt (under 250 words):",
    "1. Replicate the EXACT scene, pose, background, lighting, and framing from IMAGE 1 (scene reference).",
    "2. Describe the EXACT facial features from IMAGE 2 (face reference): skin tone, hair colour/length/texture, face shape, eye shape, nose, lips, and any distinctive features such as nose studs or moles.",
    "3. The person is naturally wearing the product shown in IMAGE 3 (a double-strand black-beaded choker necklace with a small black cross pendant) visibly around their neck, pendant at the center front.",
    "Begin the prompt with 'Professional fashion photograph,' and output ONLY the prompt text — no headers, no explanation.",
  ].join(" ");

  const parts: any[] = [
    { text: systemInstruction },
    { inlineData: { mimeType: input.templateFirstFrame.mimeType, data: input.templateFirstFrame.bytes.toString("base64") } },
    { inlineData: { mimeType: input.referenceFace.mimeType, data: input.referenceFace.bytes.toString("base64") } },
    ...input.products.map((p) => ({
      inlineData: { mimeType: p.mimeType, data: p.bytes.toString("base64") },
    })),
  ];

  const response = await Promise.race([
    ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: [{ role: "user", parts }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("keyframe stage-A timeout")), TIMEOUT_MS),
    ),
  ]);

  const text = (response as any).text ?? "";
  if (!text.trim()) {
    throw new Error("keyframe stage-A: Gemini returned empty prompt");
  }

  console.log("[keyframe] generated Imagen prompt:", text.trim().slice(0, 300));
  return text.trim();
}

/**
 * Stage B: Send the generated prompt to Imagen 4.0 and return the
 * resulting image bytes.
 */
async function renderWithImagen(imagenPrompt: string): Promise<{ imageBytes: Buffer; mimeType: string }> {
  const auth = getAuth();
  const authClient = await auth.getClient();
  const tokenResponse = await authClient.getAccessToken();
  if (!tokenResponse.token) {
    throw new Error("keyframe stage-B: failed to obtain access token");
  }

  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${IMAGEN_MODEL}:predict`;

  const fetchPromise = fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenResponse.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances: [{ prompt: imagenPrompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: "9:16",
        personGeneration: "allow_adult",
        safetySetting: "block_some",
      },
    }),
  });

  const resp = await Promise.race([
    fetchPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("keyframe stage-B timeout")), TIMEOUT_MS),
    ),
  ]);

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`keyframe stage-B: Imagen returned ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) {
    throw new Error(`keyframe stage-B: no image in Imagen response. Response keys: ${Object.keys(data).join(", ")}`);
  }

  return {
    imageBytes: Buffer.from(b64, "base64"),
    mimeType: data.predictions[0].mimeType ?? "image/png",
  };
}

/**
 * Public API — composites a keyframe from template first frame + reference
 * face + product images. The keyframePrompt guides the composition intent
 * (referenced in Stage A's system instruction context).
 */
export async function compositeKeyframe(input: {
  keyframePrompt: string;
  templateFirstFrame: ImageInput;
  referenceFace: ImageInput;
  products: ImageInput[];
}): Promise<{ imageBytes: Buffer; mimeType: string }> {
  console.log("[keyframe] stage A — generating Imagen prompt via Gemini 2.5 Pro...");
  const imagenPrompt = await buildImagenPrompt(input);

  console.log("[keyframe] stage B — rendering keyframe via Imagen 4.0...");
  const result = await renderWithImagen(imagenPrompt);

  console.log(`[keyframe] done — ${result.imageBytes.length} bytes, ${result.mimeType}`);
  return result;
}
