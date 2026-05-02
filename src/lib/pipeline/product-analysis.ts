// src/lib/pipeline/product-analysis.ts
import { getGenAIClient } from "../genai-client";
import { PRODUCT_ANALYSIS_PROMPT } from "../prompts";
import type { ProductMetadata } from "./types";

const MODEL = "gemini-2.5-pro";
const TIMEOUT_MS = 60_000;

const PRODUCT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    primary_item_type: { type: "string" },
    items: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          item_type: { type: "string" },
          attachment_strategy: {
            type: "string",
            enum: [
              "worn_on_wrist",
              "worn_on_face",
              "held_in_hand",
              "carried_on_shoulder",
              "worn_around_neck",
              "placed_on_surface",
              "worn_on_torso",
              "worn_on_legs",
            ],
          },
          side_preference: {
            type: "string",
            enum: [
              "left_wrist",
              "right_wrist",
              "left_hand",
              "right_hand",
              "center",
              "none",
            ],
          },
          visual_description: { type: "string" },
        },
        required: ["item_type", "attachment_strategy", "side_preference", "visual_description"],
      },
    },
    overall_description: { type: "string" },
    key_features: { type: "array", items: { type: "string" } },
  },
  required: ["primary_item_type", "items", "overall_description", "key_features"],
};

export async function analyzeProduct(input: {
  imageBytes: Buffer;
  mimeType: string;
}): Promise<ProductMetadata> {
  const ai = getGenAIClient();
  const base64 = input.imageBytes.toString("base64");

  const response = await Promise.race([
    ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: PRODUCT_ANALYSIS_PROMPT },
            { inlineData: { mimeType: input.mimeType, data: base64 } },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: PRODUCT_RESPONSE_SCHEMA,
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("product-analysis timeout")), TIMEOUT_MS),
    ),
  ]);

  const text = (response as any).text;
  if (!text) throw new Error("product-analysis: empty response");
  return JSON.parse(text) as ProductMetadata;
}
