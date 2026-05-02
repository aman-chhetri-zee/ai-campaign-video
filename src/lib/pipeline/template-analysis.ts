// src/lib/pipeline/template-analysis.ts
import { getGenAIClient } from "../genai-client";
import { TEMPLATE_ANALYSIS_PROMPT } from "../prompts";
import type { TemplateMetadata } from "./types";

const MODEL = "gemini-2.5-pro";
const TIMEOUT_MS = 120_000; // video analysis is slower than image; bumped from 60s based on Stage 3 experience

const TEMPLATE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    scene_description: { type: "string" },
    subject: {
      type: "object",
      properties: {
        rough_pose: { type: "string" },
        framing: { type: "string" },
        lighting: { type: "string" },
      },
      required: ["rough_pose", "framing", "lighting"],
    },
    motion_script: {
      type: "array",
      items: {
        type: "object",
        properties: {
          t_start: { type: "number" },
          t_end: { type: "number" },
          action: { type: "string" },
        },
        required: ["t_start", "t_end", "action"],
      },
    },
    composition_notes: { type: "string" },
  },
  required: ["scene_description", "subject", "motion_script", "composition_notes"],
};

export async function analyzeTemplateVideo(input: {
  videoBytes: Buffer;
  mimeType: string;
}): Promise<TemplateMetadata> {
  const ai = getGenAIClient();
  const base64 = input.videoBytes.toString("base64");

  const response = await Promise.race([
    ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: TEMPLATE_ANALYSIS_PROMPT },
            { inlineData: { mimeType: input.mimeType, data: base64 } },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: TEMPLATE_RESPONSE_SCHEMA,
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("template-analysis timeout")), TIMEOUT_MS),
    ),
  ]);

  const text = (response as any).text;
  if (!text) throw new Error("template-analysis: empty response");
  return JSON.parse(text) as TemplateMetadata;
}
