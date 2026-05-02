// src/lib/pipeline/face-analysis.ts
import { getGenAIClient } from "../genai-client";
import { FACE_ANALYSIS_PROMPT } from "../prompts";
import type { FaceMetadata } from "./types";

const MODEL = "gemini-2.5-pro";
const TIMEOUT_MS = 60_000;

const FACE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    perceived_gender: { type: "string" },
    age_range: { type: "string" },
    skin_tone: { type: "string" },
    hair: { type: "string" },
    distinctive_features: { type: "string" },
    ethnicity_cues: { type: "string" },
  },
  required: [
    "perceived_gender",
    "age_range",
    "skin_tone",
    "hair",
    "distinctive_features",
    "ethnicity_cues",
  ],
};

export async function analyzeReferenceFace(input: {
  imageBytes: Buffer;
  mimeType: string;
}): Promise<FaceMetadata> {
  const ai = getGenAIClient();
  const base64 = input.imageBytes.toString("base64");

  const response = await Promise.race([
    ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: FACE_ANALYSIS_PROMPT },
            { inlineData: { mimeType: input.mimeType, data: base64 } },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: FACE_RESPONSE_SCHEMA,
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("face-analysis timeout")), TIMEOUT_MS),
    ),
  ]);

  // The @google/genai SDK exposes .text as a getter on the response object
  const text = (response as any).text;
  if (!text) {
    // Fallback: extract from candidates structure if .text getter not present
    const candidates = (response as any).candidates;
    const fallbackText = candidates?.[0]?.content?.parts?.[0]?.text;
    if (!fallbackText) {
      throw new Error(
        `face-analysis: empty response. Full response: ${JSON.stringify(response, null, 2)}`,
      );
    }
    return JSON.parse(fallbackText) as FaceMetadata;
  }

  return JSON.parse(text) as FaceMetadata;
}
