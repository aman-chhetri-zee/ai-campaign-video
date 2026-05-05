// src/lib/pipeline/keyframe.ts
//
// Stage 5 — Keyframe Compositing
//
// Three-tier strategy for true identity preservation:
//
// Tier 1: Imagen 3 Customization (imagen-3.0-capability-001) with
//         REFERENCE_TYPE_SUBJECT — ALL looks go through here. Master subject
//         is visual ref [1]; primary product is visual ref [2] (capped at 2
//         per Imagen 3 9:16 limit). Secondary products described in text only.
//         Best identity preservation across single- and multi-product looks.
//
// Tier 2: Inpaint on the reference face image (imagen-3.0-generate-001) with
//         EDIT_MODE_INPAINT_INSERTION — fallback if Tier 1 fails. Preserves
//         the face exactly because it starts from the actual reference photo.
//         Scene won't match template perfectly but face is guaranteed.
//
// Tier 3: Text-only Imagen 4.0 (legacy, same as d2d36e9) — last resort.

import { getGenAIClient } from "../genai-client";
import { GoogleAuth } from "google-auth-library";
import { framingInstruction, type FramingScope } from "./framing";
import { withRetry } from "./retry";

const GEMINI_TEXT_MODEL = "gemini-2.5-pro";
const PROJECT_ID = process.env.GCP_PROJECT_ID || "creatoreconomy-479409";
const LOCATION = process.env.GCP_LOCATION || "us-central1";
const TIMEOUT_MS = 120_000;

export type ImageInput = { bytes: Buffer; mimeType: string };
export type ProductWithDescription = ImageInput & { description: string };

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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip mannequin / styling language that confuses Imagen Customization into
 * rendering a mannequin instead of the reference face subject.
 */
