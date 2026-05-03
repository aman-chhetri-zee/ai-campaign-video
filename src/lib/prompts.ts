// src/lib/prompts.ts
import type {
  TemplateMetadata,
  ProductMetadata,
  FaceMetadata,
} from "./pipeline/types";
import type { FramingScope } from "./pipeline/framing";
import { framingInstruction } from "./pipeline/framing";

export const TEMPLATE_ANALYSIS_PROMPT = `
You are analyzing a short reference video that will guide AI video generation.
Extract objective motion AND visual style information.

CONSTRAINTS:
- motion_script must cover the full duration with no time gaps
- each action must be a single, concrete physical action a video model can replicate
- DO NOT describe subject identity (face, ethnicity, clothing) — identity will be replaced
- DO NOT name brands/products visible in the video — products will be inserted fresh
- DO extract STYLE: lens type (e.g., "fisheye distortion", "natural 50mm"), color treatment
  (e.g., "neon-saturated with deep blacks", "warm golden hour"), lighting effects
  (e.g., "neon rim lighting with red and blue accents"), and special effects
  (e.g., "ghosting trails", "RGB chromatic aberration", "flicker", "lens flare")
- DO extract POSE ARCHETYPES — short adjectives describing the energetic poses across the
  video (e.g., "playful", "cool", "cute", "surprised", "stylish", "confident", "dramatic")
- DO extract overall ENERGY in one short phrase (e.g., "high-energy fast-cut montage",
  "slow cinematic", "playful and punchy")
- DO extract SHOT BACKGROUNDS — a list of distinct background settings used across the
  video's shots, in the order they appear (e.g., ["modern interior doorway, bright
  natural daylight outside, hardwood floor", "outdoor walkway in front of a modern
  house, late-afternoon sun, manicured lawn"]). One entry per visually distinct
  background. Aim for 2-6 entries. If the entire video shares ONE background, return
  a one-element array.

OUTPUT: strict JSON matching the response_schema.
`.trim();

export const PRODUCT_ANALYSIS_PROMPT = `
Catalogue ALL wearable or holdable items visible in this product image. A
single product image often shows an outfit or look with multiple items
(e.g., a top together with a necklace). Enumerate every item.

For each item, specify item_type, attachment_strategy, side_preference, and
visual_description. Then provide a primary_item_type (the most prominent
item, used as the catalog label), an overall_description summarising the
look, and key_features capturing notable details across the items.

CONSTRAINTS:
- attachment_strategy must be one of:
  worn_on_wrist | worn_on_face | held_in_hand |
  carried_on_shoulder | worn_around_neck | placed_on_surface |
  worn_on_torso | worn_on_legs
- side_preference must be one of:
  left_wrist | right_wrist | left_hand | right_hand | center | none
- be precise about color and material — these drive product fidelity
- enumerate at least 1 item; the items array must not be empty

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
  options?: {
    look_index?: number;
    total_looks?: number;
    framing_scope?: FramingScope;
    background_for_look?: string;
  },
): string {
  const idx = options?.look_index ?? 0;
  const total = options?.total_looks ?? 1;
  const framingScope = options?.framing_scope ?? "chest_up";
  const archetypes = template.pose_archetypes && template.pose_archetypes.length > 0
    ? template.pose_archetypes
    : ["confident"];
  const poseForThisLook = archetypes[idx % archetypes.length];
  const framingText = framingInstruction(framingScope);
  const background = options?.background_for_look ?? "clean neutral solid backdrop";

  return `
You are composing prompts for two AI models in a video pipeline.
You will receive analysis JSON from earlier stages and must emit three text
prompts: keyframe_prompt, motion_prompt, negative_prompt.

INPUTS:
- template_analysis: ${JSON.stringify(template, null, 2)}
- product_analyses: ${JSON.stringify(products, null, 2)}
- face_analysis: ${JSON.stringify(face, null, 2)}
- look_position: ${idx + 1} of ${total}
- assigned_pose_archetype_for_this_look: "${poseForThisLook}"
- required_framing: "${framingScope}" — ${framingText}

----------------------------------------------------------------------
keyframe_prompt — for Imagen 3 Customization (multi-image input).
Image inputs supplied in this order:
  IMAGE 1 = template's first frame (style reference, optional anchor)
  IMAGE 2 = reference face (identity source)
  IMAGE 3+ = product images (product subject references)

Your keyframe_prompt MUST:
1. Open with: "Compose a single still image that recreates the scene/style from
   IMAGE 1 but featuring the person from IMAGE 2 (preserving their face exactly),
   naturally wearing/holding the products from IMAGE 3 onward."
2. EXPLICITLY adopt the template's style — quote it: "${template.style?.lens ?? "natural"}; ${template.style?.color_treatment ?? "natural color"}; ${template.style?.lighting_effects ?? "natural lighting"}; ${(template.style?.special_effects ?? []).join(", ")}".
3. EXPLICITLY adopt the assigned pose archetype: "${poseForThisLook} pose, leaning toward
   the camera with intent".
4. EXPLICITLY adopt the required framing: ${framingText}
5. For EACH item across all products' items, state explicit placement using its
   attachment_strategy. If framing is "full_body", footwear must be explicitly described
   as visible at the feet.
6. EXPLICITLY render the background: "${background}". This must be the scene
   behind the subject. The subject is in this environment, not floating against a
   blank backdrop.
7. End with the identity lock:
   "The face must match IMAGE 2 EXACTLY — same eye shape, same skin tone, same hair,
   same distinctive features described in face_analysis (note these specifically:
   ${face.distinctive_features}). Do not generate a different face. Identity preservation
   is the highest priority."

----------------------------------------------------------------------
motion_prompt — for Kling image-to-video.
Kling animates from the keyframe; it does NOT re-render identity or products.

Your motion_prompt MUST:
1. Describe motion appropriate for a "${poseForThisLook}" archetype — leaning toward
   the camera, expression shift to match the archetype mood (e.g., playful = quick
   smile + small head bob; cool = subtle smolder + slow turn; cute = bashful smile +
   tilt; surprised = eyebrow raise + small recoil; stylish = chin lift + half-turn).
2. Include camera energy from template_analysis.energy and template.style.lens
   (e.g., fisheye → mention slight lens push-in).
3. NOT describe the subject's face, body, or the products.
4. Stay under 60 words.

----------------------------------------------------------------------
negative_prompt — shared across both calls.

ALWAYS include:
  "blurry face, distorted hands, deformed limbs, extra fingers,
   missing products, floating objects, face morphing, identity drift,
   warped product, duplicate limbs, generic stock-photo face,
   different person, model swap"

PLUS, per product item type, append targeted negatives based on the items.

OUTPUT: strict JSON with three string fields:
{ "keyframe_prompt": string, "motion_prompt": string, "negative_prompt": string }
`.trim();
}
