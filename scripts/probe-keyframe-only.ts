// scripts/probe-keyframe-only.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compositeKeyframe } from "../src/lib/pipeline/keyframe";

async function main() {
  const facePath = resolve("test-fixtures/runs/template-1__product-1__face-A/reference_face.png");
  const purseImg = resolve("public/products/purse/image.png");
  const blackTopImg = resolve("public/products/black-top/image.png");
  const skirtImg = resolve("public/products/skirt/image.png");
  const templateFirstFrame = resolve("public/templates/template-2/first_frame.png");

  console.log("=== keyframe probe: 3 products multi-subject test ===");
  console.log("look: purse + black-top + skirt (the one that failed before)");

  const result = await compositeKeyframe({
    keyframePrompt: "Compose a single still image of the person from the reference image wearing the black top and plaid mini skirt, carrying the black handbag, in front of a modern outdoor walkway with concrete steps and lush green foliage.",
    templateFirstFrame: { bytes: readFileSync(templateFirstFrame), mimeType: "image/png" },
    referenceFace: { bytes: readFileSync(facePath), mimeType: "image/png" },
    products: [
      { bytes: readFileSync(purseImg), mimeType: "image/png", description: "small black structured handbag with gold-tone hardware, top handles and shoulder strap" },
      { bytes: readFileSync(blackTopImg), mimeType: "image/png", description: "minimalist black ribbed camisole crop top with thin spaghetti straps and V-neck" },
      { bytes: readFileSync(skirtImg), mimeType: "image/png", description: "black-and-white Glen plaid A-line mini skirt" },
    ],
    faceDescription: "south asian woman, 25-30, medium-light brown skin, long dark wavy hair, nose stud on left nostril",
    framingScope: "full_body",
    backgroundDescription: "Outdoor walkway with concrete steps in front of a modern house, surrounded by lush green foliage during the day",
  });

  const out = resolve("/tmp/multi-subject-test.png");
  writeFileSync(out, result.imageBytes);
  console.log(`saved ${out} (${result.imageBytes.length} bytes)`);
  console.log("EYEBALL: does the keyframe show the BLACK TOP, BLACK HANDBAG, AND PLAID SKIRT — not jeans?");
}

main().catch((err) => { console.error("FAIL:", err); process.exit(1); });
