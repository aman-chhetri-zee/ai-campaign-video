// scripts/smoke/smoke-stage-1.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeTemplateVideo } from "../../src/lib/pipeline/template-analysis";

async function main() {
  const videoPath = resolve("public/templates/template-1/video.mp4");
  const buffer = readFileSync(videoPath);

  console.log(`[smoke-1] analyzing ${videoPath}...`);
  const result = await analyzeTemplateVideo({
    videoBytes: buffer,
    mimeType: "video/mp4",
  });

  console.log("[smoke-1] result:", JSON.stringify(result, null, 2));

  if (!result.scene_description) throw new Error("missing scene_description");
  if (!result.subject?.rough_pose) throw new Error("missing subject.rough_pose");
  if (!Array.isArray(result.motion_script) || result.motion_script.length === 0) {
    throw new Error("motion_script is empty");
  }
  for (const entry of result.motion_script) {
    if (typeof entry.t_start !== "number" || typeof entry.t_end !== "number") {
      throw new Error("motion_script entry missing t_start/t_end");
    }
    if (!entry.action) throw new Error("motion_script entry missing action");
  }

  if (!result.style?.lens) throw new Error("missing style.lens");
  if (!result.style?.color_treatment) throw new Error("missing style.color_treatment");
  if (!Array.isArray(result.style?.special_effects)) throw new Error("missing style.special_effects");
  if (!Array.isArray(result.pose_archetypes) || result.pose_archetypes.length === 0) {
    throw new Error("pose_archetypes empty");
  }
  if (!result.energy) throw new Error("missing energy");

  if (!Array.isArray(result.shot_backgrounds) || result.shot_backgrounds.length === 0) {
    throw new Error("shot_backgrounds empty");
  }

  console.log("[smoke-1] PASS");
}

main().catch((err) => {
  console.error("[smoke-1] FAIL:", err);
  process.exit(1);
});
