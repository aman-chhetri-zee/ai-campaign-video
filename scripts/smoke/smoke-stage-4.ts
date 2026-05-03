// scripts/smoke/smoke-stage-4.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { orchestratePrompts } from "../../src/lib/pipeline/orchestrate";
import type {
  TemplateMetadata,
  ProductMetadata,
  FaceMetadata,
} from "../../src/lib/pipeline/types";

const TEMPLATE_FIXTURE: TemplateMetadata = {
  scene_description: "Young woman walks toward camera through a sunlit cafe.",
  subject: {
    rough_pose: "standing, walking forward",
    framing: "medium-wide to chest-up closeup",
    lighting: "warm golden-hour, key light from camera-left",
  },
  motion_script: [
    { t_start: 0.0, t_end: 1.5, action: "walks forward, arms relaxed" },
    { t_start: 1.5, t_end: 3.0, action: "raises hand toward face, smiles" },
    { t_start: 3.0, t_end: 5.0, action: "settles into closeup" },
  ],
  composition_notes: "shallow depth of field, warm color grade, vertical 9:16",
  style: {
    lens: "natural 50mm",
    color_treatment: "warm golden hour",
    lighting_effects: "soft natural rim",
    special_effects: [],
  },
  pose_archetypes: ["confident", "playful", "stylish"],
  energy: "smooth cinematic walk",
  shot_backgrounds: ["sunlit cafe interior with warm wood tones"],
};

const WATCH_FIXTURE: ProductMetadata = {
  primary_item_type: "wristwatch",
  items: [
    {
      item_type: "wristwatch",
      attachment_strategy: "worn_on_wrist",
      side_preference: "left_wrist",
      visual_description: "silver round-face analog watch with brown leather strap",
    },
  ],
  overall_description: "silver analog wristwatch on brown leather strap",
  key_features: ["silver case", "brown leather", "white dial"],
};

const BAG_FIXTURE: ProductMetadata = {
  primary_item_type: "handbag",
  items: [
    {
      item_type: "handbag",
      attachment_strategy: "carried_on_shoulder",
      side_preference: "none",
      visual_description: "brown leather tote with shoulder strap",
    },
  ],
  overall_description: "brown leather shoulder tote",
  key_features: ["brown leather", "shoulder strap", "open top"],
};

const FACE_FIXTURE: FaceMetadata = {
  perceived_gender: "female",
  age_range: "25-30",
  skin_tone: "medium",
  hair: "shoulder-length, dark brown, straight",
  distinctive_features: "high cheekbones, brown eyes, slight smile",
  ethnicity_cues: "south asian features",
};

async function main() {
  console.log("[smoke-4] orchestrating prompts...");
  const result = await orchestratePrompts({
    template: TEMPLATE_FIXTURE,
    products: [WATCH_FIXTURE, BAG_FIXTURE],
    face: FACE_FIXTURE,
    options: { look_index: 0, total_looks: 2 },
  });

  console.log("[smoke-4] result:", JSON.stringify(result, null, 2));

  if (!result.keyframe_prompt) throw new Error("missing keyframe_prompt");
  if (!result.motion_prompt) throw new Error("missing motion_prompt");
  if (!result.negative_prompt) throw new Error("missing negative_prompt");

  if (!result.keyframe_prompt.includes("IMAGE 1")) {
    throw new Error("keyframe_prompt does not reference IMAGE 1");
  }
  if (!result.keyframe_prompt.includes("IMAGE 2")) {
    throw new Error("keyframe_prompt does not reference IMAGE 2");
  }

  const motionWords = result.motion_prompt.trim().split(/\s+/).length;
  if (motionWords > 80) {
    console.warn(`[smoke-4] WARN motion_prompt is ${motionWords} words (>60 expected)`);
  }

  console.log("[smoke-4] PASS");
}

main().catch((err) => {
  console.error("[smoke-4] FAIL:", err);
  process.exit(1);
});
