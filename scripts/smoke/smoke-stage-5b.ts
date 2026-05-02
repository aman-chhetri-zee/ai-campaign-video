// scripts/smoke/smoke-stage-5b.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { judgeKeyframe } from "../../src/lib/pipeline/judge";

async function main() {
  const keyframe = readFileSync(
    resolve("test-fixtures/runs/template-1__product-1__face-A/keyframe.png"),
  );
  const face = readFileSync(
    resolve("test-fixtures/runs/template-1__product-1__face-A/reference_face.png"),
  );
  const necklace = readFileSync(resolve("public/products/product-1/image.png"));

  console.log("[smoke-5b] judging keyframe...");
  const result = await judgeKeyframe({
    keyframe: { bytes: keyframe, mimeType: "image/png" },
    referenceFace: { bytes: face, mimeType: "image/png" },
    products: [{ bytes: necklace, mimeType: "image/png" }],
  });

  console.log("[smoke-5b] result:", JSON.stringify(result, null, 2));

  if (typeof result.identity_preserved !== "boolean") {
    throw new Error("identity_preserved not a bool");
  }
  if (typeof result.all_products_present !== "boolean") {
    throw new Error("all_products_present not a bool");
  }
  if (typeof result.products_correctly_placed !== "boolean") {
    throw new Error("products_correctly_placed not a bool");
  }
  if (!Array.isArray(result.issues)) throw new Error("issues not array");

  console.log("[smoke-5b] PASS");
}

main().catch((err) => {
  console.error("[smoke-5b] FAIL:", err);
  process.exit(1);
});
