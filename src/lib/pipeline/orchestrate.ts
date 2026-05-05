// src/lib/pipeline/orchestrate.ts
import { getGenAIClient } from "../genai-client";
import { buildOrchestrationPrompt } from "../prompts";
import type {
  TemplateMetadata,
  ProductMetadata,
  FaceMetadata,
  OrchestratedPrompts,
} from "./types";
import type { FramingScope } from "./framing";
import { withRetry } from "./retry";

const MODEL = "gemini-2.5-pro";
const TIMEOUT_MS = 60_000;

const ORCHESTRATION_SCHEMA = {
  type: "object",
  properties: {
    keyframe_prompt: { type: "string" },
    motion_prompt: { type: "string" },
    negative_prompt: { type: "string" },
  },
  required: ["keyframe_prompt", "motion_prompt", "negative_prompt"],
};

export async function orchestratePrompts(input: {
  template: TemplateMetadata;
  products: ProductMetadata[];
  face: FaceMetadata;
  options?: {
    look_index?: number;
    total_looks?: number;
    framing_scope?: FramingScope;
    background_for_look?: string;
    motion_script_for_this_look?: TemplateMetadata["motion_script"];
  };
}): Promise<OrchestratedPrompts> {
  const ai = getGenAIClient();
  const prompt = buildOrchestrationPrompt(input.template, input.products, input.face, input.options);

  const response = await withRetry(
    () =>
      Promise.race([
        ai.models.generateContent({
          model: MODEL,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: ORCHESTRATION_SCHEMA,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("orchestrate timeout")), TIMEOUT_MS),
        ),
      ]),
    { label: "stage4-orchestration" },
  );

  const text = (response as any).text;
  if (!text) throw new Error("orchestrate: empty response");
  return JSON.parse(text) as OrchestratedPrompts;
}
