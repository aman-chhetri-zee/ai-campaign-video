// src/lib/pipeline/types.ts

// ----- Stage 1 output -----
export type MotionScriptEntry = {
  t_start: number;
  t_end: number;
  action: string;
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
};

// ----- Stage 2 output -----
export type AttachmentStrategy =
  | "worn_on_wrist"
  | "worn_on_face"
  | "held_in_hand"
  | "carried_on_shoulder"
  | "worn_around_neck"
  | "placed_on_surface";

export type SidePreference =
  | "left_wrist"
  | "right_wrist"
  | "left_hand"
  | "right_hand"
  | "center"
  | "none";

export type ProductMetadata = {
  product_type: string;
  attachment_strategy: AttachmentStrategy;
  side_preference: SidePreference;
  visual_description: string;
  key_features: string[];
};

// ----- Stage 3 output -----
export type FaceMetadata = {
  perceived_gender: string;
  age_range: string;
  skin_tone: string;
  hair: string;
  distinctive_features: string;
  ethnicity_cues: string;
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

// ----- Run state (in-memory store) -----
export type RunStatus =
  | "analyzing_face"
  | "orchestrating"
  | "compositing_keyframe"
  | "generating_video"
  | "succeeded"
  | "failed";

export type RunState = {
  run_id: string;
  status: RunStatus;
  progress_label: string;
  template_id: string;
  product_ids: string[];
  reference_face_path: string;
  keyframe_url?: string;
  video_url?: string;
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
