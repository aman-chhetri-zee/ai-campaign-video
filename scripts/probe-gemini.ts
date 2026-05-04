import { config } from "dotenv";
config({ path: ".env.local" });

import { getGenAIClient } from "../src/lib/genai-client";

async function main() {
  const ai = getGenAIClient();
  console.log("client OK, calling gemini-2.5-pro...");
  const t0 = Date.now();
  try {
    const res = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: [{ role: "user", parts: [{ text: "reply with just: ok" }] }],
    });
    console.log(`Gemini response (${Date.now() - t0}ms):`, (res as any).text);
  } catch (e: any) {
    console.log(`Gemini FAILED after ${Date.now() - t0}ms:`, e.message ?? e);
    if (e.cause) console.log("cause:", e.cause);
  }
}

main();
