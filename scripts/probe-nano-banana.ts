import { config } from "dotenv";
config({ path: ".env.local" });

import { getGenAIClient } from "../src/lib/genai-client";
import { writeFileSync } from "node:fs";

const MODELS_TO_PROBE = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-exp",
];

async function probeModel(modelId: string): Promise<boolean> {
  const ai = getGenAIClient();
  console.log(`\n--- Probing model: ${modelId} ---`);
  const t0 = Date.now();
  try {
    const res = await ai.models.generateContent({
      model: modelId,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Generate a vertical 9:16 fashion illustration of a stylized model wearing a casual outfit, plain studio backdrop, contemporary fashion-illustration aesthetic — polished, vibrant, distinctly stylized rather than hyperrealistic.",
            },
          ],
        },
      ],
    } as any);
    console.log(`Response in ${Date.now() - t0}ms`);
    const candidates = (res as any).candidates ?? [];
    for (const cand of candidates) {
      for (const part of cand.content?.parts ?? []) {
        if (part.inlineData?.data) {
          const buf = Buffer.from(part.inlineData.data, "base64");
          const outPath = `/tmp/nano-banana-test-${modelId.replace(/[^a-z0-9]/gi, "-")}.png`;
          writeFileSync(outPath, buf);
          console.log(`AVAILABLE — saved ${outPath} (${buf.length} bytes)`);
          return true;
        }
      }
    }
    // No image part found — log the response text if any
    const text = (res as any).text ?? "";
    console.log(`No image in response. Text snippet: ${JSON.stringify(text).slice(0, 300)}`);
    console.log("Full response shape:", JSON.stringify(res).slice(0, 600));
    return false;
  } catch (err: any) {
    console.log(`UNAVAILABLE — ${err.message ?? err}`);
    return false;
  }
}

async function main() {
  console.log("=== Nano Banana probe: testing models in order ===");
  let winner: string | null = null;

  for (const modelId of MODELS_TO_PROBE) {
    const ok = await probeModel(modelId);
    if (ok) {
      winner = modelId;
      break;
    }
  }

  console.log("\n=== Result ===");
  if (winner) {
    console.log(`WINNER: ${winner}`);
    console.log(`Set NANO_BANANA_MODEL=${winner} in .env.local`);
  } else {
    console.log("No model returned an image. All probes failed.");
  }
}

main();
