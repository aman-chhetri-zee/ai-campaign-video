// src/lib/pipeline/keyframe.ts
//
// Stage 5 — Keyframe Compositing
//
// Three-tier strategy for true identity preservation:
//
// Tier 1: Imagen 3 Customization (imagen-3.0-capability-001) with
//         REFERENCE_TYPE_SUBJECT — generates a new scene from the reference
//         face + product as named subjects. Best identity preservation.
//
// Tier 2: Inpaint on the reference face image (imagen-3.0-generate-001) with
//         EDIT_MODE_INPAINT_INSERTION — edits the reference image to add the
//         necklace and shift scene/lighting. Preserves the face exactly because
//         it starts from the actual reference photo. Scene won't match template
//         perfectly but face is guaranteed.
//
// Tier 3: Text-only Imagen 4.0 (legacy, same as d2d36e9) — last resort.

import { getGenAIClient } from "../genai-client";
import { GoogleAuth } from "google-auth-library";

const GEMINI_TEXT_MODEL = "gemini-2.5-pro";
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

async function getAccessToken(): Promise<string> {
  const auth = getAuth();
  const authClient = await auth.getClient();
  const tokenResponse = await authClient.getAccessToken();
  if (!tokenResponse.token) {
    throw new Error("keyframe: failed to obtain access token");
  }
  return tokenResponse.token;
}

async function fetchWithTimeout(
  url: string,
  token: string,
  body: object,
): Promise<Response> {
  const fetchPromise = fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return Promise.race([
    fetchPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`HTTP request timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Tier 1: Imagen 3 Customization with subject reference
// ---------------------------------------------------------------------------

/**
 * Build the Tier-1 prompt from the input keyframePrompt.
 * We synthesize it programmatically — no extra Gemini call needed.
 * [1] = reference face person, [2] = necklace product.
 */
function buildTier1Prompt(keyframePrompt: string): string {
  // Strip the "IMAGE 1/2/3" wording that refers to how the smoke script
  // structured the prompt, and replace with [1]/[2] placeholders that
  // the Customization API understands.
  const base = keyframePrompt
    .replace(/IMAGE\s+\d+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return (
    `Subject [1] as the featured person. Subject [2] is the necklace worn around their neck with pendant visible at center front. ` +
    `${base} ` +
    `Use Subject [1] as the person's face — same eyes, skin tone, hair, nose stud, mole — identity preservation is highest priority. ` +
    `Use Subject [2] as the exact product around their neck.`
  );
}

async function tier1Customization(input: {
  keyframePrompt: string;
  referenceFace: ImageInput;
  products: ImageInput[];
}): Promise<{ imageBytes: Buffer; mimeType: string } | null> {
  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-3.0-capability-001:predict`;

  const prompt = buildTier1Prompt(input.keyframePrompt);
  console.log("[keyframe][tier1] prompt:", prompt.slice(0, 300));

  const faceB64 = input.referenceFace.bytes.toString("base64");
  const productB64 = input.products[0]?.bytes.toString("base64") ?? "";

  const referenceImages: object[] = [
    {
      referenceType: "REFERENCE_TYPE_SUBJECT",
      referenceId: 1,
      referenceImage: { bytesBase64Encoded: faceB64 },
      subjectImageConfig: {
        subjectDescription: "young south asian woman",
        subjectType: "SUBJECT_TYPE_PERSON",
      },
    },
  ];

  if (productB64) {
    referenceImages.push({
      referenceType: "REFERENCE_TYPE_SUBJECT",
      referenceId: 2,
      referenceImage: { bytesBase64Encoded: productB64 },
      subjectImageConfig: {
        subjectDescription: "black-beaded choker necklace with cross pendant",
        subjectType: "SUBJECT_TYPE_PRODUCT",
      },
    });
  }

  const token = await getAccessToken();

  let resp: Response;
  try {
    resp = await fetchWithTimeout(endpoint, token, {
      instances: [{ prompt, referenceImages }],
      parameters: {
        sampleCount: 1,
        aspectRatio: "9:16",
        personGeneration: "allow_adult",
        safetySetting: "block_some",
      },
    });
  } catch (err) {
    console.warn("[keyframe][tier1] fetch error:", err);
    return null;
  }

  if (!resp.ok) {
    const errText = await resp.text();
    console.warn(`[keyframe][tier1] HTTP ${resp.status}: ${errText.slice(0, 400)}`);
    // Treat 404 / model-not-found as "tier unavailable" — fall through
    return null;
  }

  const data = await resp.json();
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) {
    console.warn("[keyframe][tier1] no image in response:", JSON.stringify(data).slice(0, 300));
    return null;
  }

  console.log("[keyframe][tier1] SUCCESS");
  return {
    imageBytes: Buffer.from(b64, "base64"),
    mimeType: data.predictions[0].mimeType ?? "image/png",
  };
}

// ---------------------------------------------------------------------------
// Tier 2: Inpaint on the reference face image
// ---------------------------------------------------------------------------

async function tier2Inpaint(input: {
  keyframePrompt: string;
  referenceFace: ImageInput;
  products: ImageInput[];
}): Promise<{ imageBytes: Buffer; mimeType: string } | null> {
  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-3.0-generate-001:predict`;

  const inpaintPrompt =
    `Keep this person's face EXACTLY as-is — same eyes, skin tone, hair, nose stud, mole near mouth. ` +
    `Add a double-strand black-beaded choker necklace with a small black cross pendant around their neck, pendant clearly visible at center front. ` +
    `Shift the overall scene lighting and mood toward a chic press-conference setting with microphones and cameras in the background. ` +
    `Vertical 9:16 portrait, fashion photography, dramatic lighting.`;

  console.log("[keyframe][tier2] inpaint prompt:", inpaintPrompt.slice(0, 300));

  const faceB64 = input.referenceFace.bytes.toString("base64");
  const token = await getAccessToken();

  let resp: Response;
  try {
    resp = await fetchWithTimeout(endpoint, token, {
      instances: [
        {
          prompt: inpaintPrompt,
          image: { bytesBase64Encoded: faceB64 },
          maskMode: "MASK_MODE_AUTOMATIC",
        },
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: "9:16",
        personGeneration: "allow_adult",
        safetySetting: "block_some",
        editMode: "EDIT_MODE_INPAINT_INSERTION",
      },
    });
  } catch (err) {
    console.warn("[keyframe][tier2] fetch error:", err);
    return null;
  }

  if (!resp.ok) {
    const errText = await resp.text();
    console.warn(`[keyframe][tier2] HTTP ${resp.status}: ${errText.slice(0, 400)}`);
    return null;
  }

  const data = await resp.json();
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) {
    console.warn("[keyframe][tier2] no image in response:", JSON.stringify(data).slice(0, 300));
    return null;
  }

  console.log("[keyframe][tier2] SUCCESS");
  return {
    imageBytes: Buffer.from(b64, "base64"),
    mimeType: data.predictions[0].mimeType ?? "image/png",
  };
}

