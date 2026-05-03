# AI Video POC Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 6-stage pipeline that turns (template mp4, 1–2 product images, reference face) into a 5-second AI video with the reference identity preserved and products inserted naturally.

**Architecture:** Pre-cache template + product analyses at ingestion time. At demo time, run face analysis + Gemini-orchestrated prompt composition + Nano Banana Pro keyframe + (optional Gemini judge + retry) + Kling image-to-video. UI is a single Next.js wizard at `/video-poc`, alongside the existing virtual-try-on flow (untouched). Run state is an in-memory `Map`; HTTP polling drives progress.

**Tech Stack:** Next.js 14 (App Router) + TypeScript, `@google/genai` SDK against Vertex AI (Gemini 2.5 Pro for text/vision, `gemini-3-pro-image` for Nano Banana Pro), Kling image-to-video via direct HTTP, `fluent-ffmpeg` for first-frame extraction, `tsx` for running smoke scripts.

**Spec:** `docs/superpowers/specs/2026-05-03-ai-video-poc-pipeline-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/pipeline/types.ts` | All shared TS types (`TemplateMetadata`, `ProductMetadata`, `FaceMetadata`, `OrchestratedPrompts`, `JudgeReport`, `RunState`) |
| `src/lib/prompts.ts` | All 5 prompts as exported string constants |
| `src/lib/pipeline/template-analysis.ts` | Stage 1 — Gemini vision-on-video, extracts motion script |
| `src/lib/pipeline/product-analysis.ts` | Stage 2 — Gemini vision per product, extracts attachment strategy |
| `src/lib/pipeline/face-analysis.ts` | Stage 3 — Gemini vision on uploaded face |
| `src/lib/pipeline/orchestrate.ts` | Stage 4 — Gemini text call composes 3 downstream prompts |
| `src/lib/pipeline/keyframe.ts` | Stage 5 — Nano Banana Pro multi-image compositing |
| `src/lib/pipeline/judge.ts` | Stage 5b — Gemini vision quality check + retry-with-corrections |
| `src/lib/pipeline/kling.ts` | Stage 6 — Kling image-to-video, JWT auth, async polling |
| `src/lib/pipeline/run-store.ts` | In-memory `Map<run_id, RunState>` with helpers |
| `src/lib/pipeline/orchestrator.ts` | End-to-end pipeline runner: stages 3 → 6, updates run-store |
| `src/lib/pipeline/ffmpeg.ts` | First-frame extraction helper |
| `src/app/api/video-poc/generate/route.ts` | POST — kicks off background pipeline, returns `run_id` |
| `src/app/api/video-poc/runs/[id]/route.ts` | GET — polls run status |
| `src/app/video-poc/page.tsx` | 5-step wizard |
| `src/components/ProductPicker.tsx` | NEW — multi-select up to 2 products |
| `scripts/ingest-templates.ts` | One-shot: extract first frame + run Stage 1 for each template |
| `scripts/ingest-products.ts` | One-shot: run Stage 2 for each product |
| `scripts/smoke/smoke-stage-1.ts` | Debug Stage 1 standalone |
| `scripts/smoke/smoke-stage-3.ts` | Debug Stage 3 standalone |
| `scripts/smoke/smoke-stage-4.ts` | Debug Stage 4 standalone |
| `scripts/smoke/smoke-stage-5.ts` | Debug Stage 5 standalone |
| `scripts/smoke/smoke-stage-5b.ts` | Debug judge standalone |
| `scripts/smoke/smoke-stage-6.ts` | Debug Stage 6 standalone |
| `scripts/smoke/smoke-end-to-end.ts` | Run all stages on a fixture |
| `public/templates/<id>/{video.mp4, first_frame.png, metadata.json}` | Cached template assets |
| `public/products/<id>/{image.png, metadata.json}` | Cached product assets |
| `test-fixtures/runs/<tuple>/{reference_face.png, expected_shape.json}` | Golden-set fixtures |

**Reused unchanged:** existing `src/lib/genai-client.ts` (we use its `getGenAIClient()` helper), `src/lib/imagen.ts`, `src/app/page.tsx`, all current components except where reused in new `/video-poc` page.

---

## Notes Before You Begin

- **Never skip the smoke script step.** AI outputs are non-deterministic; smoke scripts are the only way to know a stage is working. They are the "tests" in the TDD loop — write them first, watch them fail (because the function doesn't exist), implement, watch them pass.
- **Run state is in-memory.** Restarting the Next.js dev server discards in-flight runs. This is intentional for the POC.
- **Commits assume git is initialized.** Task 1 covers `git init`. After that, every task ends with a commit.
- **Auth.** Existing pattern: `getGenAIClient()` in `src/lib/genai-client.ts` calls `new GoogleGenAI({ vertexai: true, project: 'creatoreconomy-479409', location: 'us-central1' })`. The SDK reads credentials from `GOOGLE_APPLICATION_CREDENTIALS`. Reuse this; do not re-implement auth.
- **Three open questions** from the spec must be confirmed before Task 11: exact Kling model id, max images per Nano Banana Pro call, and whether `ffmpeg` binary is available locally. Each task that depends on one of these calls it out.

---

## Task 1: Project Setup — Git, Dependencies, Env Vars, Directories

**Files:**
- Create: `.env.local`, `.gitignore` (if not present), directory structure
- Modify: `package.json`

- [ ] **Step 1: Initialize git if not already a repo**

```bash
cd /Users/vc.aman.chhetri/Desktop/Codes/ai-campaign-video
git rev-parse --is-inside-work-tree 2>/dev/null || git init
```

Expected: either prints `true` (already a repo) or `Initialized empty Git repository in ...`.

- [ ] **Step 2: Verify/create `.gitignore` excludes secrets and assets we don't want in git**

Append to `.gitignore` (create if missing):

```
# Secrets
vertex-tester.json
.env.local
.env*.local

# Build
.next/
out/
node_modules/

# Generated assets (POC, not tracked)
public/runs/
test-fixtures/runs/*/output/

# OS
.DS_Store
```

- [ ] **Step 3: Install runtime + dev dependencies**

```bash
npm install fluent-ffmpeg
npm install -D tsx @types/fluent-ffmpeg
```

Expected: installs without error.

- [ ] **Step 4: Add scripts to `package.json`**

Modify the `"scripts"` block in `package.json`:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "ingest:templates": "tsx scripts/ingest-templates.ts",
  "ingest:products": "tsx scripts/ingest-products.ts",
  "smoke:1": "tsx scripts/smoke/smoke-stage-1.ts",
  "smoke:3": "tsx scripts/smoke/smoke-stage-3.ts",
  "smoke:4": "tsx scripts/smoke/smoke-stage-4.ts",
  "smoke:5": "tsx scripts/smoke/smoke-stage-5.ts",
  "smoke:5b": "tsx scripts/smoke/smoke-stage-5b.ts",
  "smoke:6": "tsx scripts/smoke/smoke-stage-6.ts",
  "smoke:e2e": "tsx scripts/smoke/smoke-end-to-end.ts"
}
```

- [ ] **Step 5: Create `.env.local` with required env vars**

```
GOOGLE_APPLICATION_CREDENTIALS=./vertex-tester.json
GCP_PROJECT_ID=creatoreconomy-479409
GCP_LOCATION=us-central1

# Kling — fill in after confirming with your Kling account
KLING_ACCESS_KEY=
KLING_SECRET_KEY=
KLING_API_BASE=https://api.klingai.com
KLING_MODEL_ID=kling-v1
```

- [ ] **Step 6: Create the empty directory structure**

```bash
mkdir -p src/lib/pipeline
mkdir -p src/app/video-poc
mkdir -p src/app/api/video-poc/generate
mkdir -p src/app/api/video-poc/runs/\[id\]
mkdir -p scripts/smoke
mkdir -p public/templates public/products public/runs
mkdir -p test-fixtures/runs
```

- [ ] **Step 7: Verify ffmpeg binary is available**

```bash
ffmpeg -version
```

Expected: prints version info. If "command not found", install via `brew install ffmpeg` (macOS) or document for the deployment environment. **This is one of the spec's Open Questions — confirm before proceeding.**

- [ ] **Step 8: Commit**

```bash
git add .gitignore package.json package-lock.json .env.local
git commit -m "chore: project setup for video POC pipeline (deps, env, dirs)"
```

Note: `.env.local` is in `.gitignore` so it won't actually be committed — that's intended. The empty directory structure won't be committed either (git ignores empty dirs); that's fine, files added in later tasks will populate them.

---

## Task 2: Shared TypeScript Types

**Files:**
- Create: `src/lib/pipeline/types.ts`

This is the contract that every pipeline stage and the run-store agree on. Define everything before any stage is implemented.

- [ ] **Step 1: Create `src/lib/pipeline/types.ts` with all shared types**

```typescript
// src/lib/pipeline/types.ts

// ----- Stage 1 output -----
export type MotionScriptEntry = {
  t_start: number;
  t_end: number;
  action: string;
};

export type TemplateMetadata = {
  scene_description: string;
  subject: {
    rough_pose: string;
    framing: string;
    lighting: string;
  };
  motion_script: MotionScriptEntry[];
  composition_notes: string;
};

// ----- Stage 2 output -----
export type AttachmentStrategy =
  | "worn_on_wrist"
  | "worn_on_face"
  | "held_in_hand"
  | "carried_on_shoulder"
  | "worn_around_neck"
  | "placed_on_surface";

export type SidePreference =
  | "left_wrist"
  | "right_wrist"
  | "left_hand"
  | "right_hand"
  | "center"
  | "none";