function sanitiseProductDescription(d: string): string {
  return d
    .replace(/\b(?:on a |displayed on a |styled on a |worn by a )?mannequin\b/gi, "")
    .replace(/\bthe (?:look|outfit|ensemble) (?:consists of|features|includes)\b/gi, "an outfit comprising")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Tier 1: Imagen 3 Customization with subject reference
// ---------------------------------------------------------------------------

/**
 * Build the Tier-1 prompt from the input keyframePrompt and product descriptions.
 * We synthesize it programmatically — no extra Gemini call needed.
 * [1] = master subject (face reference), [2] = primary product (visual ref).
 * Secondary products are described in text only (Imagen 3 Customization caps
 * at 2 reference images for 9:16 — face + 1 product).
 */
function buildTier1Prompt(
  keyframePrompt: string,
  primaryProductDescription: string | undefined,
  secondaryProductDescriptions: string[],
  framingScope: FramingScope,
  backgroundDescription?: string,
  hasSceneRef?: boolean,
): string {
  const base = keyframePrompt
    .replace(/IMAGE\s+\d+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const framing = framingInstruction(framingScope);
  const bgClause = backgroundDescription
    ? `Background: ${backgroundDescription}. The subject is set in this scene.`
    : "Background: clean neutral solid backdrop.";

  const primaryBinding = primaryProductDescription
    ? `Subject [2] is ${sanitiseProductDescription(primaryProductDescription)}; render this exact item on Subject [1] with high fidelity to its visual reference.`
    : "";

  const secondaryItems =
    secondaryProductDescriptions.length > 0
      ? `Additional items to also render naturally on Subject [1] alongside Subject [2]: ${secondaryProductDescriptions
          .map((d) => sanitiseProductDescription(d))
          .join("; ")}. Render each of these items based on the text description — match the described colors, materials, and style as closely as possible.`
      : "";

  const sceneRefClause = hasSceneRef
    ? `Use the third reference image (style/scene reference) to anchor the architectural scene — match its doorway, door object if visible, walls, floor surfaces, lighting, and spatial perspective. The scene must feel grounded and consistent with the reference, not aesthetically vague. `
    : "";

  const priorityList = hasSceneRef
    ? `Identity preservation is the highest priority; primary product visual fidelity is second; scene fidelity (door, architecture, lighting) is third; secondary product fidelity is fourth.`
    : `Identity preservation is the highest priority; primary product visual fidelity is second; secondary product fidelity is third.`;

  return (
    // STRICT identity match against master
    `Subject [1] is the SAME EXACT PERSON shown in the master subject reference image. ` +
    `The keyframe must look like the master subject simply changed clothes — every physical feature must match the master IDENTICALLY: ` +
    `(a) same face shape, jawline, cheekbone structure, eye shape and color, nose shape, lip shape; ` +
    `(b) same skin tone and texture; ` +
    `(c) same hair length, color, texture, parting, and styling; ` +
    `(d) same body type, weight, build, proportions, and height impression as the master. ` +
    `Do NOT alter, idealize, slim down, age down, or restyle Subject [1] in any way. ` +
    `If the master shows a person with average build, the keyframe must show that same average build — do not slim them. ` +
    `If the master shows long hair, the keyframe must show long hair of the same length. ` +
    `${framing} ${bgClause} ` +
    `${sceneRefClause}` +
    `${primaryBinding} ${secondaryItems} ` +
    `${base} ` +
    `All items mentioned above MUST appear in the keyframe — none can be omitted. ` +
    `Identity match to the master is the absolute highest priority — outranking primary product fidelity, scene fidelity, and secondary product fidelity.`
  );
}

async function tier1Customization(input: {
  keyframePrompt: string;
  referenceFace: ImageInput;
  templateFirstFrame?: ImageInput;
  products: ProductWithDescription[];
  faceDescription?: string;
  framingScope: FramingScope;
  backgroundDescription?: string;
}): Promise<{ imageBytes: Buffer; mimeType: string } | null> {
  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-3.0-capability-001:predict`;

  // Pick the FIRST product as the visual primary; describe the rest in text.
  // Imagen 3 Customization caps at 2 reference images for 9:16 (face + 1 product).
  const primary = input.products[0];
  const secondaries = input.products.slice(1);

  const hasSceneRef = !!input.templateFirstFrame;
  const prompt = buildTier1Prompt(
    input.keyframePrompt,
    primary?.description,
    secondaries.map((p) => p.description),
    input.framingScope,
    input.backgroundDescription,
    hasSceneRef,
  );
  console.log("[keyframe][tier1] prompt:", prompt.slice(0, 300));

  const faceB64 = input.referenceFace.bytes.toString("base64");

  const referenceImages: object[] = [
    {
      referenceType: "REFERENCE_TYPE_SUBJECT",
      referenceId: 1,
      referenceImage: { bytesBase64Encoded: faceB64 },
      subjectImageConfig: {
        subjectDescription: input.faceDescription?.trim() || "person from the master subject reference image",
        subjectType: "SUBJECT_TYPE_PERSON",
      },
    },
  ];

  if (primary) {
    referenceImages.push({
      referenceType: "REFERENCE_TYPE_SUBJECT",
      referenceId: 2,
      referenceImage: { bytesBase64Encoded: primary.bytes.toString("base64") },
      subjectImageConfig: {
        subjectDescription: sanitiseProductDescription(primary.description),
        subjectType: "SUBJECT_TYPE_PRODUCT",
      },
    });
  }

  // Add template first_frame as a STYLE/SCENE reference (ref id 3)
  if (input.templateFirstFrame) {
    referenceImages.push({
      referenceType: "REFERENCE_TYPE_STYLE",
      referenceId: 3,
      referenceImage: {
        bytesBase64Encoded: input.templateFirstFrame.bytes.toString("base64"),
      },
      styleImageConfig: {
        styleDescription:
          "scene composition reference: capture the architectural elements, doorway/door, room layout, lighting, and spatial perspective from this image",
      },
    });
  }

  const token = await getAccessToken();

  const isNonSquareReject = (errText: string) =>
    errText.includes("more than 2 reference images") ||
    errText.includes("non-square aspect-ratio");

  const makeRequest = (refs: object[]) =>
    withRetry(
      async () => {
        const r = await fetchWithTimeout(endpoint, token, {
          instances: [{ prompt, referenceImages: refs }],
          parameters: {
            sampleCount: 1,
            aspectRatio: "9:16",
            personGeneration: "allow_adult",
            safetySetting: "block_some",
          },
        });
        if (r.status >= 500 && r.status < 600) {
          throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        }
        return r;
      },
      { label: "tier1-customization" },
    );

  let resp: Response;
  try {
    resp = await makeRequest(referenceImages);
  } catch (err) {
    console.warn("[keyframe][tier1] fetch error:", err);
    return null;
  }

  // Handle the "more than 2 reference images for non-square" 400 gracefully —
  // Imagen returns this as a 400 (not 5xx), so it doesn't get thrown by withRetry.
  // We detect it here, strip the style ref, and retry with 2 refs.
  if (!resp.ok) {
    const errText = await resp.text();
    if (resp.status === 400 && isNonSquareReject(errText) && input.templateFirstFrame) {
      console.warn(
        "[keyframe][tier1] 3-ref rejected (non-square limit), retrying with 2 refs (no style anchor):",
        errText.slice(0, 200),
      );
      const trimmedRefs = referenceImages.filter((r: any) => r.referenceId !== 3);
      try {
        resp = await makeRequest(trimmedRefs);
      } catch (err2) {
        console.warn("[keyframe][tier1] 2-ref fallback also failed:", err2);
        return null;
      }
      // Fall through to the normal response handling below with the new resp
      if (!resp.ok) {
        const errText2 = await resp.text();
        console.warn(`[keyframe][tier1] HTTP ${resp.status} (2-ref fallback): ${errText2.slice(0, 400)}`);
        return null;
      }
    } else {
      console.warn(`[keyframe][tier1] HTTP ${resp.status}: ${errText.slice(0, 400)}`);
      // Treat 404 / model-not-found as "tier unavailable" — fall through
      return null;
    }
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
  products: ProductWithDescription[];
}): Promise<{ imageBytes: Buffer; mimeType: string } | null> {
  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-3.0-generate-001:predict`;

  const itemsDesc = input.products.map((p) => p.description).join("; ");
  const inpaintPrompt =
    `Keep this person's face EXACTLY as-is. ` +
    `Add the following items to them: ${itemsDesc}. ` +
    `Vertical 9:16 portrait, fashion photography, dramatic lighting.`;

  console.log("[keyframe][tier2] inpaint prompt:", inpaintPrompt.slice(0, 300));

  const faceB64 = input.referenceFace.bytes.toString("base64");
  const token = await getAccessToken();

  let resp: Response;
  try {
    resp = await withRetry(
      async () => {
        const r = await fetchWithTimeout(endpoint, token, {
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
        if (r.status >= 500 && r.status < 600) {
          throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        }
        return r;
      },
      { label: "tier2-inpaint" },
    );
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
  products: ProductWithDescription[];
}): Promise<string> {
  const ai = getGenAIClient();

  const itemsDesc = input.products.map((p) => p.description).join("; ");
  const systemInstruction = [
    "You are generating a single Imagen text-to-image prompt.",
    "Combine the following three inputs into one concise prompt (under 250 words):",
    "1. Replicate the EXACT scene, pose, background, lighting, and framing from IMAGE 1 (scene reference).",
    "2. Describe the EXACT facial features from IMAGE 2 (face reference): skin tone, hair colour/length/texture, face shape, eye shape, nose, lips, and any distinctive features such as nose studs or moles.",
    `3. The person is naturally wearing/holding all items shown across IMAGE 3+ — specifically: ${itemsDesc}.`,
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

  const response = await withRetry(
    () =>
      Promise.race([
        ai.models.generateContent({
          model: GEMINI_TEXT_MODEL,
          contents: [{ role: "user", parts }],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("keyframe tier3 stage-A timeout")), TIMEOUT_MS),
        ),
      ]),
    { label: "tier3-stage-a-prompt" },
  );

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
  products: ProductWithDescription[];
}): Promise<{ imageBytes: Buffer; mimeType: string }> {
  const imagenPrompt = await buildImagenPromptLegacy(input);

  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-4.0-generate-001:predict`;
  const token = await getAccessToken();

  const resp = await withRetry(
    async () => {
      const r = await fetchWithTimeout(endpoint, token, {
        instances: [{ prompt: imagenPrompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: "9:16",
          personGeneration: "allow_adult",
          safetySetting: "block_some",
        },
      });
      if (r.status >= 500 && r.status < 600) {
        throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }
      return r;
    },
    { label: "tier3-stage-b-imagen" },
  );

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
 *
 * ALL looks — single-product and multi-product — now route through Tier 1
 * first. Tier 1 uses the master subject as visual reference [1] and only the
 * FIRST product as visual reference [2] (respecting Imagen 3 Customization's
 * 2-image cap for 9:16). Secondary products are described in text within the
 * prompt. Falls back to Tier 2 → Tier 3 only on genuine API failure.
 */
export async function compositeKeyframe(input: {
  keyframePrompt: string;
  templateFirstFrame: ImageInput;
  referenceFace: ImageInput;
  products: ProductWithDescription[];
  faceDescription?: string;            // short description for identity anchoring
  framingScope?: FramingScope;         // controls framing instruction in Tier 1
  backgroundDescription?: string;      // background scene for Tier 1 prompt
}): Promise<{ imageBytes: Buffer; mimeType: string }> {
  console.log(`[keyframe] ${input.products.length}-product look — Tier 1 with master + primary product as visual refs`);

  const tier1Result = await tier1Customization({
    keyframePrompt: input.keyframePrompt,
    referenceFace: input.referenceFace,
    templateFirstFrame: input.templateFirstFrame,
    products: input.products,
    faceDescription: input.faceDescription,
    framingScope: input.framingScope ?? "chest_up",
    backgroundDescription: input.backgroundDescription,
  });
  if (tier1Result) {
    console.log(`[keyframe] Tier 1 done — ${tier1Result.imageBytes.length} bytes, ${tier1Result.mimeType}`);
    return tier1Result;
  }

  console.log("[keyframe] Tier 1 unavailable — trying Tier 2 — Inpaint...");
  const tier2Result = await tier2Inpaint({
    keyframePrompt: input.keyframePrompt,
    referenceFace: input.referenceFace,
    products: input.products,
  });
  if (tier2Result) {
    console.log(`[keyframe] Tier 2 done — ${tier2Result.imageBytes.length} bytes, ${tier2Result.mimeType}`);
    return tier2Result;
  }

  console.log("[keyframe] falling back to Tier 3 (final attempt)...");
  const tier3Result = await tier3TextOnly(input);
  console.log(`[keyframe] Tier 3 done — ${tier3Result.imageBytes.length} bytes, ${tier3Result.mimeType}`);
  return tier3Result;
}
