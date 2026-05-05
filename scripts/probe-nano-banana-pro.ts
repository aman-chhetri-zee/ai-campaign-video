import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { GoogleAuth } from "google-auth-library";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "creatoreconomy-479409";
const LOCATION = "global";
const MODEL_ID = "gemini-3-pro-image-preview";

async function getAccessToken(): Promise<string> {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const t = await client.getAccessToken();
  if (!t.token) throw new Error("no access token");
  return t.token;
}

function imgPart(bytes: Buffer, mimeType: string) {
  return { inlineData: { mimeType, data: bytes.toString("base64") } };
}

async function main() {
  console.log("=== probe: Nano Banana Pro (gemini-3-pro-image) on Vertex ===");
  console.log(`project=${PROJECT_ID} location=${LOCATION} model=${MODEL_ID}`);

  const facePath = resolve("public/creators/creator-1.jpeg");
  const blackTopPath = resolve("public/products/black-top/image.png");
  const skirtPath = resolve("public/products/skirt/image.png");
  const bootsPath = resolve("public/products/black-boots/image.png");

  const face = readFileSync(facePath);
  const top = readFileSync(blackTopPath);
  const skirt = readFileSync(skirtPath);
  const boots = readFileSync(bootsPath);
  console.log(`face=${face.length}b top=${top.length}b skirt=${skirt.length}b boots=${boots.length}b`);

  const prompt =
    "Photograph of the EXACT SAME PERSON shown in the first reference image, wearing the outfit shown in the next three reference images. " +
    "The person must be IDENTICAL to the first photo: same face, same hair length and style, same skin tone, same body type and build. Do not idealize, slim down, or restyle them. " +
    "Outfit: a black ribbed-knit camisole crop top with V-neck and spaghetti straps; a short black-and-white plaid mini skirt; black knee-high lace-up combat boots. " +
    "Vertical 9:16 portrait, full-body shot — the entire body must be visible from above the head to below the feet, with the floor visible beneath the feet. " +
    "Setting: she is walking through the doorway of a modern home. Natural daylight, professional fashion photography.";

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          imgPart(face, "image/jpeg"),
          imgPart(top, "image/png"),
          imgPart(skirt, "image/png"),
          imgPart(boots, "image/png"),
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "9:16" },
    },
  };

  const host = LOCATION === "global" ? "aiplatform.googleapis.com" : `${LOCATION}-aiplatform.googleapis.com`;
  const endpoint = `https://${host}/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:generateContent`;
  const token = await getAccessToken();
  console.log(`POST ${endpoint}`);
  const t0 = Date.now();
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(`HTTP ${r.status} in ${Date.now() - t0}ms`);
  const text = await r.text();
  if (!r.ok) {
    console.error("ERROR body:", text.slice(0, 1500));
    process.exit(1);
  }

  const json = JSON.parse(text);
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  console.log(`response parts: ${parts.length}`);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.text) console.log(`  part[${i}] text:`, p.text.slice(0, 200));
    if (p.inlineData) {
      const buf = Buffer.from(p.inlineData.data, "base64");
      const out = `/tmp/nano-banana-pro-probe-${i}.png`;
      writeFileSync(out, buf);
      console.log(`  part[${i}] inlineData: ${p.inlineData.mimeType}, ${buf.length}b → ${out}`);
    }
  }
  console.log("=== done ===");
}

main().catch((e) => {
  console.error("probe FAIL:", e);
  process.exit(1);
});