export type ProductMetadata = {
  product_type: string;
  attachment_strategy: AttachmentStrategy;
  side_preference: SidePreference;
  visual_description: string;
  key_features: string[];
};

// ----- Stage 3 output -----
export type FaceMetadata = {
  perceived_gender: string;
  age_range: string;
  skin_tone: string;
  hair: string;
  distinctive_features: string;
  ethnicity_cues: string;
};

// ----- Stage 4 output -----
export type OrchestratedPrompts = {
  keyframe_prompt: string;
  motion_prompt: string;
  negative_prompt: string;
};

// ----- Stage 5b output -----
export type JudgeReport = {
  identity_preserved: boolean;
  all_products_present: boolean;
  products_correctly_placed: boolean;
  issues: string[];
};

// ----- Run state (in-memory store) -----
export type RunStatus =
  | "analyzing_face"
  | "orchestrating"
  | "compositing_keyframe"
  | "generating_video"
  | "succeeded"
  | "failed";

export type RunState = {
  run_id: string;
  status: RunStatus;
  progress_label: string;
  template_id: string;
  product_ids: string[];
  reference_face_path: string;
  keyframe_url?: string;
  video_url?: string;
  error?: string;
  started_at: number;
};

// ----- Catalog entries on disk (metadata.json wrappers) -----
export type TemplateAsset = {
  id: string;
  title: string;
  description: string;
  video_path: string;       // relative to public/, e.g. "templates/cafe-walk/video.mp4"
  first_frame_path: string;
  metadata: TemplateMetadata;
};

export type ProductAsset = {
  id: string;
  name: string;
  description: string;
  image_path: string;       // relative to public/
  metadata: ProductMetadata;
};
```

- [ ] **Step 2: Verify the file compiles**

```bash
npx tsc --noEmit src/lib/pipeline/types.ts
```

Expected: no output (success). If TS errors, fix them before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pipeline/types.ts
git commit -m "feat(pipeline): shared TS types for all 6 stages and run state"
```

---

## Task 3: Prompts Module

**Files:**
- Create: `src/lib/prompts.ts`

All prompts in one place, exported as constants. The orchestration prompt has a function that injects the JSON inputs.

- [ ] **Step 1: Create `src/lib/prompts.ts` with all 5 prompts**

```typescript
// src/lib/prompts.ts
import type {
  TemplateMetadata,
  ProductMetadata,
  FaceMetadata,
} from "./pipeline/types";

export const TEMPLATE_ANALYSIS_PROMPT = `
You are analyzing a short reference video that will guide AI video generation.
Extract objective motion and composition information.

CONSTRAINTS:
- motion_script must cover the full duration with no time gaps
- each action must be a single, concrete physical action a video model can replicate
- DO NOT describe subject identity (face, ethnicity, clothing) — identity will be replaced
- DO NOT name brands/products visible in the video — products will be inserted fresh

OUTPUT: strict JSON matching the response_schema.
`.trim();

export const PRODUCT_ANALYSIS_PROMPT = `
Catalogue this product image for downstream AI video generation.

CONSTRAINTS:
- attachment_strategy must be one of:
  worn_on_wrist | worn_on_face | held_in_hand |
  carried_on_shoulder | worn_around_neck | placed_on_surface
- side_preference must be one of:
  left_wrist | right_wrist | left_hand | right_hand | center | none
- be precise about color and material — these drive product fidelity in the keyframe

OUTPUT: strict JSON matching the response_schema.
`.trim();

export const FACE_ANALYSIS_PROMPT = `
Describe this reference photo objectively for downstream identity-preserving
image generation. Use descriptive, neutral language only. Avoid subjective
language ("beautiful", "ordinary"). The goal is enough detail that a downstream
image generator can preserve this exact identity.

OUTPUT: strict JSON matching the response_schema.
`.trim();

export const JUDGE_PROMPT = `
Compare a generated keyframe against the inputs that produced it.
Determine whether identity and products are correctly represented.

INPUTS (multi-image):
- IMAGE 1 = generated keyframe
- IMAGE 2 = reference face used as identity source
- IMAGE 3+ = product images that should appear in the keyframe

OUTPUT: strict JSON
{
  "identity_preserved": <bool — does IMAGE 1's face match IMAGE 2?>,
  "all_products_present": <bool — are ALL products from IMAGE 3+ visible?>,
  "products_correctly_placed": <bool — are products on the right body parts?>,
  "issues": [<string descriptions of any problems>]
}

Be strict on identity_preserved. Be lenient on minor product styling differences
as long as the product is recognizably the same item.
`.trim();

/**
 * Build the orchestration prompt by injecting analysis JSONs.
 * The orchestration call is itself a Gemini text call — this prompt instructs
 * Gemini how to compose the keyframe_prompt, motion_prompt, negative_prompt.
 */
export function buildOrchestrationPrompt(
  template: TemplateMetadata,
  products: ProductMetadata[],
  face: FaceMetadata,
): string {
  return `
You are composing prompts for two AI models in a video pipeline.
You will receive analysis JSON from earlier stages and must emit three text
prompts: keyframe_prompt, motion_prompt, negative_prompt.

INPUTS:
- template_analysis: ${JSON.stringify(template, null, 2)}
- product_analyses: ${JSON.stringify(products, null, 2)}
- face_analysis: ${JSON.stringify(face, null, 2)}

----------------------------------------------------------------------
keyframe_prompt — for Nano Banana Pro (multi-image input).

The image inputs to Nano Banana Pro will be supplied in this order:
  IMAGE 1 = template's first frame
  IMAGE 2 = reference face
  IMAGE 3, IMAGE 4 = product images (in selection order)

Your keyframe_prompt MUST:
1. Open with: "Compose a single still image that recreates the scene
   and pose shown in IMAGE 1, but featuring the person from IMAGE 2
   (preserving their face exactly), naturally wearing/holding the
   products from IMAGE 3 onward."
2. For EACH product, state explicit placement using its attachment_strategy.
   Example: "The wristwatch from IMAGE 3 is worn on the LEFT wrist,
   clearly visible on the inside of the arm."
3. Carry the template's lighting, framing, and composition_notes verbatim.
4. End with the identity lock:
   "The face must match IMAGE 2 EXACTLY — same eye shape, same skin tone,
   same hair, same distinctive features. Do not generate a different face.
   Do not stylize the face. Identity preservation is the highest priority."

----------------------------------------------------------------------
motion_prompt — for Kling image-to-video.

Kling animates from the keyframe; it does NOT re-render identity or products.
Repeating identity description here causes face drift.

Your motion_prompt MUST:
1. Translate the motion_script into one tight paragraph of action.
2. Include camera movement from template_analysis.composition_notes.
3. NOT describe the subject's face, body, or the products.
4. Stay under 60 words.

----------------------------------------------------------------------
negative_prompt — shared across both calls.

ALWAYS include:
  "blurry face, distorted hands, deformed limbs, extra fingers,
   missing products, floating objects, face morphing, identity drift,
   warped product, duplicate limbs"

PLUS, per product type, append targeted negatives:
  wristwatch  → "watch on wrong wrist, missing watch, watch face warped"
  handbag     → "bag floating, bag detached from hand, distorted strap"
  sunglasses  → "missing glasses, glasses on forehead"
  (extend as the catalog grows)

OUTPUT: strict JSON with three string fields:
{ "keyframe_prompt": string, "motion_prompt": string, "negative_prompt": string }
`.trim();
}
```

- [ ] **Step 2: Verify the module compiles**

```bash
npx tsc --noEmit src/lib/prompts.ts
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/prompts.ts
git commit -m "feat(prompts): all 5 prompts as exported constants + orchestration builder"
```

---

## Task 4: Storage Layout and Test Fixtures

**Files:**
- Create: `public/templates/cafe-walk/{video.mp4, README.md}` (placeholder for now)
- Create: `public/products/silver-watch/{image.png, README.md}`
- Create: `public/products/brown-tote/{image.png, README.md}`
- Create: `test-fixtures/runs/cafe-walk__silver-watch__face-A/{reference_face.png, README.md}`

This task is mostly about getting fixture assets in place so smoke scripts have something to run against. The actual mp4/png files need to come from you — the placeholders below are file-existence checks.

- [ ] **Step 1: Drop one template video and two product images into the right paths**

You said you already have templates and a catalog. Place them under:

```
public/templates/cafe-walk/video.mp4               <-- a 5s+ reference mp4
public/products/silver-watch/image.png             <-- single product image
public/products/brown-tote/image.png               <-- second product image
test-fixtures/runs/cafe-walk__silver-watch__face-A/reference_face.png   <-- a reference face for testing
```

If you only have one template and one product right now, that's enough to bring up the pipeline. We add more in Task 12 ingestion runs.

- [ ] **Step 2: Verify the assets exist**

```bash
ls -la public/templates/cafe-walk/video.mp4
ls -la public/products/silver-watch/image.png
ls -la public/products/brown-tote/image.png
ls -la test-fixtures/runs/cafe-walk__silver-watch__face-A/reference_face.png
```

Expected: all four files exist with non-zero size.

- [ ] **Step 3: Add per-asset README files explaining provenance** (one-time documentation, helps the next person)

For each asset directory, drop a `README.md`:

```bash
echo "# Cafe Walk Template

Reference video: 5s, 9:16, woman walks toward camera in a sunlit cafe.
Source: <where this came from>" > public/templates/cafe-walk/README.md

echo "# Silver Watch

Round-face analog wristwatch with brown leather strap." > public/products/silver-watch/README.md

echo "# Brown Tote

Brown leather handbag with shoulder strap." > public/products/brown-tote/README.md
```

