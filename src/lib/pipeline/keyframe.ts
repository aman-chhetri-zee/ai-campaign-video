// src/lib/pipeline/keyframe.ts
//
// Stage 5 — Keyframe Compositing via Nano Banana Pro (gemini-3-pro-image-preview)
//
// One model, no tiers. Gemini 3 Pro Image is multimodal-native: it reads each
// reference image as conversational context (not a diffusion feature hint),
// has no 2-ref cap on 9:16, and actually honors directives like "render this
// exact person." Replaces the prior Imagen 3 Customization → Imagen Inpaint →
// Imagen 4.0 text-only fallback chain.
//
// Endpoint: aiplatform.googleapis.com (global; no region prefix)
// Auth: GoogleAuth via GOOGLE_APPLICATION_CREDENTIALS service account.

import { GoogleAuth } from "google-auth-library";
import { framingInstruction, type FramingScope } from "./framing";
import { withRetry } from "./retry";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "creatoreconomy-479409";
const MODEL_ID = "gemini-3-pro-image-preview";
const LOCATION = "global";
const HOST = "aiplatform.googleapis.com";
const TIMEOUT_MS = 180_000; // Nano Banana Pro routinely takes 60s; allow 3 min headroom

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
  const client = await auth.getClient();
  const tok = await client.getAccessToken();
  if (!tok.token) throw new Error("keyframe: failed to obtain access token");
  return tok.token;
}

function inlinePart(img: ImageInput) {
  return { inlineData: { mimeType: img.mimeType, data: img.bytes.toString("base64") } };
}

function sanitiseProductDescription(d: string): string {
  return d
    .replace(/\b(?:on a |displayed on a |styled on a |worn by a )?mannequin\b/gi, "")
    .replace(/\bthe (?:look|outfit|ensemble) (?:consists of|features|includes)\b/gi, "an outfit comprising")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildPrompt(
  args: {
    keyframePrompt: string;
    products: ProductWithDescription[];
    framingScope: FramingScope;
    backgroundDescription?: string;
    faceDescription?: string;
    refOrder: string[]; // labeled image order matching parts array
  },
): string {
  const base = args.keyframePrompt.replace(/IMAGE\s+\d+/gi, "").replace(/\s{2,}/g, " ").trim();
  const framing = framingInstruction(args.framingScope);
  const bgClause = args.backgroundDescription
    ? `Background: ${args.backgroundDescription}.`
    : "Background: clean neutral solid backdrop.";

  const refList = args.refOrder
    .map((label, i) => `Image ${i + 1}: ${label}`)
    .join("\n");

  const productList = args.products
    .map((p, i) => `(${i + 1}) ${sanitiseProductDescription(p.description)}`)
    .join("; ");

  return [
    "Generate a single photorealistic fashion keyframe.",
    "",
    "REFERENCE IMAGES (in order):",
    refList,
    "",
    "IDENTITY (HIGHEST PRIORITY):",
    "The subject is the EXACT SAME PERSON shown in Image 1 (and Image 2 if provided). Render them as if they walked out of that photo into the new scene. Do NOT idealize, slim down, age down, or restyle them. Preserve every physical feature identically: face shape, jawline, cheekbone structure, eye shape and color, nose shape and any nose stud, lip shape, skin tone and texture, hair length / color / texture / parting, body type / weight / build / proportions / height impression. If the reference shows a person with average build, render that same average build — do not slim them. If the reference shows long hair, render long hair of the same length.",
    args.faceDescription ? `Face description: ${args.faceDescription.trim()}` : "",
    "",
    "OUTFIT (MUST APPEAR IN FULL):",
    `The subject is wearing/holding the items shown in the outfit reference images: ${productList}. Every item must be rendered with high fidelity to its visual reference — match colors, materials, silhouette, and style. NONE of these items may be omitted, replaced with a default, or hallucinated. If footwear is among the items, ensure shoes are clearly visible at the feet. If a bag is among the items, place it in a hand or on a shoulder.`,
    "",
    "FRAMING:",
    framing,
    "",
    "SCENE:",
    bgClause,
    "Use any scene reference image (if present) to anchor the architectural elements, doorway, walls, floor, lighting, and spatial perspective.",
    "",
    "ADDITIONAL DIRECTION:",
    base,
    "",
    "Output: a single 9:16 vertical photograph, professional fashion photography quality. Identity match to Image 1 is the absolute highest priority — outranking outfit fidelity and scene fidelity.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function compositeKeyframe(input: {
  keyframePrompt: string;
  templateFirstFrame: ImageInput;
  referenceFace: ImageInput;            // primary identity anchor (real photo or master)
  masterSubject?: ImageInput;           // secondary body/pose anchor (master subject)
  products: ProductWithDescription[];
  faceDescription?: string;
  framingScope?: FramingScope;
  backgroundDescription?: string;
}): Promise<{ imageBytes: Buffer; mimeType: string }> {
  const framingScope = input.framingScope ?? "chest_up";

  // Build the reference image order: face → master → scene → products
  const parts: object[] = [];
  const refOrder: string[] = [];

  parts.push(inlinePart(input.referenceFace));
  refOrder.push("primary identity reference (the EXACT person to render)");

  if (input.masterSubject) {
    parts.push(inlinePart(input.masterSubject));
    refOrder.push("secondary body/pose anchor (same person, full-body canonical view)");
  }

  parts.push(inlinePart(input.templateFirstFrame));
  refOrder.push("scene reference (target architectural setting and lighting)");

  for (let i = 0; i < input.products.length; i++) {
    parts.push(inlinePart(input.products[i]));
    refOrder.push(`outfit item ${i + 1}: ${sanitiseProductDescription(input.products[i].description).slice(0, 80)}`);
  }

  const prompt = buildPrompt({
    keyframePrompt: input.keyframePrompt,
    products: input.products,
    framingScope,
    backgroundDescription: input.backgroundDescription,
    faceDescription: input.faceDescription,
    refOrder,
  });

  console.log(
    `[keyframe] Nano Banana Pro — ${input.products.length}-product look, ${parts.length} ref images`,
  );
  console.log(`[keyframe] prompt:`, prompt.slice(0, 400).replace(/\n/g, " "));

  const endpoint = `https://${HOST}/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:generateContent`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, ...parts],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "9:16" },
    },
  };

  const resp = await withRetry(
    async () => {
      const token = await getAccessToken();
      const fetchPromise = fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const r = await Promise.race([
        fetchPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`HTTP request timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
        ),
      ]);
      if (r.status >= 500 && r.status < 600) {
        throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
      }
      return r;
    },
    { label: "keyframe-nano-banana-pro" },
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(
      `[keyframe] Nano Banana Pro HTTP ${resp.status}: ${errText.slice(0, 400)}`,
    );
  }

  const data = await resp.json();
  const candidate = data.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find(
    (p: any) => p.inlineData?.data,
  );

  if (!imagePart) {
    const finishReason = candidate?.finishReason ?? "unknown";
    const textPart = candidate?.content?.parts?.find((p: any) => p.text)?.text;
    throw new Error(
      `[keyframe] Nano Banana Pro returned no image (finishReason=${finishReason}): ${textPart?.slice(0, 200) ?? JSON.stringify(data).slice(0, 300)}`,
    );
  }

  const imageBytes = Buffer.from(imagePart.inlineData.data, "base64");
  const mimeType = imagePart.inlineData.mimeType ?? "image/png";
  console.log(`[keyframe] Nano Banana Pro SUCCESS — ${imageBytes.length} bytes, ${mimeType}`);
  return { imageBytes, mimeType };
}
