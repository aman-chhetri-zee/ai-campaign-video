// scripts/smoke/smoke-stage-3.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeReferenceFace } from "../../src/lib/pipeline/face-analysis";

async function main() {
  const facePath = resolve(
    "test-fixtures/runs/template-1__product-1__face-A/reference_face.png",
  );
  const buffer = readFileSync(facePath);

  console.log(`[smoke-3] analyzing ${facePath}...`);
  const result = await analyzeReferenceFace({
    imageBytes: buffer,
    mimeType: "image/png",
  });

  console.log("[smoke-3] result:", JSON.stringify(result, null, 2));

  const required = [
    "perceived_gender",
    "age_range",
    "skin_tone",
    "hair",
    "distinctive_features",
    "ethnicity_cues",
  ] as const;
  for (const key of required) {
    if (typeof (result as any)[key] !== "string" || !(result as any)[key]) {
      throw new Error(`[smoke-3] missing or empty field: ${key}`);
    }
  }

  console.log("[smoke-3] PASS");
}

main().catch((err) => {
  console.error("[smoke-3] FAIL:", err);
  process.exit(1);
});