- [ ] **Step 4: Commit**

```bash
git add public/templates public/products test-fixtures
git commit -m "chore(fixtures): seed POC asset layout with one template, two products, one face"
```

---

## Task 5: Stage 3 — Face Analysis (start with the simplest live stage)

**Files:**
- Create: `src/lib/pipeline/face-analysis.ts`
- Create: `scripts/smoke/smoke-stage-3.ts`

We start with Stage 3 because it's the simplest: a single image input, structured JSON output, no controlled vocab inference. Establishes the auth + response_schema pattern that other stages reuse.

- [ ] **Step 1: Write the smoke script first (the test)**

Create `scripts/smoke/smoke-stage-3.ts`:

```typescript
// scripts/smoke/smoke-stage-3.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeReferenceFace } from "../../src/lib/pipeline/face-analysis";

async function main() {
  const facePath = resolve(
    "test-fixtures/runs/cafe-walk__silver-watch__face-A/reference_face.png",
  );
  const buffer = readFileSync(facePath);

  console.log(`[smoke-3] analyzing ${facePath}...`);
  const result = await analyzeReferenceFace({
    imageBytes: buffer,
    mimeType: "image/png",
  });

  console.log("[smoke-3] result:", JSON.stringify(result, null, 2));

  // Shape assertions
  const required = [
    "perceived_gender",
    "age_range",
    "skin_tone",
    "hair",
    "distinctive_features",
    "ethnicity_cues",
  ] as const;
  for (const key of required) {
    if (typeof (result as any)[key] !== "string" || !(result as any)[key]) {
      throw new Error(`[smoke-3] missing or empty field: ${key}`);
    }
  }

  console.log("[smoke-3] PASS");
}

main().catch((err) => {
  console.error("[smoke-3] FAIL:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run smoke script — verify it fails**

```bash
npm run smoke:3
```

Expected: FAIL with "Cannot find module '../../src/lib/pipeline/face-analysis'" or similar.

- [ ] **Step 3: Implement `face-analysis.ts`**

Create `src/lib/pipeline/face-analysis.ts`:

```typescript
// src/lib/pipeline/face-analysis.ts
import { getGenAIClient } from "../genai-client";
import { FACE_ANALYSIS_PROMPT } from "../prompts";
import type { FaceMetadata } from "./types";

const MODEL = "gemini-2.5-pro";
const TIMEOUT_MS = 15_000;

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

  const text = (response as any).text;
  if (!text) {
    throw new Error("face-analysis: empty response");
  }
  return JSON.parse(text) as FaceMetadata;
}
```

- [ ] **Step 4: Run smoke script — verify it passes**

```bash
npm run smoke:3
```

Expected: prints the JSON output and `[smoke-3] PASS`. The actual values are non-deterministic; the assertion checks shape only.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/face-analysis.ts scripts/smoke/smoke-stage-3.ts
git commit -m "feat(pipeline): Stage 3 face analysis + smoke script"
```

---

## Task 6: Stage 1 — Template Analysis (with first-frame extraction)

**Files:**
- Create: `src/lib/pipeline/ffmpeg.ts`
- Create: `src/lib/pipeline/template-analysis.ts`
- Create: `scripts/smoke/smoke-stage-1.ts`

This is the trickiest analysis stage — Gemini takes the video as input. Also covers first-frame extraction since several downstream stages need the first frame.

- [ ] **Step 1: Implement first-frame extraction helper first (no smoke needed — used directly by next step)**

Create `src/lib/pipeline/ffmpeg.ts`:

```typescript
// src/lib/pipeline/ffmpeg.ts
import ffmpeg from "fluent-ffmpeg";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

export async function extractFirstFrame(
  videoPath: string,
  outputPngPath: string,
): Promise<void> {
  await mkdir(dirname(outputPngPath), { recursive: true });
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .frames(1)
      .output(outputPngPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}
```

- [ ] **Step 2: Write the smoke script for Stage 1**

Create `scripts/smoke/smoke-stage-1.ts`:

```typescript
// scripts/smoke/smoke-stage-1.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeTemplateVideo } from "../../src/lib/pipeline/template-analysis";

async function main() {
  const videoPath = resolve("public/templates/cafe-walk/video.mp4");
  const buffer = readFileSync(videoPath);

  console.log(`[smoke-1] analyzing ${videoPath}...`);
  const result = await analyzeTemplateVideo({
    videoBytes: buffer,
    mimeType: "video/mp4",
  });

  console.log("[smoke-1] result:", JSON.stringify(result, null, 2));

  if (!result.scene_description) throw new Error("missing scene_description");
  if (!result.subject?.rough_pose) throw new Error("missing subject.rough_pose");
  if (!Array.isArray(result.motion_script) || result.motion_script.length === 0) {
    throw new Error("motion_script is empty");
  }
  for (const entry of result.motion_script) {
    if (typeof entry.t_start !== "number" || typeof entry.t_end !== "number") {
      throw new Error("motion_script entry missing t_start/t_end");
    }
    if (!entry.action) throw new Error("motion_script entry missing action");
  }

  console.log("[smoke-1] PASS");
}

main().catch((err) => {
  console.error("[smoke-1] FAIL:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Run smoke script — verify it fails**

```bash
npm run smoke:1
```

Expected: FAIL — `template-analysis` module doesn't exist yet.

- [ ] **Step 4: Implement `template-analysis.ts`**

Create `src/lib/pipeline/template-analysis.ts`:

```typescript
// src/lib/pipeline/template-analysis.ts
import { getGenAIClient } from "../genai-client";
import { TEMPLATE_ANALYSIS_PROMPT } from "../prompts";
import type { TemplateMetadata } from "./types";

const MODEL = "gemini-2.5-pro";
const TIMEOUT_MS = 60_000; // video analysis is slower than image

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
```

- [ ] **Step 5: Run smoke script — verify it passes**

```bash
npm run smoke:1
```

Expected: prints JSON with `motion_script` array, all fields populated. `[smoke-1] PASS`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline/ffmpeg.ts src/lib/pipeline/template-analysis.ts scripts/smoke/smoke-stage-1.ts
git commit -m "feat(pipeline): Stage 1 template analysis + ffmpeg helper + smoke"
```

---

## Task 7: Stage 2 — Product Analysis

**Files:**
- Create: `src/lib/pipeline/product-analysis.ts`
- Create: `scripts/smoke/smoke-stage-2.ts`
- Modify: `package.json` (add `smoke:2` script)

- [ ] **Step 1: Add `smoke:2` to package.json scripts**

```json
"smoke:2": "tsx scripts/smoke/smoke-stage-2.ts",
```

- [ ] **Step 2: Write smoke script for Stage 2**

Create `scripts/smoke/smoke-stage-2.ts`:

```typescript
// scripts/smoke/smoke-stage-2.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeProduct } from "../../src/lib/pipeline/product-analysis";

const VALID_ATTACHMENT = new Set([
  "worn_on_wrist",
  "worn_on_face",
  "held_in_hand",
  "carried_on_shoulder",
  "worn_around_neck",
  "placed_on_surface",
]);

async function main() {
  const path = resolve("public/products/silver-watch/image.png");
  const buffer = readFileSync(path);

  console.log(`[smoke-2] analyzing ${path}...`);
  const result = await analyzeProduct({
    imageBytes: buffer,
    mimeType: "image/png",
  });

  console.log("[smoke-2] result:", JSON.stringify(result, null, 2));

  if (!result.product_type) throw new Error("missing product_type");
  if (!VALID_ATTACHMENT.has(result.attachment_strategy)) {
    throw new Error(`invalid attachment_strategy: ${result.attachment_strategy}`);
  }
  if (!result.visual_description) throw new Error("missing visual_description");
  if (!Array.isArray(result.key_features)) throw new Error("key_features not array");

  console.log("[smoke-2] PASS");
}

main().catch((err) => {
  console.error("[smoke-2] FAIL:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Run smoke — verify failure**

```bash
npm run smoke:2
```

Expected: FAIL (module missing).

- [ ] **Step 4: Implement `product-analysis.ts`**

Create `src/lib/pipeline/product-analysis.ts`:

```typescript
// src/lib/pipeline/product-analysis.ts
import { getGenAIClient } from "../genai-client";
import { PRODUCT_ANALYSIS_PROMPT } from "../prompts";
import type { ProductMetadata } from "./types";

const MODEL = "gemini-2.5-pro";
const TIMEOUT_MS = 15_000;

