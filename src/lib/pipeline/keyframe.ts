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
  // Lifestyle / archetype / vibe words leak into face & body rendering when
  // Nano Banana Pro averages descriptions across the prompt. "Sporty / tennis-
  // wear" pulled a creator's face toward an athletic-model archetype on a real
  // run. Strip them so only objective visual attributes (color, material,
  // length, silhouette, branding) reach the prompt. Length descriptors (mini,
  // maxi, midi, cropped, long-sleeved, high-waisted, wide-leg) are NEVER
  // stripped — those are objective and must survive.
  const VIBE_WORDS = [
    "sporty", "athletic", "preppy", "chic", "elegant", "sophisticated",
    "minimalist", "edgy", "feminine", "masculine", "urban", "casual",
    "stylish", "fashionable", "trendy", "cute", "glamorous", "seductive",
    "professional", "office-ready", "business-casual", "modern",
    "luxurious", "polished", "youthful", "playful", "refined",
  ];
  const vibeRe = new RegExp(
    `\\b(?:${VIBE_WORDS.join("|")})\\b(?:\\s+and\\s+(?:${VIBE_WORDS.join("|")})\\b)?`,
    "gi",
  );
  return d
    .replace(/\b(?:on a |displayed on a |styled on a |worn by a )?mannequin\b/gi, "")
    .replace(/\bthe (?:look|outfit|ensemble) (?:consists of|features|includes)\b/gi, "an outfit comprising")
    .replace(/\b(?:likely\s+)?inspired by [a-z\s-]+?(?:wear|style|aesthetic|vibe|look)\b/gi, "")
    .replace(/\b(?:creating|offering|providing|giving) (?:a|an) (?:look|feel|sense|aesthetic|appearance|vibe) of [^.,;]+/gi, "")
    .replace(vibeRe, "")
    // Cleanup grammatical debris left behind by removed vibe words
    .replace(/\bfor an? \s*touch\b/gi, "")
    .replace(/\b(?:creating|offering|providing|giving) (?:a|an)? ?and? ?(?:look|feel|vibe|aesthetic|appearance)\b/gi, "")
    .replace(/\band\s+(?:look|feel|vibe|aesthetic|appearance)\b/gi, "")
    .replace(/\s+(?:and|,)\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .replace(/\bis a (?=[aeiou])/gi, "is an ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/,\s*\./g, ".")
    .replace(/,\s*,/g, ",")
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
    "Do NOT let the outfit's aesthetic, archetype, or lifestyle vibe (e.g., athletic, formal, casual, edgy, romantic) influence the subject's face, body proportions, or build. The subject's appearance is determined exclusively by the identity reference images, regardless of what the outfit's style suggests. Treat the outfit as clothing being placed on the identity-reference person — never as a hint about who the person should be.",
    args.faceDescription ? `Face description: ${args.faceDescription.trim()}` : "",
    "",
    args.products.length > 0
      ? "OUTFIT (MUST APPEAR IN FULL):"
      : "WARDROBE AND PROPS (NO USER PRODUCTS PROVIDED):",
    args.products.length > 0
      ? `The subject is wearing/holding the items shown in the outfit reference images: ${productList}. Every item must be rendered with high fidelity to its visual reference — match colors, materials, silhouette, and style. NONE of these items may be omitted, replaced with a default, or hallucinated. If footwear is among the items, ensure shoes are clearly visible at the feet. If a bag is among the items, place it in a hand or on a shoulder.`
      : "No user-provided product images. Render the subject wearing the same wardrobe and using/holding the same props that are visible in the scene reference image — match the scene's existing clothing, accessories, and any items the person in the scene reference is using. Do NOT invent generic clothing or generic products; let the scene's existing wardrobe and props pass through unchanged.",
    args.products.length > 0
      ? "GARMENT LENGTH AND PROPORTIONS: Each garment's length and silhouette must match the product reference image LITERALLY. A mini skirt stays mini (well above the knee); a midi skirt stays midi (mid-calf); a maxi skirt stays maxi (to the ankle). Short-sleeve stays short-sleeve; long-sleeve stays long-sleeve. Cropped tops stay cropped. High-waisted stays high-waisted. Do NOT lengthen, shorten, loosen, or otherwise reinterpret any garment to fit the scene's framing, the camera angle, or the outfit's overall vibe. If a length descriptor (mini / midi / maxi / cropped / full-length / knee-length) is present in the outfit description above, follow it exactly."
      : "",
    "",
    args.products.length > 0 ? "FALLBACK FOR UNCOVERED CLOTHING SLOTS:" : "",
    args.products.length > 0
      ? "For any clothing slot NOT covered by the explicit outfit reference images above (e.g., bottoms when only a top is selected, or footwear when no shoes are listed), DO NOT invent generic neutral defaults like a plain white tee or plain jeans. Instead, infer the missing pieces directly from the scene reference image — match the colors, silhouettes, fabric textures, and styling of whatever clothing the person in the scene reference is wearing — so the final outfit stays cohesive with the template's wardrobe. The selected products take precedence; the scene-inferred pieces only fill the slots the user did not pick."
      : "",
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

async function callNanoBananaPro(
  prompt: string,
  parts: object[],
  label: string,
): Promise<{ imageBytes: Buffer; mimeType: string }> {
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
    { label },
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`[keyframe] Nano Banana Pro HTTP ${resp.status}: ${errText.slice(0, 400)}`);
  }

  const data = await resp.json();
  const candidate = data.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find((p: any) => p.inlineData?.data);

  if (!imagePart) {
    const finishReason = candidate?.finishReason ?? "unknown";
    const textPart = candidate?.content?.parts?.find((p: any) => p.text)?.text;
    throw new Error(
      `[keyframe] Nano Banana Pro returned no image (finishReason=${finishReason}): ${textPart?.slice(0, 200) ?? JSON.stringify(data).slice(0, 300)}`,
    );
  }

  const imageBytes = Buffer.from(imagePart.inlineData.data, "base64");
  const mimeType = imagePart.inlineData.mimeType ?? "image/png";
  return { imageBytes, mimeType };
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

  const result = await callNanoBananaPro(prompt, parts, "keyframe-nano-banana-pro");
  console.log(`[keyframe] Nano Banana Pro SUCCESS — ${result.imageBytes.length} bytes, ${result.mimeType}`);
  return result;
}

