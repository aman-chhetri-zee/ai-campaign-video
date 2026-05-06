// src/lib/pipeline/types.ts

// ----- Stage 1 output -----
export type MotionScriptEntry = {
  t_start: number;
  t_end: number;
  action: string;
};

export type TemplateStyle = {
  lens: string;                    // e.g. "fisheye distortion (extreme wide)", "natural 50mm", "wide-angle"
  color_treatment: string;         // e.g. "neon-saturated with deep blacks", "warm golden hour", "moody desaturated"
  lighting_effects: string;        // e.g. "neon rim lighting with red/blue accents", "soft natural", "studio key+fill"
  special_effects: string[];       // e.g. ["ghosting trails", "RGB chromatic aberration", "flicker", "lens flare"]
};

export type OutfitSegment = {
  t_start: number;            // segment start in template seconds
  t_end: number;              // segment end in template seconds
  shot_indices: number[];     // motion_script entry indices that this outfit slot covers
};

export type TemplateMetadata = {
  scene_description: string;
  subject: {
    rough_pose: string;
    framing: string;
    lighting: string;
  };
  motion_script: MotionScriptEntry[];
  composition_notes: string;
  style: TemplateStyle;
  pose_archetypes: string[];       // e.g. ["playful", "cool", "cute", "surprised", "stylish"]
  energy: string;                  // e.g. "high-energy fast-cut montage", "slow cinematic", "punchy"
  shot_backgrounds: string[];      // short descriptions of DISTINCT backgrounds across the template's shots, in order
  outfit_segments: OutfitSegment[]; // outfit slots in this template — drives per-look segmentation in the orchestrator
};

// ----- Stage 2 output -----
export type AttachmentStrategy =
  | "worn_on_wrist"
  | "worn_on_face"
  | "held_in_hand"
  | "carried_on_shoulder"
  | "worn_around_neck"
  | "placed_on_surface"
  | "worn_on_torso"
  | "worn_on_legs";

export type SidePreference =
  | "left_wrist"
  | "right_wrist"
  | "left_hand"
  | "right_hand"
  | "center"
  | "none";

export type ProductItem = {
  item_type: string;                     // "necklace", "top", "watch", etc.
  attachment_strategy: AttachmentStrategy;
  side_preference: SidePreference;
  visual_description: string;
};

export type ProductMetadata = {
  primary_item_type: string;             // for catalog display ("necklace" or "outfit")
  items: ProductItem[];                  // 1+ wearable/holdable items in the product image
  overall_description: string;           // total summary used for prompt building
  key_features: string[];                // notable features across all items
};

// ----- Stage 3 output -----
export type FaceMetadata = {
  perceived_gender: string;
  age_range: string;
  skin_tone: string;
  hair: string;
  distinctive_features: string;
  ethnicity_cues: string;
  // NEW
  is_full_body: boolean;            // true if the reference image shows the full body, false if face-only/selfie
  body_description: string;         // if is_full_body=true, a detailed description of build, weight, proportions, height impression. Empty string otherwise.
  visible_clothing_in_reference: string;  // what they're wearing in the reference (helps master generation match clothing context)
};

// ----- Stage 4 output -----
export type OrchestratedPrompts = {
  keyframe_prompt: string;
  motion_prompt: string;
  negative_prompt: string;
};

// ----- Stage 5b output -----
export type JudgeReport = {
  identity_preserved: boolean;
  all_products_present: boolean;
  products_correctly_placed: boolean;
  issues: string[];
};

// ----- Look (one outfit = one shot) -----
export type Look = {
  product_ids: string[]; // 1-3 items per look
};

// ----- Run state (in-memory store) -----
export type RunStatus =
  | "analyzing_face"
  | "orchestrating"
  | "compositing_keyframe"
  | "generating_video"
  | "concatenating"
  | "succeeded"
  | "failed";

export type RunState = {
  run_id: string;
  status: RunStatus;
  progress_label: string;
  template_id: string;
  looks: Look[];
  reference_face_path: string;
  current_look_index?: number;
  total_looks?: number;
  per_look_keyframe_urls?: string[];
  per_look_clip_urls?: string[];
  video_url?: string; // populated only after final concat
  error?: string;
  started_at: number;
};

// ----- Catalog entries on disk (metadata.json wrappers) -----
export type TemplateAsset = {
  id: string;
  title: string;
  description: string;
  video_path: string;       // relative to public/, e.g. "templates/cafe-walk/video.mp4"
  first_frame_path: string;
  metadata: TemplateMetadata;
};

export type ProductAsset = {
  id: string;
  name: string;
  description: string;
  image_path: string;       // relative to public/
  metadata: ProductMetadata;
};