const PRODUCT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    product_type: { type: "string" },
    attachment_strategy: {
      type: "string",
      enum: [
        "worn_on_wrist",
        "worn_on_face",
        "held_in_hand",
        "carried_on_shoulder",
        "worn_around_neck",
        "placed_on_surface",
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
    key_features: { type: "array", items: { type: "string" } },
  },
  required: [
    "product_type",
    "attachment_strategy",
    "side_preference",
    "visual_description",
    "key_features",
  ],
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
```

- [ ] **Step 5: Run smoke — verify pass**

```bash
npm run smoke:2
```

Expected: PASS with valid attachment_strategy.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline/product-analysis.ts scripts/smoke/smoke-stage-2.ts package.json
git commit -m "feat(pipeline): Stage 2 product analysis + smoke"
```

---

## Task 8: Stage 4 — Prompt Orchestration

**Files:**
- Create: `src/lib/pipeline/orchestrate.ts`
- Create: `scripts/smoke/smoke-stage-4.ts`

This stage takes the three analysis JSONs and emits the three downstream prompts. It's a text-only Gemini call (no images).

- [ ] **Step 1: Write smoke script using captured fixture JSON**

Create `scripts/smoke/smoke-stage-4.ts`:

```typescript
// scripts/smoke/smoke-stage-4.ts
import { orchestratePrompts } from "../../src/lib/pipeline/orchestrate";
import type {
  TemplateMetadata,
  ProductMetadata,
  FaceMetadata,
} from "../../src/lib/pipeline/types";

const TEMPLATE_FIXTURE: TemplateMetadata = {
  scene_description: "Young woman walks toward camera through a sunlit cafe.",
  subject: {
    rough_pose: "standing, walking forward",
    framing: "medium-wide to chest-up closeup",
    lighting: "warm golden-hour, key light from camera-left",
  },
  motion_script: [
    { t_start: 0.0, t_end: 1.5, action: "walks forward, arms relaxed" },
    { t_start: 1.5, t_end: 3.0, action: "raises hand toward face, smiles" },
    { t_start: 3.0, t_end: 5.0, action: "settles into closeup" },
  ],
  composition_notes: "shallow depth of field, warm color grade, vertical 9:16",
};

const WATCH_FIXTURE: ProductMetadata = {
  product_type: "wristwatch",
  attachment_strategy: "worn_on_wrist",
  side_preference: "left_wrist",
  visual_description: "silver round-face analog watch with brown leather strap",
  key_features: ["silver case", "brown leather", "white dial"],
};

const BAG_FIXTURE: ProductMetadata = {
  product_type: "handbag",
  attachment_strategy: "carried_on_shoulder",
  side_preference: "none",
  visual_description: "brown leather tote with shoulder strap",
  key_features: ["brown leather", "shoulder strap", "open top"],
};

const FACE_FIXTURE: FaceMetadata = {
  perceived_gender: "female",
  age_range: "25-30",
  skin_tone: "medium",
  hair: "shoulder-length, dark brown, straight",
  distinctive_features: "high cheekbones, brown eyes, slight smile",
  ethnicity_cues: "south asian features",
};

async function main() {
  console.log("[smoke-4] orchestrating prompts...");
  const result = await orchestratePrompts({
    template: TEMPLATE_FIXTURE,
    products: [WATCH_FIXTURE, BAG_FIXTURE],
    face: FACE_FIXTURE,
  });

  console.log("[smoke-4] result:", JSON.stringify(result, null, 2));

  if (!result.keyframe_prompt) throw new Error("missing keyframe_prompt");
  if (!result.motion_prompt) throw new Error("missing motion_prompt");
  if (!result.negative_prompt) throw new Error("missing negative_prompt");

  // Sanity: keyframe_prompt should reference IMAGE 1, IMAGE 2, IMAGE 3
  if (!result.keyframe_prompt.includes("IMAGE 1")) {
    throw new Error("keyframe_prompt does not reference IMAGE 1");
  }
  if (!result.keyframe_prompt.includes("IMAGE 2")) {
    throw new Error("keyframe_prompt does not reference IMAGE 2");
  }

  // Motion prompt under 60 words
  const motionWords = result.motion_prompt.trim().split(/\s+/).length;
  if (motionWords > 80) {
    console.warn(`[smoke-4] WARN motion_prompt is ${motionWords} words (>60 expected)`);
  }

  console.log("[smoke-4] PASS");
}

main().catch((err) => {
  console.error("[smoke-4] FAIL:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run smoke — verify failure**

```bash
npm run smoke:4
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement `orchestrate.ts`**

Create `src/lib/pipeline/orchestrate.ts`:

```typescript
// src/lib/pipeline/orchestrate.ts
import { getGenAIClient } from "../genai-client";
import { buildOrchestrationPrompt } from "../prompts";
import type {
  TemplateMetadata,
  ProductMetadata,
  FaceMetadata,
  OrchestratedPrompts,
} from "./types";

const MODEL = "gemini-2.5-pro";
const TIMEOUT_MS = 15_000;

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
}): Promise<OrchestratedPrompts> {
  const ai = getGenAIClient();
  const prompt = buildOrchestrationPrompt(input.template, input.products, input.face);

  const response = await Promise.race([
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
  ]);

  const text = (response as any).text;
  if (!text) throw new Error("orchestrate: empty response");
  return JSON.parse(text) as OrchestratedPrompts;
}
```

- [ ] **Step 4: Run smoke — verify pass**

```bash
npm run smoke:4
```

Expected: prints three prompts. `keyframe_prompt` references IMAGE 1/2/3. `[smoke-4] PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/orchestrate.ts scripts/smoke/smoke-stage-4.ts
git commit -m "feat(pipeline): Stage 4 prompt orchestration + smoke"
```

---

## Task 9: Stage 5 — Keyframe Compositing (Nano Banana Pro, multi-image)

**Files:**
- Create: `src/lib/pipeline/keyframe.ts`
- Create: `scripts/smoke/smoke-stage-5.ts`

The single highest-risk stage. Multi-image input to `gemini-3-pro-image`. Before writing code, **confirm the spec's open question**: how many images can `gemini-3-pro-image` accept in one call? We need 1 (template frame) + 1 (face) + 2 (products) = 4. If the cap is lower, fall back to staged compositing in a follow-up task.

- [ ] **Step 1: Confirm Nano Banana Pro multi-image limit**

Quickly probe the model with the existing `genai-client.ts` test setup, or check the current `@google/genai` docs. If unclear, send a minimal test call with 4 images (template_first_frame + face + 2 products) and inspect the response. **Do not proceed past this step until you've confirmed 4-image input works.** If it caps at 3, skip the second product and test with 1 product first; multi-product will need a follow-up plan.

- [ ] **Step 2: Write smoke script**

Create `scripts/smoke/smoke-stage-5.ts`:

```typescript
// scripts/smoke/smoke-stage-5.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractFirstFrame } from "../../src/lib/pipeline/ffmpeg";
import { compositeKeyframe } from "../../src/lib/pipeline/keyframe";

const KEYFRAME_PROMPT_FIXTURE = `
Compose a single still image that recreates the scene and pose shown in IMAGE 1,
but featuring the person from IMAGE 2 (preserving their face exactly), naturally
wearing/holding the products from IMAGE 3 onward.

The wristwatch from IMAGE 3 is worn on the LEFT wrist, clearly visible.
The handbag from IMAGE 4 is carried on the right shoulder.

Lighting: warm golden-hour, key light from camera-left.
Framing: medium-wide to chest-up closeup, vertical 9:16.
Composition: shallow depth of field, warm color grade.

The face must match IMAGE 2 EXACTLY — same eye shape, same skin tone, same hair,
same distinctive features. Do not generate a different face. Do not stylize the
face. Identity preservation is the highest priority.
`.trim();

async function main() {
  const templateVideo = resolve("public/templates/cafe-walk/video.mp4");
  const firstFrame = resolve("public/templates/cafe-walk/first_frame.png");
  await extractFirstFrame(templateVideo, firstFrame);

  const facePath = resolve(
    "test-fixtures/runs/cafe-walk__silver-watch__face-A/reference_face.png",
  );
  const watchPath = resolve("public/products/silver-watch/image.png");
  const bagPath = resolve("public/products/brown-tote/image.png");

  const outputPath = resolve(
    "test-fixtures/runs/cafe-walk__silver-watch__face-A/keyframe.png",
  );

  console.log("[smoke-5] compositing keyframe...");
  const result = await compositeKeyframe({
    keyframePrompt: KEYFRAME_PROMPT_FIXTURE,
    templateFirstFrame: { bytes: readFileSync(firstFrame), mimeType: "image/png" },
    referenceFace: { bytes: readFileSync(facePath), mimeType: "image/png" },
    products: [
      { bytes: readFileSync(watchPath), mimeType: "image/png" },
      { bytes: readFileSync(bagPath), mimeType: "image/png" },
    ],
  });

  writeFileSync(outputPath, result.imageBytes);
  console.log(`[smoke-5] saved keyframe to ${outputPath} (${result.imageBytes.length} bytes)`);

  if (result.imageBytes.length < 1000) {
    throw new Error("keyframe is suspiciously small");
  }

  console.log("[smoke-5] PASS — eyeball the keyframe at the path above");
}

main().catch((err) => {
  console.error("[smoke-5] FAIL:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Run smoke — verify failure**

```bash
npm run smoke:5
```

Expected: FAIL (module missing).

- [ ] **Step 4: Implement `keyframe.ts`**

Create `src/lib/pipeline/keyframe.ts`:

```typescript
// src/lib/pipeline/keyframe.ts
import { getGenAIClient } from "../genai-client";

const MODEL = "gemini-3-pro-image";
const TIMEOUT_MS = 60_000;

export type ImageInput = { bytes: Buffer; mimeType: string };

export async function compositeKeyframe(input: {
  keyframePrompt: string;
  templateFirstFrame: ImageInput;
  referenceFace: ImageInput;
  products: ImageInput[];
}): Promise<{ imageBytes: Buffer; mimeType: string }> {
  const ai = getGenAIClient();

  const parts: any[] = [
    { text: input.keyframePrompt },
    {
      inlineData: {
        mimeType: input.templateFirstFrame.mimeType,
        data: input.templateFirstFrame.bytes.toString("base64"),
      },
    },
    {
      inlineData: {
        mimeType: input.referenceFace.mimeType,
        data: input.referenceFace.bytes.toString("base64"),
      },
    },
    ...input.products.map((p) => ({
      inlineData: {
        mimeType: p.mimeType,
        data: p.bytes.toString("base64"),
      },
    })),
  ];

  const response = await Promise.race([
    ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("keyframe timeout")), TIMEOUT_MS),
    ),
  ]);

  // Find the first inline image in the response parts
  const candidates = (response as any).candidates ?? [];
  for (const cand of candidates) {
    for (const part of cand.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return {
          imageBytes: Buffer.from(part.inlineData.data, "base64"),
          mimeType: part.inlineData.mimeType ?? "image/png",
        };
      }
    }
  }

  throw new Error("keyframe: no image in response");
}
```

- [ ] **Step 5: Run smoke — verify pass + eyeball the keyframe**

```bash
npm run smoke:5
open test-fixtures/runs/cafe-walk__silver-watch__face-A/keyframe.png
```

Expected: PNG file is generated. Open it and confirm: face matches reference, watch on wrist, bag on shoulder. If the keyframe is wrong (random face, missing product), iterate the `KEYFRAME_PROMPT_FIXTURE` in the smoke script until it's right. **This is the iteration loop.**

- [ ] **Step 6: Commit (only after the keyframe is visually correct)**

```bash
git add src/lib/pipeline/keyframe.ts scripts/smoke/smoke-stage-5.ts
git commit -m "feat(pipeline): Stage 5 keyframe compositing on Nano Banana Pro + smoke"
```

---

## Task 10: Stage 5b — Quality Judge

**Files:**
- Create: `src/lib/pipeline/judge.ts`
- Create: `scripts/smoke/smoke-stage-5b.ts`

Cheap Gemini vision call that compares the keyframe against its inputs and reports problems. If issues are found, the orchestrator (Task 14) retries Stage 5 once with the corrections appended to the prompt.

- [ ] **Step 1: Write smoke script (uses the keyframe.png produced by Task 9)**

Create `scripts/smoke/smoke-stage-5b.ts`:

```typescript
// scripts/smoke/smoke-stage-5b.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { judgeKeyframe } from "../../src/lib/pipeline/judge";