// ---------------------------------------------------------------------------
// Tier 3: Legacy text-only path (Gemini prompt → Imagen 4.0)
// ---------------------------------------------------------------------------

async function buildImagenPromptLegacy(input: {
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
      setTimeout(() => reject(new Error("keyframe tier3 stage-A timeout")), TIMEOUT_MS),
    ),
  ]);

  const text = (response as any).text ?? "";
  if (!text.trim()) {
    throw new Error("keyframe tier3 stage-A: Gemini returned empty prompt");
  }

  console.log("[keyframe][tier3] generated Imagen prompt:", text.trim().slice(0, 300));
  return text.trim();
}

async function tier3TextOnly(input: {
  keyframePrompt: string;
  templateFirstFrame: ImageInput;
  referenceFace: ImageInput;
  products: ImageInput[];
}): Promise<{ imageBytes: Buffer; mimeType: string }> {
  const imagenPrompt = await buildImagenPromptLegacy(input);

  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-4.0-generate-001:predict`;
  const token = await getAccessToken();

  const resp = await fetchWithTimeout(endpoint, token, {
    instances: [{ prompt: imagenPrompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: "9:16",
      personGeneration: "allow_adult",
      safetySetting: "block_some",
    },
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`keyframe tier3: Imagen returned ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) {
    throw new Error(`keyframe tier3: no image in response. Keys: ${Object.keys(data).join(", ")}`);
  }

  console.log("[keyframe][tier3] SUCCESS");
  return {
    imageBytes: Buffer.from(b64, "base64"),
    mimeType: data.predictions[0].mimeType ?? "image/png",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Composite a keyframe from template first frame + reference face + product
 * images. Uses a three-tier strategy to maximise identity preservation.
 */
export async function compositeKeyframe(input: {
  keyframePrompt: string;
  templateFirstFrame: ImageInput;
  referenceFace: ImageInput;
  products: ImageInput[];
}): Promise<{ imageBytes: Buffer; mimeType: string }> {
  // Tier 1 — Imagen 3 Customization (subject reference)
  console.log("[keyframe] trying Tier 1 — Imagen 3 Customization (imagen-3.0-capability-001)...");
  const tier1Result = await tier1Customization({
    keyframePrompt: input.keyframePrompt,
    referenceFace: input.referenceFace,
    products: input.products,
  });
  if (tier1Result) {
    console.log(`[keyframe] Tier 1 done — ${tier1Result.imageBytes.length} bytes, ${tier1Result.mimeType}`);
    return tier1Result;
  }

  // Tier 2 — Inpaint on reference face image
  console.log("[keyframe] Tier 1 unavailable — trying Tier 2 — Inpaint (imagen-3.0-generate-001)...");
  const tier2Result = await tier2Inpaint({
    keyframePrompt: input.keyframePrompt,
    referenceFace: input.referenceFace,
    products: input.products,
  });
  if (tier2Result) {
    console.log(`[keyframe] Tier 2 done — ${tier2Result.imageBytes.length} bytes, ${tier2Result.mimeType}`);
    return tier2Result;
  }

  // Tier 3 — Legacy text-only (last resort)
  console.log("[keyframe] Tier 2 unavailable — falling back to Tier 3 (text-only Imagen 4.0)...");
  const tier3Result = await tier3TextOnly(input);
  console.log(`[keyframe] Tier 3 done — ${tier3Result.imageBytes.length} bytes, ${tier3Result.mimeType}`);
  return tier3Result;
}