/**
 * Generate a PRODUCT-ONLY hero keyframe — no person in shot. Used for ad-style
 * templates where some shots are pure product showcases (the perfume bottle on
 * crystals, ice, etc.). Takes the template's scene reference + the product
 * images and renders a clean hero composition with no human subject.
 */
export async function compositeProductOnlyKeyframe(input: {
  templateFirstFrame: ImageInput;            // scene context
  products: ProductWithDescription[];        // products to feature in the hero shot
  shotDescription?: string;                  // motion_script entry's action text for this shot
  backgroundDescription?: string;            // scene-specific background description
}): Promise<{ imageBytes: Buffer; mimeType: string }> {
  const parts: object[] = [];
  const refOrder: string[] = [];

  parts.push(inlinePart(input.templateFirstFrame));
  refOrder.push("scene reference (target environment, lighting, color palette, and composition style)");

  for (let i = 0; i < input.products.length; i++) {
    parts.push(inlinePart(input.products[i]));
    refOrder.push(`product ${i + 1} to feature: ${sanitiseProductDescription(input.products[i].description).slice(0, 80)}`);
  }

  const productList = input.products
    .map((p, i) => `(${i + 1}) ${sanitiseProductDescription(p.description)}`)
    .join("; ");
  const refList = refOrder.map((label, i) => `Image ${i + 1}: ${label}`).join("\n");

  const prompt = [
    "Generate a single photorealistic PRODUCT HERO photograph. NO PEOPLE. No subject, no model, no person — just the product(s) presented in the scene.",
    "",
    "REFERENCE IMAGES (in order):",
    refList,
    "",
    "PRODUCT (MUST APPEAR IN FULL):",
    `Render the following product(s) as the visual subject of the frame: ${productList}. Match every detail of each product's visual reference — colors, materials, finish, label/text, silhouette, proportions. Do NOT render any human, hand, body part, or person in the frame.`,
    "",
    "SCENE:",
    input.backgroundDescription
      ? `Place the product(s) in this environment: ${input.backgroundDescription}.`
      : "Place the product(s) in the environment shown in the scene reference image.",
    "Match the scene reference's color palette, lighting style (direction, hardness, color temperature), depth of field, and overall composition mood. The product is the hero — the rest of the frame supports it.",
    "",
    input.shotDescription
      ? `SHOT DIRECTION: ${input.shotDescription.replace(/\s+/g, " ").trim().slice(0, 400)}`
      : "",
    "",
    "Output: a single 9:16 vertical photograph, professional commercial product photography quality. The subject of the photo is the PRODUCT, not a person — there must be no human anywhere in the image.",
  ]
    .filter(Boolean)
    .join("\n");

  console.log(
    `[keyframe][product-only] Nano Banana Pro — ${input.products.length}-product hero, ${parts.length} ref images`,
  );
  console.log(`[keyframe][product-only] prompt:`, prompt.slice(0, 400).replace(/\n/g, " "));

  const result = await callNanoBananaPro(prompt, parts, "keyframe-product-only-nano-banana-pro");
  console.log(`[keyframe][product-only] Nano Banana Pro SUCCESS — ${result.imageBytes.length} bytes, ${result.mimeType}`);
  return result;
}
