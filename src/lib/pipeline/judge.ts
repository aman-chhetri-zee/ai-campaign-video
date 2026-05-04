// src/lib/pipeline/judge.ts
import { getGenAIClient } from "../genai-client";
import { JUDGE_PROMPT } from "../prompts";
import type { JudgeReport } from "./types";
import type { ImageInput } from "./keyframe";
import { withRetry } from "./retry";

const MODEL = "gemini-2.5-pro";
const TIMEOUT_MS = 60_000;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    identity_preserved: { type: "boolean" },
    all_products_present: { type: "boolean" },
    products_correctly_placed: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } },
  },
  required: [
    "identity_preserved",
    "all_products_present",
    "products_correctly_placed",
    "issues",
  ],
};

export async function judgeKeyframe(input: {
  keyframe: ImageInput;
  referenceFace: ImageInput;
  products: ImageInput[];
}): Promise<JudgeReport> {
  const ai = getGenAIClient();
  const parts: any[] = [
    { text: JUDGE_PROMPT },
    { inlineData: { mimeType: input.keyframe.mimeType, data: input.keyframe.bytes.toString("base64") } },
    { inlineData: { mimeType: input.referenceFace.mimeType, data: input.referenceFace.bytes.toString("base64") } },
    ...input.products.map((p) => ({
      inlineData: { mimeType: p.mimeType, data: p.bytes.toString("base64") },
    })),
  ];

  const response = await withRetry(
    () =>
      Promise.race([
        ai.models.generateContent({
          model: MODEL,
          contents: [{ role: "user", parts }],
          config: {
            responseMimeType: "application/json",
            responseSchema: JUDGE_SCHEMA,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("judge timeout")), TIMEOUT_MS),
        ),
      ]),
    { label: "stage5b-judge" },
  );

  const text = (response as any).text;
  if (!text) throw new Error("judge: empty response");
  return JSON.parse(text) as JudgeReport;
}