async function main() {
  const keyframe = readFileSync(
    resolve("test-fixtures/runs/cafe-walk__silver-watch__face-A/keyframe.png"),
  );
  const face = readFileSync(
    resolve("test-fixtures/runs/cafe-walk__silver-watch__face-A/reference_face.png"),
  );
  const watch = readFileSync(resolve("public/products/silver-watch/image.png"));
  const bag = readFileSync(resolve("public/products/brown-tote/image.png"));

  console.log("[smoke-5b] judging keyframe...");
  const result = await judgeKeyframe({
    keyframe: { bytes: keyframe, mimeType: "image/png" },
    referenceFace: { bytes: face, mimeType: "image/png" },
    products: [
      { bytes: watch, mimeType: "image/png" },
      { bytes: bag, mimeType: "image/png" },
    ],
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
```

- [ ] **Step 2: Run smoke — verify failure**

```bash
npm run smoke:5b
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement `judge.ts`**

Create `src/lib/pipeline/judge.ts`:

```typescript
// src/lib/pipeline/judge.ts
import { getGenAIClient } from "../genai-client";
import { JUDGE_PROMPT } from "../prompts";
import type { JudgeReport } from "./types";
import type { ImageInput } from "./keyframe";

const MODEL = "gemini-2.5-pro";
const TIMEOUT_MS = 15_000;

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
    {
      inlineData: {
        mimeType: input.keyframe.mimeType,
        data: input.keyframe.bytes.toString("base64"),
      },
    },
    {
      inlineData: {
        mimeType: input.referenceFace.mimeType,
        data: input.referenceFace.bytes.toString("base64"),
      },
    },
    ...input.products.map((p) => ({
      inlineData: {
        mimeType: p.mimeType,
        data: p.bytes.toString("base64"),
      },
    })),
  ];

  const response = await Promise.race([
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
  ]);

  const text = (response as any).text;
  if (!text) throw new Error("judge: empty response");
  return JSON.parse(text) as JudgeReport;
}
```

- [ ] **Step 4: Run smoke — verify pass**

```bash
npm run smoke:5b
```

Expected: PASS. The booleans should match what you actually see in the keyframe — if the keyframe was correct, all three should be `true`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/judge.ts scripts/smoke/smoke-stage-5b.ts
git commit -m "feat(pipeline): Stage 5b judge + smoke"
```

---

## Task 11: Stage 6 — Kling Image-to-Video (async polling)

**Files:**
- Create: `src/lib/pipeline/kling.ts`
- Create: `scripts/smoke/smoke-stage-6.ts`

**Confirm Kling specifics first:** the spec's Open Question — exact model id and auth scheme. Kling typically uses JWT-signed requests built from `KLING_ACCESS_KEY` and `KLING_SECRET_KEY`. Confirm against the docs for your account tier before writing code.

- [ ] **Step 1: Write smoke script (uses keyframe.png from Task 9)**

Create `scripts/smoke/smoke-stage-6.ts`:

```typescript
// scripts/smoke/smoke-stage-6.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateVideoFromKeyframe } from "../../src/lib/pipeline/kling";

const MOTION_PROMPT_FIXTURE =
  "Subject walks forward toward camera through warm sunlit interior, raises hand toward face mid-clip, settles into shallow-focus closeup. Camera slowly pushes in.";

const NEGATIVE_PROMPT_FIXTURE =
  "blurry face, distorted hands, deformed limbs, extra fingers, missing products, floating objects, face morphing, identity drift, warped product";

async function main() {
  const keyframe = readFileSync(
    resolve("test-fixtures/runs/cafe-walk__silver-watch__face-A/keyframe.png"),
  );
  const outputPath = resolve(
    "test-fixtures/runs/cafe-walk__silver-watch__face-A/output.mp4",
  );

  console.log("[smoke-6] generating video... this may take 30–90 seconds");
  const result = await generateVideoFromKeyframe({
    keyframeBytes: keyframe,
    keyframeMimeType: "image/png",
    motionPrompt: MOTION_PROMPT_FIXTURE,
    negativePrompt: NEGATIVE_PROMPT_FIXTURE,
    durationSeconds: 5,
    aspectRatio: "9:16",
  });

  writeFileSync(outputPath, result.videoBytes);
  console.log(`[smoke-6] saved video to ${outputPath} (${result.videoBytes.length} bytes)`);

  if (result.videoBytes.length < 50_000) {
    throw new Error("video is suspiciously small");
  }

  console.log("[smoke-6] PASS — eyeball the video at the path above");
}

main().catch((err) => {
  console.error("[smoke-6] FAIL:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run smoke — verify failure**

```bash
npm run smoke:6
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement `kling.ts`**

Create `src/lib/pipeline/kling.ts`. **Confirm with Kling's current docs** that the auth scheme below (HMAC-SHA256 JWT) and endpoint paths still apply for your account.

```typescript
// src/lib/pipeline/kling.ts
import { createHmac } from "node:crypto";

const API_BASE = process.env.KLING_API_BASE ?? "https://api.klingai.com";
const ACCESS_KEY = process.env.KLING_ACCESS_KEY ?? "";
const SECRET_KEY = process.env.KLING_SECRET_KEY ?? "";
const MODEL = process.env.KLING_MODEL_ID ?? "kling-v1";

const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_ATTEMPTS = 60; // 5 min wall clock

function buildJwt(): string {
  if (!ACCESS_KEY || !SECRET_KEY) {
    throw new Error("KLING_ACCESS_KEY and KLING_SECRET_KEY must be set");
  }
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: ACCESS_KEY, exp: now + 1800, nbf: now - 5 };

  const b64 = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const data = `${b64(header)}.${b64(payload)}`;
  const sig = createHmac("sha256", SECRET_KEY)
    .update(data)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${data}.${sig}`;
}

async function fetchJson(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${buildJwt()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Kling ${path} ${res.status}: ${body}`);
  }
  return res.json();
}

export async function generateVideoFromKeyframe(input: {
  keyframeBytes: Buffer;
  keyframeMimeType: string;
  motionPrompt: string;
  negativePrompt: string;
  durationSeconds: 5 | 10;
  aspectRatio: "9:16" | "1:1" | "16:9";
}): Promise<{ videoBytes: Buffer; videoUrl: string }> {
  // 1. Submit task
  const submitController = new AbortController();
  const submitTimeout = setTimeout(() => submitController.abort(), SUBMIT_TIMEOUT_MS);

  let taskId: string;
  try {
    const submit = await fetchJson("/v1/videos/image2video", {
      method: "POST",
      signal: submitController.signal,
      body: JSON.stringify({
        model: MODEL,
        image: input.keyframeBytes.toString("base64"),
        prompt: input.motionPrompt,
        negative_prompt: input.negativePrompt,
        duration: String(input.durationSeconds),
        aspect_ratio: input.aspectRatio,
        cfg_scale: 0.5,
      }),
    });
    taskId = submit.data?.task_id ?? submit.task_id;
    if (!taskId) throw new Error("Kling submit: no task_id in response");
  } finally {
    clearTimeout(submitTimeout);
  }

  // 2. Poll
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await fetchJson(`/v1/videos/image2video/${taskId}`);
    const status = poll.data?.task_status ?? poll.task_status;

    if (status === "succeed" || status === "succeeded") {
      const videoUrl =
        poll.data?.task_result?.videos?.[0]?.url ??
        poll.task_result?.videos?.[0]?.url;
      if (!videoUrl) throw new Error("Kling poll: no video URL in result");
      const videoRes = await fetch(videoUrl);
      const buf = Buffer.from(await videoRes.arrayBuffer());
      return { videoBytes: buf, videoUrl };
    }
    if (status === "failed") {
      throw new Error(`Kling task failed: ${poll.data?.task_status_msg ?? "unknown"}`);
    }
  }

  throw new Error(`Kling polling exceeded ${POLL_MAX_ATTEMPTS} attempts (5 min)`);
}
```

> If your Kling account uses a different auth scheme (e.g., simple `X-API-Key` header instead of JWT), strip the `buildJwt()` helper and adjust the `Authorization` header accordingly. The shape of the submit/poll flow is the same across Kling tiers.

- [ ] **Step 4: Run smoke — verify pass**

```bash
npm run smoke:6
```

Expected: takes 30–90s, produces an mp4. Open it:

```bash
open test-fixtures/runs/cafe-walk__silver-watch__face-A/output.mp4
```

Eyeball: does the face stay consistent across the 5 seconds? Are products visible throughout? If face drifts heavily, the keyframe wasn't strong enough — go back to Task 9 and tighten the keyframe prompt.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/kling.ts scripts/smoke/smoke-stage-6.ts
git commit -m "feat(pipeline): Stage 6 Kling i2v with JWT auth + polling + smoke"
```

---

## Task 12: Ingestion Scripts (Templates and Products)

**Files:**
- Create: `scripts/ingest-templates.ts`
- Create: `scripts/ingest-products.ts`

These scripts run Stages 1 and 2 over every asset in `public/templates/` and `public/products/`, saving the JSON output as `metadata.json` next to each asset. Run once (and re-run when you add new templates or products).

- [ ] **Step 1: Write `scripts/ingest-templates.ts`**

```typescript
// scripts/ingest-templates.ts
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { extractFirstFrame } from "../src/lib/pipeline/ffmpeg";
import { analyzeTemplateVideo } from "../src/lib/pipeline/template-analysis";

async function main() {
  const root = resolve("public/templates");
  const ids = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const id of ids) {
    const dir = join(root, id);
    const videoPath = join(dir, "video.mp4");
    const framePath = join(dir, "first_frame.png");
    const metaPath = join(dir, "metadata.json");

    if (!existsSync(videoPath)) {
      console.warn(`[ingest-templates] skipping ${id}: no video.mp4`);
      continue;
    }
    if (existsSync(metaPath)) {
      console.log(`[ingest-templates] skipping ${id}: metadata.json exists (delete to re-ingest)`);
      continue;
    }

    console.log(`[ingest-templates] processing ${id}...`);
    if (!existsSync(framePath)) {
      await extractFirstFrame(videoPath, framePath);
      console.log(`  -> extracted first_frame.png`);
    }

    const metadata = await analyzeTemplateVideo({
      videoBytes: readFileSync(videoPath),
      mimeType: "video/mp4",
    });
    writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    console.log(`  -> wrote metadata.json`);
  }
  console.log("[ingest-templates] DONE");
}

main().catch((err) => {
  console.error("[ingest-templates] FAIL:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run template ingestion**

```bash
npm run ingest:templates
```

Expected: produces `public/templates/cafe-walk/{first_frame.png, metadata.json}`. Inspect `metadata.json` — sanity-check that `motion_script` covers the full template duration.

- [ ] **Step 3: Write `scripts/ingest-products.ts`**

```typescript
// scripts/ingest-products.ts
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { analyzeProduct } from "../src/lib/pipeline/product-analysis";

async function main() {
  const root = resolve("public/products");
  const ids = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const id of ids) {
    const dir = join(root, id);
    const imagePath = join(dir, "image.png");
    const metaPath = join(dir, "metadata.json");

    if (!existsSync(imagePath)) {
      console.warn(`[ingest-products] skipping ${id}: no image.png`);
      continue;
    }
    if (existsSync(metaPath)) {
      console.log(`[ingest-products] skipping ${id}: metadata.json exists (delete to re-ingest)`);
      continue;
    }

    console.log(`[ingest-products] processing ${id}...`);
    const metadata = await analyzeProduct({
      imageBytes: readFileSync(imagePath),
      mimeType: "image/png",
    });
    writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    console.log(`  -> wrote metadata.json`);
  }
  console.log("[ingest-products] DONE");
}

main().catch((err) => {
  console.error("[ingest-products] FAIL:", err);
  process.exit(1);
});
```

- [ ] **Step 4: Run product ingestion**

```bash
npm run ingest:products
```

Expected: produces `public/products/silver-watch/metadata.json` and `public/products/brown-tote/metadata.json`. Inspect both — verify `attachment_strategy` makes sense (`worn_on_wrist` for watch, `carried_on_shoulder` or `held_in_hand` for tote).

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-templates.ts scripts/ingest-products.ts public/templates public/products
git commit -m "feat(ingest): batch ingestion scripts + initial cached metadata"
```

---

## Task 13: In-Memory Run Store

**Files:**
- Create: `src/lib/pipeline/run-store.ts`

Pure data layer, no I/O. Trivial unit-testable code, but for the POC we'll just sanity-check via a small inline script.

- [ ] **Step 1: Implement `run-store.ts`**

```typescript
// src/lib/pipeline/run-store.ts
import type { RunState, RunStatus } from "./types";

const runs = new Map<string, RunState>();

export function createRun(input: {
  template_id: string;
  product_ids: string[];
  reference_face_path: string;
}): RunState {
  const run_id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const state: RunState = {
    run_id,
    status: "analyzing_face",
    progress_label: "Reading reference identity…",
    template_id: input.template_id,
    product_ids: input.product_ids,
    reference_face_path: input.reference_face_path,
    started_at: Date.now(),
  };
  runs.set(run_id, state);
  return state;
}

export function getRun(run_id: string): RunState | undefined {
  return runs.get(run_id);
}

const LABELS: Record<RunStatus, string> = {
  analyzing_face: "Reading reference identity…",
  orchestrating: "Composing scene…",
  compositing_keyframe: "Placing products and locking identity…",
  generating_video: "Rendering motion…",
  succeeded: "Done",
  failed: "Failed",
};

export function updateRun(
  run_id: string,
  patch: Partial<RunState> & { status?: RunStatus },
): RunState {
  const existing = runs.get(run_id);
  if (!existing) throw new Error(`updateRun: unknown run_id ${run_id}`);
  const next: RunState = {
    ...existing,
    ...patch,
    progress_label:
      patch.progress_label ??
      (patch.status ? LABELS[patch.status] : existing.progress_label),
  };
  runs.set(run_id, next);
  return next;
}
```

- [ ] **Step 2: Sanity-check via inline tsx**

```bash
npx tsx -e "
import { createRun, getRun, updateRun } from './src/lib/pipeline/run-store';
const r = createRun({ template_id: 't1', product_ids: ['p1'], reference_face_path: '/tmp/x.png' });
console.log('created:', r.run_id, r.status);
const u = updateRun(r.run_id, { status: 'orchestrating' });
console.log('updated:', u.status, u.progress_label);
console.log('get:', getRun(r.run_id)?.status);
"
```

Expected: prints `analyzing_face`, then `orchestrating Composing scene…`, then `orchestrating`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pipeline/run-store.ts
git commit -m "feat(pipeline): in-memory run store with status labels"
```

---

## Task 14: End-to-End Pipeline Orchestrator

**Files:**
- Create: `src/lib/pipeline/orchestrator.ts`
- Create: `scripts/smoke/smoke-end-to-end.ts`

The function that runs Stages 3 → 6 in sequence, updates the run store, persists artifacts to `public/runs/<run_id>/`, and handles the judge-retry loop for Stage 5.

- [ ] **Step 1: Write end-to-end smoke script**

Create `scripts/smoke/smoke-end-to-end.ts`:

```typescript
// scripts/smoke/smoke-end-to-end.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runPipeline } from "../../src/lib/pipeline/orchestrator";
import { createRun } from "../../src/lib/pipeline/run-store";

async function main() {
  const facePath = resolve(
    "test-fixtures/runs/cafe-walk__silver-watch__face-A/reference_face.png",
  );

  const run = createRun({
    template_id: "cafe-walk",
    product_ids: ["silver-watch", "brown-tote"],
    reference_face_path: facePath,
  });

  console.log("[smoke-e2e] starting pipeline for", run.run_id);
  const final = await runPipeline(run.run_id, {
    referenceFaceBytes: readFileSync(facePath),
    referenceFaceMimeType: "image/png",
  });

  console.log("[smoke-e2e] final state:", JSON.stringify(final, null, 2));

  if (final.status !== "succeeded") {
    throw new Error(`pipeline did not succeed: ${final.status} ${final.error}`);
  }
  if (!final.video_url) throw new Error("missing video_url");
  if (!final.keyframe_url) throw new Error("missing keyframe_url");

  console.log("[smoke-e2e] PASS — open:", final.video_url);
}

main().catch((err) => {
  console.error("[smoke-e2e] FAIL:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run smoke — verify failure**

```bash
npm run smoke:e2e
```

Expected: FAIL — `orchestrator` module doesn't exist.

- [ ] **Step 3: Implement `orchestrator.ts`**

Create `src/lib/pipeline/orchestrator.ts`:

```typescript
// src/lib/pipeline/orchestrator.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { analyzeReferenceFace } from "./face-analysis";
import { orchestratePrompts } from "./orchestrate";
import { compositeKeyframe } from "./keyframe";
import { judgeKeyframe } from "./judge";
import { generateVideoFromKeyframe } from "./kling";
import { updateRun, getRun } from "./run-store";
import type {
  TemplateAsset,
  ProductAsset,
  TemplateMetadata,
  ProductMetadata,
} from "./types";

function loadTemplate(template_id: string): TemplateAsset {
  const dir = resolve("public/templates", template_id);
  const metadata = JSON.parse(
    readFileSync(join(dir, "metadata.json"), "utf-8"),
  ) as TemplateMetadata;
  return {
    id: template_id,
    title: template_id,
    description: "",
    video_path: `templates/${template_id}/video.mp4`,
    first_frame_path: `templates/${template_id}/first_frame.png`,
    metadata,
  };
}

function loadProduct(product_id: string): ProductAsset {
  const dir = resolve("public/products", product_id);
  const metadata = JSON.parse(
    readFileSync(join(dir, "metadata.json"), "utf-8"),
  ) as ProductMetadata;
  return {
    id: product_id,
    name: product_id,
    description: "",
    image_path: `products/${product_id}/image.png`,
    metadata,
  };
}

export async function runPipeline(
  run_id: string,
  input: { referenceFaceBytes: Buffer; referenceFaceMimeType: string },
) {
  try {
    const run = getRun(run_id);
    if (!run) throw new Error(`unknown run_id ${run_id}`);

    const template = loadTemplate(run.template_id);
    const products = run.product_ids.map(loadProduct);

    const runDir = resolve("public/runs", run_id);
    mkdirSync(runDir, { recursive: true });

    // Stage 3 — face analysis
    updateRun(run_id, { status: "analyzing_face" });
    const face = await analyzeReferenceFace({
      imageBytes: input.referenceFaceBytes,
      mimeType: input.referenceFaceMimeType,
    });

    // Stage 4 — orchestration
    updateRun(run_id, { status: "orchestrating" });
    const prompts = await orchestratePrompts({
      template: template.metadata,
      products: products.map((p) => p.metadata),
      face,
    });

    // Stage 5 — keyframe (with judge + retry)
    updateRun(run_id, { status: "compositing_keyframe" });
    const templateFirstFrame = readFileSync(resolve("public", template.first_frame_path));
    const productImages = products.map((p) => ({
      bytes: readFileSync(resolve("public", p.image_path)),
      mimeType: "image/png" as const,
    }));

    let keyframe = await compositeKeyframe({
      keyframePrompt: prompts.keyframe_prompt,
      templateFirstFrame: { bytes: templateFirstFrame, mimeType: "image/png" },
      referenceFace: {
        bytes: input.referenceFaceBytes,
        mimeType: input.referenceFaceMimeType,
      },
      products: productImages,
    });

    const judgement = await judgeKeyframe({
      keyframe: { bytes: keyframe.imageBytes, mimeType: keyframe.mimeType },
      referenceFace: {
        bytes: input.referenceFaceBytes,
        mimeType: input.referenceFaceMimeType,
      },
      products: productImages,
    });

    if (
      !judgement.identity_preserved ||
      !judgement.all_products_present ||
      !judgement.products_correctly_placed
    ) {
      console.warn("[orchestrator] judge flagged issues, retrying once:", judgement.issues);
      const retryPrompt = `${prompts.keyframe_prompt}

CORRECTIONS based on the previous attempt — fix these issues explicitly:
${judgement.issues.map((i) => `- ${i}`).join("\n")}`;
      keyframe = await compositeKeyframe({
        keyframePrompt: retryPrompt,
        templateFirstFrame: { bytes: templateFirstFrame, mimeType: "image/png" },
        referenceFace: {
          bytes: input.referenceFaceBytes,
          mimeType: input.referenceFaceMimeType,
        },
        products: productImages,
      });
    }

    const keyframePath = join(runDir, "composite_keyframe.png");
    writeFileSync(keyframePath, keyframe.imageBytes);
    const keyframe_url = `/runs/${run_id}/composite_keyframe.png`;
    updateRun(run_id, { keyframe_url });

    // Stage 6 — Kling
    updateRun(run_id, { status: "generating_video" });
    const video = await generateVideoFromKeyframe({
      keyframeBytes: keyframe.imageBytes,
      keyframeMimeType: keyframe.mimeType,
      motionPrompt: prompts.motion_prompt,
      negativePrompt: prompts.negative_prompt,
      durationSeconds: 5,
      aspectRatio: "9:16",
    });

    const videoPath = join(runDir, "output.mp4");
    writeFileSync(videoPath, video.videoBytes);
    const video_url = `/runs/${run_id}/output.mp4`;

    return updateRun(run_id, { status: "succeeded", video_url });
  } catch (err: any) {
    return updateRun(run_id, {
      status: "failed",
      error: err.message ?? String(err),
    });
  }
}
```

- [ ] **Step 4: Run end-to-end smoke — verify pass**

```bash
npm run smoke:e2e
```

Expected: takes ~50s–2min, prints final state with `status: "succeeded"`, `video_url`, `keyframe_url`. Open the video file at `public/runs/<run_id>/output.mp4` and eyeball it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/orchestrator.ts scripts/smoke/smoke-end-to-end.ts
git commit -m "feat(pipeline): end-to-end orchestrator with judge retry + e2e smoke"
```

---

## Task 15: API Routes

**Files:**
- Create: `src/app/api/video-poc/generate/route.ts`
- Create: `src/app/api/video-poc/runs/[id]/route.ts`

- [ ] **Step 1: Implement POST /api/video-poc/generate**

Create `src/app/api/video-poc/generate/route.ts`:

```typescript
// src/app/api/video-poc/generate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRun } from "@/lib/pipeline/run-store";
import { runPipeline } from "@/lib/pipeline/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min, matches Kling poll budget

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { template_id, product_ids, reference_face_base64 } = body;

    if (!template_id || typeof template_id !== "string") {
      return NextResponse.json({ error: "template_id required" }, { status: 400 });
    }
    if (!Array.isArray(product_ids) || product_ids.length < 1 || product_ids.length > 2) {
      return NextResponse.json(
        { error: "product_ids must be array of 1–2 strings" },
        { status: 400 },
      );
    }
    if (!reference_face_base64 || typeof reference_face_base64 !== "string") {
      return NextResponse.json(
        { error: "reference_face_base64 required" },
        { status: 400 },
      );
    }

    const buf = Buffer.from(reference_face_base64, "base64");

    // Persist face to disk so the orchestrator can reference a stable path
    const tmpRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const dir = resolve("public/runs", tmpRunId);
    mkdirSync(dir, { recursive: true });
    const facePath = join(dir, "reference_face.png");
    writeFileSync(facePath, buf);

    const run = createRun({
      template_id,
      product_ids,
      reference_face_path: facePath,
    });

    // Fire the pipeline in the background — return run_id immediately.
    void runPipeline(run.run_id, {
      referenceFaceBytes: buf,
      referenceFaceMimeType: "image/png",
    });

    return NextResponse.json({ run_id: run.run_id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "unknown" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Implement GET /api/video-poc/runs/[id]**

Create `src/app/api/video-poc/runs/[id]/route.ts`:

```typescript
// src/app/api/video-poc/runs/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/pipeline/run-store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const run = getRun(params.id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    run_id: run.run_id,
    status: run.status,
    progress_label: run.progress_label,
    keyframe_url: run.keyframe_url,
    video_url: run.video_url,
    error: run.error,
  });
}
```

- [ ] **Step 3: Smoke-test the routes manually with the dev server**

```bash
npm run dev
```

In another terminal:

```bash
# Encode the test face as base64
B64=$(base64 -i test-fixtures/runs/cafe-walk__silver-watch__face-A/reference_face.png)

# Submit
curl -s -X POST http://localhost:3000/api/video-poc/generate \
  -H "Content-Type: application/json" \
  -d "{\"template_id\":\"cafe-walk\",\"product_ids\":[\"silver-watch\",\"brown-tote\"],\"reference_face_base64\":\"$B64\"}"
# Expected: {"run_id":"run_..."}

# Poll (use the run_id from above)
curl -s http://localhost:3000/api/video-poc/runs/<RUN_ID> | jq
# Repeat every few seconds; status should progress and end at "succeeded"
```

Expected: status walks through `analyzing_face → orchestrating → compositing_keyframe → generating_video → succeeded`. Final response includes `video_url: "/runs/<run_id>/output.mp4"`. Visit that URL in a browser to confirm the video plays.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/video-poc
git commit -m "feat(api): /api/video-poc/generate + /api/video-poc/runs/:id"
```

---

## Task 16: ProductPicker Component

**Files:**
- Create: `src/components/ProductPicker.tsx`

Multi-select with a hard cap of 2. Reads from `public/products/*/metadata.json` exposed via a tiny manifest file (we generate the manifest in this task too).

- [ ] **Step 1: Add a manifest endpoint for the product catalog**

Create `src/app/api/video-poc/catalog/route.ts`:

```typescript
// src/app/api/video-poc/catalog/route.ts
import { NextResponse } from "next/server";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const templatesRoot = resolve("public/templates");
  const productsRoot = resolve("public/products");

  const templates = readdirSync(templatesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((id) => existsSync(join(templatesRoot, id, "metadata.json")))
    .map((id) => ({
      id,
      video_url: `/templates/${id}/video.mp4`,
      first_frame_url: `/templates/${id}/first_frame.png`,
    }));

  const products = readdirSync(productsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((id) => existsSync(join(productsRoot, id, "metadata.json")))
    .map((id) => {
      const meta = JSON.parse(
        readFileSync(join(productsRoot, id, "metadata.json"), "utf-8"),
      );
      return {
        id,
        image_url: `/products/${id}/image.png`,
        product_type: meta.product_type,
        visual_description: meta.visual_description,
      };
    });

  return NextResponse.json({ templates, products });
}
```

- [ ] **Step 2: Implement `ProductPicker.tsx`**

Create `src/components/ProductPicker.tsx`:

```tsx
// src/components/ProductPicker.tsx
"use client";
import { useState } from "react";

export type CatalogProduct = {
  id: string;
  image_url: string;
  product_type: string;
  visual_description: string;
};

export function ProductPicker(props: {
  products: CatalogProduct[];
  selected: string[];
  onChange: (ids: string[]) => void;
  max?: number;
}) {
  const max = props.max ?? 2;
  const toggle = (id: string) => {
    if (props.selected.includes(id)) {
      props.onChange(props.selected.filter((x) => x !== id));
    } else if (props.selected.length < max) {
      props.onChange([...props.selected, id]);
    }
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {props.products.map((p) => {
        const isSelected = props.selected.includes(p.id);
        const isDisabled = !isSelected && props.selected.length >= max;
        return (
          <button
            key={p.id}
            type="button"
            disabled={isDisabled}
            onClick={() => toggle(p.id)}
            className={`relative rounded-lg border-2 p-2 text-left transition ${
              isSelected
                ? "border-blue-500 ring-2 ring-blue-200"
                : isDisabled
                  ? "border-gray-200 opacity-40 cursor-not-allowed"
                  : "border-gray-200 hover:border-gray-400"
            }`}
          >
            <img
              src={p.image_url}
              alt={p.product_type}
              className="w-full aspect-square object-cover rounded"
            />
            <div className="mt-2 text-sm font-medium">{p.product_type}</div>
            <div className="text-xs text-gray-500 line-clamp-2">
              {p.visual_description}
            </div>
            {isSelected && (
              <div className="absolute top-1 right-1 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                {props.selected.indexOf(p.id) + 1}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Manually verify the catalog endpoint**

With `npm run dev` running:

```bash
curl -s http://localhost:3000/api/video-poc/catalog | jq
```

Expected: JSON with a `templates` array (your one template) and a `products` array (your two products).

- [ ] **Step 4: Commit**

```bash
git add src/components/ProductPicker.tsx src/app/api/video-poc/catalog
git commit -m "feat(ui): ProductPicker component + catalog manifest endpoint"
```

---

## Task 17: /video-poc Wizard Page

**Files:**
- Create: `src/app/video-poc/page.tsx`

Single-page wizard. Reuses `TemplateSelector`, `UploadSection`, `GenerateButton`, `ProgressModal`, `VideoPreview`. Pulls catalog from `/api/video-poc/catalog`. Polls `/api/video-poc/runs/:id` every 2s.

- [ ] **Step 1: Implement the page**

Create `src/app/video-poc/page.tsx`:

```tsx
// src/app/video-poc/page.tsx
"use client";
import { useEffect, useState } from "react";
import { ProductPicker, type CatalogProduct } from "@/components/ProductPicker";

type Template = {
  id: string;
  video_url: string;
  first_frame_url: string;
};

type RunStatusResponse = {
  run_id: string;
  status:
    | "analyzing_face"
    | "orchestrating"
    | "compositing_keyframe"
    | "generating_video"
    | "succeeded"
    | "failed";
  progress_label: string;
  keyframe_url?: string;
  video_url?: string;
  error?: string;
};

export default function VideoPocPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunStatusResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/video-poc/catalog")
      .then((r) => r.json())
      .then((data) => {
        setTemplates(data.templates);
        setProducts(data.products);
      });
  }, []);

  useEffect(() => {
    if (!runId) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/video-poc/runs/${runId}`);
      const data: RunStatusResponse = await res.json();
      setRun(data);
      if (data.status === "succeeded" || data.status === "failed") {
        clearInterval(interval);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [runId]);

  const canGenerate =
    !!templateId && productIds.length >= 1 && !!faceFile && !submitting && !runId;

  async function handleGenerate() {
    if (!templateId || !faceFile) return;
    setSubmitting(true);
    try {
      const reader = new FileReader();
      const base64: string = await new Promise((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]); // strip data: prefix
        };
        reader.onerror = reject;
        reader.readAsDataURL(faceFile);
      });

      const res = await fetch("/api/video-poc/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: templateId,
          product_ids: productIds,
          reference_face_base64: base64,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "submit failed");
      setRunId(data.run_id);
    } catch (err: any) {
      alert(`Failed to start: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setRunId(null);
    setRun(null);
    setFaceFile(null);
  }

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-8">
      <header>
        <h1 className="text-3xl font-bold">AI Video POC</h1>
        <p className="text-gray-600">
          Pick a template, pick up to 2 products, upload a reference face. Generate.
        </p>
      </header>

      {/* Step 1: Templates */}
      <section>
        <h2 className="text-xl font-semibold mb-2">1. Template</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTemplateId(t.id)}
              className={`rounded-lg border-2 p-2 transition ${
                templateId === t.id
                  ? "border-blue-500 ring-2 ring-blue-200"
                  : "border-gray-200 hover:border-gray-400"
              }`}
            >
              <img
                src={t.first_frame_url}
                alt={t.id}
                className="w-full aspect-[9/16] object-cover rounded"
              />
              <div className="mt-2 text-sm font-medium">{t.id}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Step 2: Products */}
      <section>
        <h2 className="text-xl font-semibold mb-2">
          2. Products{" "}
          <span className="text-sm font-normal text-gray-500">
            (pick 1–2, in order)
          </span>
        </h2>
        <ProductPicker
          products={products}
          selected={productIds}
          onChange={setProductIds}
          max={2}
        />
      </section>

      {/* Step 3: Reference face */}
      <section>
        <h2 className="text-xl font-semibold mb-2">3. Reference face</h2>
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={(e) => setFaceFile(e.target.files?.[0] ?? null)}
          className="block"
        />
        {faceFile && (
          <p className="text-sm text-gray-600 mt-1">Selected: {faceFile.name}</p>
        )}
      </section>

      {/* Step 4: Generate */}
      <section>
        <button
          type="button"
          disabled={!canGenerate}
          onClick={handleGenerate}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-40"
        >
          {submitting ? "Starting…" : "Generate Video"}
        </button>
      </section>

      {/* Step 5: Progress + result */}
      {run && (
        <section className="border rounded-lg p-4 bg-gray-50 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Progress</h2>
            <button
              type="button"
              onClick={reset}
              className="text-sm text-gray-500 underline"
            >
              Start over
            </button>
          </div>
          <p className="text-sm">{run.progress_label}</p>

          {run.keyframe_url && !run.video_url && run.status !== "failed" && (
            <div>
              <p className="text-xs text-gray-500 mb-1">
                Identity locked, rendering motion…
              </p>
              <img
                src={run.keyframe_url}
                alt="keyframe"
                className="max-w-xs rounded"
              />
            </div>
          )}

          {run.video_url && (
            <video
              src={run.video_url}
              controls
              autoPlay
              loop
              className="max-w-md rounded"
            />
          )}

          {run.status === "failed" && (
            <p className="text-red-600 text-sm">Failed: {run.error}</p>
          )}
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Manually walk the demo flow in the browser**

```bash
npm run dev
```

Visit `http://localhost:3000/video-poc`. Click through:
1. Pick the template (it should appear with first-frame thumbnail)
2. Pick the watch + the tote (selection counter shows 1, 2)
3. Upload a reference face from disk
4. Click "Generate Video"
5. Watch the status label cycle: "Reading reference identity…" → "Composing scene…" → "Placing products and locking identity…" (keyframe shows) → "Rendering motion…" → final video plays

Expected: end-to-end demo works in the browser. If anything fails, check the browser console + Next.js dev server logs.

- [ ] **Step 3: Commit**

```bash
git add src/app/video-poc/page.tsx
git commit -m "feat(ui): /video-poc wizard page with polling and keyframe preview"
```

---

## Task 18: Pre-Demo Dry Run + Golden Set

**Files:** none new — this task is a verification step.

- [ ] **Step 1: Add 4 more golden-set fixtures**

Create 4 additional `(template, products, face)` tuples under `test-fixtures/runs/` with different reference faces (varied gender, age, ethnicity) so the demo proves robustness across identities. Each fixture is just a `reference_face.png` — the template + product combinations can repeat.

```bash
mkdir -p test-fixtures/runs/cafe-walk__silver-watch__face-B
mkdir -p test-fixtures/runs/cafe-walk__brown-tote__face-C
mkdir -p test-fixtures/runs/cafe-walk__silver-watch_brown-tote__face-D
mkdir -p test-fixtures/runs/cafe-walk__silver-watch_brown-tote__face-E
# Drop a reference_face.png into each
```

- [ ] **Step 2: Run the end-to-end smoke for each fixture**

For each fixture, edit `scripts/smoke/smoke-end-to-end.ts` to point at that fixture's `reference_face.png`, then:

```bash
npm run smoke:e2e
```

Save each output mp4 under `test-fixtures/runs/<tuple>/output.mp4`. Eyeball each one. If any fails the eyeball test (face drifts, products missing, identity wrong), iterate the prompts in `src/lib/prompts.ts` and re-run.

- [ ] **Step 3: 30 minutes before the demo, run all 5 fixtures end-to-end through the browser**

Walk through `/video-poc` for each face. Confirm all 5 succeed. If any fail, you know before the audience does.

- [ ] **Step 4: Commit final golden-set outputs (or document them)**

```bash
git add test-fixtures
git commit -m "chore(fixtures): golden-set with 5 reference faces for pre-demo dry run"
```

---

## Done

If every task above is complete and the dry run on Task 18 passes for all 5 fixtures, you have a working POC ready to demo. Open `/video-poc` in the browser, upload a fresh reference face, and let it run live.
