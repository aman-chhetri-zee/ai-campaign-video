// src/lib/prompts.ts
import type {
  TemplateMetadata,
  ProductMetadata,
  FaceMetadata,
} from "./pipeline/types";

export const TEMPLATE_ANALYSIS_PROMPT = `
You are analyzing a short reference video that will guide AI video generation.
Extract objective motion and composition information.

CONSTRAINTS:
- motion_script must cover the full duration with no time gaps
- each action must be a single, concrete physical action a video model can replicate
- DO NOT describe subject identity (face, ethnicity, clothing) — identity will be replaced
- DO NOT name brands/products visible in the video — products will be inserted fresh

OUTPUT: strict JSON matching the response_schema.
`.trim();

export const PRODUCT_ANALYSIS_PROMPT = `
Catalogue this product image for downstream AI video generation.

CONSTRAINTS:
- attachment_strategy must be one of:
  worn_on_wrist | worn_on_face | held_in_hand |
  carried_on_shoulder | worn_around_neck | placed_on_surface
- side_preference must be one of:
  left_wrist | right_wrist | left_hand | right_hand | center | none
- be precise about color and material — these drive product fidelity in the keyframe

OUTPUT: strict JSON matching the response_schema.
`.trim();

export const FACE_ANALYSIS_PROMPT = `
Describe this reference photo objectively for downstream identity-preserving
image generation. Use descriptive, neutral language only. Avoid subjective
language ("beautiful", "ordinary"). The goal is enough detail that a downstream
image generator can preserve this exact identity.

OUTPUT: strict JSON matching the response_schema.
`.trim();

export const JUDGE_PROMPT = `
Compare a generated keyframe against the inputs that produced it.
Determine whether identity and products are correctly represented.

INPUTS (multi-image):
- IMAGE 1 = generated keyframe
- IMAGE 2 = reference face used as identity source
- IMAGE 3+ = product images that should appear in the keyframe

OUTPUT: strict JSON
{
  "identity_preserved": <bool — does IMAGE 1's face match IMAGE 2?>,
  "all_products_present": <bool — are ALL products from IMAGE 3+ visible?>,
  "products_correctly_placed": <bool — are products on the right body parts?>,
  "issues": [<string descriptions of any problems>]
}

Be strict on identity_preserved. Be lenient on minor product styling differences
as long as the product is recognizably the same item.
`.trim();

/**
 * Build the orchestration prompt by injecting analysis JSONs.
 * The orchestration call is itself a Gemini text call — this prompt instructs
 * Gemini how to compose the keyframe_prompt, motion_prompt, negative_prompt.
 */
export function buildOrchestrationPrompt(
  template: TemplateMetadata,
  products: ProductMetadata[],
  face: FaceMetadata,
): string {
  return `
You are composing prompts for two AI models in a video pipeline.
You will receive analysis JSON from earlier stages and must emit three text
prompts: keyframe_prompt, motion_prompt, negative_prompt.

INPUTS:
- template_analysis: ${JSON.stringify(template, null, 2)}
- product_analyses: ${JSON.stringify(products, null, 2)}
- face_analysis: ${JSON.stringify(face, null, 2)}

----------------------------------------------------------------------
keyframe_prompt — for Nano Banana Pro (multi-image input).

The image inputs to Nano Banana Pro will be supplied in this order:
  IMAGE 1 = template's first frame
  IMAGE 2 = reference face
  IMAGE 3, IMAGE 4 = product images (in selection order)

Your keyframe_prompt MUST:
1. Open with: "Compose a single still image that recreates the scene
   and pose shown in IMAGE 1, but featuring the person from IMAGE 2
   (preserving their face exactly), naturally wearing/holding the
   products from IMAGE 3 onward."
2. For EACH product, state explicit placement using its attachment_strategy.
   Example: "The wristwatch from IMAGE 3 is worn on the LEFT wrist,
   clearly visible on the inside of the arm."
3. Carry the template's lighting, framing, and composition_notes verbatim.
4. End with the identity lock:
   "The face must match IMAGE 2 EXACTLY — same eye shape, same skin tone,
   same hair, same distinctive features. Do not generate a different face.
   Do not stylize the face. Identity preservation is the highest priority."

----------------------------------------------------------------------
motion_prompt — for Kling image-to-video.

Kling animates from the keyframe; it does NOT re-render identity or products.
Repeating identity description here causes face drift.

Your motion_prompt MUST:
1. Translate the motion_script into one tight paragraph of action.
2. Include camera movement from template_analysis.composition_notes.
3. NOT describe the subject's face, body, or the products.
4. Stay under 60 words.

----------------------------------------------------------------------
negative_prompt — shared across both calls.

ALWAYS include:
  "blurry face, distorted hands, deformed limbs, extra fingers,
   missing products, floating objects, face morphing, identity drift,
   warped product, duplicate limbs"

PLUS, per product type, append targeted negatives:
  wristwatch  → "watch on wrong wrist, missing watch, watch face warped"
  handbag     → "bag floating, bag detached from hand, distorted strap"
  sunglasses  → "missing glasses, glasses on forehead"
  (extend as the catalog grows)

OUTPUT: strict JSON with three string fields:
{ "keyframe_prompt": string, "motion_prompt": string, "negative_prompt": string }
`.trim();
}
