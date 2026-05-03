# AI Product Video POC Pipeline — Design Spec

**Date:** 2026-05-03
**Status:** Approved (brainstorming phase) — pending implementation plan
**Scope:** Proof of concept for stakeholder demo. Not the full MVP product.

---

## 1. Goal & Scope

Build a working pipeline that takes a fixed reference video template, one or two products from a fixed catalog, and a freshly uploaded reference face, and produces a 5-second AI video where:

- The output mimics the **structural motion** of the template (not pixel-aligned, but choreographically faithful)
- The reference face's identity is preserved on the on-screen subject
- The selected products appear naturally on the subject according to each product's type (watch on wrist, bag in hand, etc.)

**Audience:** Stakeholder demo. Approval gate before building the full MVP.

**Demo conditions:** Templates and product catalog are pre-loaded and fixed. Each demo run uploads a different reference face to showcase the pipeline working across identities.

### Out of scope for this POC

- Multi-tenant auth, billing, user accounts
- Template/product CRUD UI (catalog is hand-curated and pre-ingested)
- Async job queues (Redis, PubSub), WebSockets
- Database (in-memory run state is sufficient for a single-process Next.js dev server during a demo)
- More than 2 products per video
- Videos longer than 5 seconds
- Pixel-aligned motion fidelity (would require pose/depth conditioning infrastructure beyond Kling's standard endpoints)
- Auto-detection of identity drift in the final video (post-Kling)
- Unit tests, E2E tests, observability, Sentry

---

## 2. Architecture & Data Flow

### Inputs

- `template`: one of the pre-existing reference mp4s, selected by `template_id`
- `products`: 1–2 selected products from the existing catalog (each has `image_url`, `name`, `description`)
- `reference_face`: a photo uploaded for that demo run

### Output

One 5-second mp4 (9:16 aspect ratio).

### Six-stage pipeline

```
[Stage 1] Template analysis        Gemini 2.5 Pro (vision-on-video)   [CACHED at ingestion]
           └─► scene_description, motion_script, key_moments, composition_notes

[Stage 2] Product analysis         Gemini 2.5 Pro (vision)            [CACHED at ingestion]
           └─► product_type, attachment_strategy, visual_description

[Stage 3] Reference face analysis  Gemini 2.5 Pro (vision)            [LIVE per demo]
           └─► identity_descriptor (skin tone, hair, features, etc.)

[Stage 4] Prompt orchestration     Gemini 2.5 Pro (text)              [LIVE per demo]
           └─► keyframe_prompt, motion_prompt, negative_prompt

[Stage 5] Keyframe compositing     Nano Banana Pro (gemini-3-pro-image, multi-image)
           inputs: [template_first_frame, reference_face, product_imgs[]] + keyframe_prompt
           └─► composite_keyframe.png

[Stage 5b] Quality judge (optional, included)   Gemini 2.5 Pro (vision)
           └─► identity_preserved, all_products_present, products_correctly_placed
           If any false → retry Stage 5 once with corrections, then proceed.

[Stage 6] Video generation         Kling image-to-video (5s, 9:16)
           inputs: composite_keyframe.png + motion_prompt + negative_prompt
           └─► final_video.mp4
```

### Caching strategy

Stages 1 and 2 are **pre-computed and cached** at ingestion time. Templates and products are fixed for the POC, so their analysis runs once and the JSON output is stored next to the asset. At demo time, only Stages 3 → 6 run live.

This cuts ~10–15s off per-demo latency and keeps Gemini token spend bounded.

### Storage layout

Flat files in `public/`. No DB.

```
public/
  templates/<id>/
    video.mp4
    first_frame.png        (extracted once at ingestion)
    metadata.json          (Stage 1 output, cached)
  products/<id>/
    image.png
    metadata.json          (Stage 2 output, cached)
  runs/<run_id>/            (created per demo run)
    reference_face.png
    composite_keyframe.png
    output.mp4
```

### Run state

In-memory `Map<run_id, RunState>` in `src/lib/pipeline/run-store.ts`. Single-process Next.js dev server is fine for the POC. Swap to Redis when leaving POC.

`RunState` shape:

```ts
type RunState = {
  run_id: string;
  status: "analyzing_face" | "orchestrating" | "compositing_keyframe"
        | "generating_video" | "succeeded" | "failed";
  progress_label: string;
  template_id: string;
  product_ids: string[];
  reference_face_path: string;
  keyframe_url?: string;
  video_url?: string;
  error?: string;
  started_at: number;
};
```

**Note:** because run state is in-memory, restarting the Next.js dev server mid-demo discards all in-flight runs. Acceptable for a controlled stakeholder demo; flagged for the MVP transition.

---

## 3. Model I/O Contracts

### Stage 1 — Template analysis (Gemini 2.5 Pro, vision-on-video)

```json
{
  "scene_description": "Young woman walks toward camera through a sunlit cafe...",
  "subject": {
    "rough_pose": "standing, walking forward, right hand at side, left arm relaxed",
    "framing": "medium-wide to medium closeup, ends on chest-up",
    "lighting": "warm golden-hour, key light from camera-left"
  },
  "motion_script": [
    { "t_start": 0.0, "t_end": 1.5, "action": "walks forward, arms relaxed" },
    { "t_start": 1.5, "t_end": 3.0, "action": "raises right hand toward face, smiles" },
    { "t_start": 3.0, "t_end": 5.0, "action": "settles into closeup, slight head tilt" }
  ],
  "composition_notes": "shallow depth of field, warm color grade, vertical 9:16"
}
```

Constraints:

- `motion_script` covers full duration with no time gaps
- Each `action` is a single concrete physical action a video model can replicate
- Stage must NOT describe subject identity — identity will be replaced
- Stage must NOT name brands or products visible in the template — products will be inserted fresh

### Stage 2 — Product analysis (Gemini 2.5 Pro, vision)

```json
{
  "product_type": "wristwatch",
  "attachment_strategy": "worn_on_wrist",
  "side_preference": "left_wrist",
  "visual_description": "silver round-face analog watch with brown leather strap, ~40mm",
  "key_features": ["silver case", "brown leather", "white dial", "analog"]
}
```

Controlled vocabulary for `attachment_strategy`:
`worn_on_wrist | worn_on_face | held_in_hand | carried_on_shoulder | worn_around_neck | placed_on_surface`

Controlled vocabulary for `side_preference`:
`left_wrist | right_wrist | left_hand | right_hand | center | none`

### Stage 3 — Reference face analysis (Gemini 2.5 Pro, vision)

```json
{
  "perceived_gender": "female",
  "age_range": "20-30",
  "skin_tone": "medium",
  "hair": "shoulder-length, dark brown, straight",
  "distinctive_features": "high cheekbones, brown eyes, slight smile",
  "ethnicity_cues": "south asian features"
}
```

Descriptive only. Used for prompt fidelity, not for identity inference.

### Stage 4 — Prompt orchestration (Gemini 2.5 Pro, text)

```json
{
  "keyframe_prompt": "<text for Nano Banana Pro multi-image call>",
  "motion_prompt": "<text for Kling image-to-video>",
  "negative_prompt": "<text shared across both calls>"
}
```

Prompt construction rules are defined in Section 4 (Prompt Engineering).

### Stage 5 — Keyframe compositing (Nano Banana Pro)

```python
image_model = GenerativeModel("gemini-3-pro-image")
response = image_model.generate_content([
    keyframe_prompt,             # text from Stage 4
    template_first_frame,        # PIL Image / base64 — IMAGE 1
    reference_face_image,        # PIL Image / base64 — IMAGE 2
    product_images[0],           # PIL Image / base64 — IMAGE 3
    product_images[1],           # PIL Image / base64 — IMAGE 4 (if 2 products)
])
# Output: a single PNG, saved to public/runs/<run_id>/composite_keyframe.png
```

The image input order is part of the contract — the keyframe prompt references inputs as `IMAGE 1`, `IMAGE 2`, `IMAGE 3+`.

### Stage 5b — Quality judge (Gemini 2.5 Pro, vision)

```json
{
  "identity_preserved": true,
  "all_products_present": true,
  "products_correctly_placed": true,
  "issues": []
}
```

If any boolean is `false`, retry Stage 5 once with the contents of `issues` appended to the keyframe prompt as explicit corrections (e.g., "the wristwatch was missing in the previous attempt — ensure it is clearly visible on the LEFT wrist"). If retry also fails, surface the keyframe to the UI with a warning rather than blocking the demo.

### Stage 6 — Video generation (Kling image-to-video, async)

```json
// Request
{
  "model": "kling-v1",
  "image": "<base64 of composite_keyframe.png>",
  "prompt": "<motion_prompt from Stage 4>",
  "negative_prompt": "<negative_prompt from Stage 4>",
  "duration": 5,
  "aspect_ratio": "9:16",
  "cfg_scale": 0.5
}

// Response
{ "task_id": "..." }

// Poll GET /tasks/{task_id} every 5s, max 60 polls (5 minute wall clock)
// Until status="succeeded" → returns video URL → save to public/runs/<run_id>/output.mp4
```

The exact Kling model id (`kling-v1` shown above) must be confirmed against the user's actual Kling account tier during implementation.

---

## 4. Prompt Engineering

All prompts live in `src/lib/prompts.ts` as exported constants. Each is a versioned, modular artifact. Prompts use Gemini's `response_schema` feature where structured output is required.

### `TEMPLATE_ANALYSIS_PROMPT` (Stage 1 — runs once per template at ingestion)

```
SYSTEM: You are analyzing a short reference video that will guide AI video
generation. Extract objective motion and composition information.

CONSTRAINTS:
- motion_script must cover the full duration with no time gaps
- each action must be a single, concrete physical action a video model can replicate
- DO NOT describe subject identity (face, ethnicity, clothing) — identity will be replaced
- DO NOT name brands/products visible in the video — products will be inserted fresh

OUTPUT: strict JSON matching the response_schema (Stage 1 contract above).
```

### `PRODUCT_ANALYSIS_PROMPT` (Stage 2 — runs once per product at ingestion)

```
SYSTEM: Catalogue this product image for downstream AI video generation.

CONSTRAINTS:
- attachment_strategy must be one of:
  worn_on_wrist | worn_on_face | held_in_hand |
  carried_on_shoulder | worn_around_neck | placed_on_surface
- be precise about color and material — these drive product fidelity in the keyframe

OUTPUT: strict JSON (Stage 2 contract above).
```

### `FACE_ANALYSIS_PROMPT` (Stage 3 — runs each demo)

```
SYSTEM: Describe this reference photo objectively for downstream identity-
preserving image generation. Use descriptive, neutral language only.

OUTPUT: strict JSON (Stage 3 contract above).
```

### `ORCHESTRATION_PROMPT` (Stage 4 — runs each demo)

This prompt produces the two prompts that drive generation. It takes the three analysis JSONs as input and emits three text prompts as output.

```
SYSTEM: You are composing prompts for two AI models in a video pipeline.
You will receive analysis JSON from earlier stages and must emit three text
prompts: keyframe_prompt, motion_prompt, negative_prompt.

INPUTS:
- template_analysis: {{TEMPLATE_JSON}}
- product_analyses:  {{PRODUCTS_JSON_ARRAY}}
- face_analysis:     {{FACE_JSON}}

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
```

### `JUDGE_PROMPT` (Stage 5b — runs each demo)

```
SYSTEM: Compare a generated keyframe against the inputs that produced it.
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

Be strict on identity_preserved. Be lenient on minor product styling
differences as long as the product is recognizably the same item.
```

### Modularity rationale

- Four distinct prompts, four distinct stages — swapping any one model only changes one prompt
- Identity preservation is doubled-up: Stage 3 face JSON describes the face, AND `keyframe_prompt` explicitly anchors to "IMAGE 2" as the visual reference
- `motion_prompt` is intentionally identity-blind — repeating identity in the motion prompt empirically causes Kling face drift
- Stage 4 is itself a Gemini call (not string concatenation) so it can apply judgment, e.g., emphasizing face stability in the negative prompt for closeup-heavy templates

---

## 5. Demo UI

### Route

`/video-poc` (new). Built alongside the existing `/` virtual-try-on flow. Existing flow is unchanged.

### Wizard steps

```
Step 1: Template (carousel)        ← reuse src/components/TemplateSelector.tsx
        └─ fed from public/templates/*/metadata.json
Step 2: Products (multi-select, max 2)  ← NEW: src/components/ProductPicker.tsx
        └─ fed from public/products/*/metadata.json
Step 3: Reference face upload      ← reuse src/components/UploadSection.tsx (single-image variant)
Step 4: Generate                   ← reuse src/components/GenerateButton.tsx
Step 5: Progress + result          ← reuse src/components/ProgressModal.tsx + VideoPreview.tsx
```

### Demo-grade UX touches

1. **Show the keyframe before the video.** When Stage 5 finishes (~15s in), display the composite keyframe in the progress modal with a label like "Identity locked, rendering motion…". Gives the audience something to look at during the slow Kling step and visibly demonstrates the multi-stage pipeline.
2. **Friendly status labels** mapped server-side from the status enum:
   - `analyzing_face` → "Reading reference identity…"
   - `orchestrating` → "Composing scene…"
   - `compositing_keyframe` → "Placing products and locking identity…"
   - `generating_video` → "Rendering motion…"

### API surface

```
POST /api/video-poc/generate
  body: { template_id: string, product_ids: string[], reference_face_base64: string }
  response: { run_id: string }

  Server returns immediately and continues Stages 3–6 in the background.

GET /api/video-poc/runs/:run_id
  response: {
    status: "analyzing_face" | "orchestrating" | "compositing_keyframe"
          | "generating_video" | "succeeded" | "failed",
    progress_label: string,
    keyframe_url?: string,    // populated when Stage 5 (incl. judge + any retry) completes
    video_url?: string,       // populated when Stage 6 completes
    error?: string
  }

Note: Stage 5b (judge) is internal to the `compositing_keyframe` phase. The UI does
not see a separate judging state — the run remains in `compositing_keyframe` while
the judge runs and any single retry executes. `keyframe_url` is only published once
the keyframe has either passed the judge or exhausted its retry.
```

### Polling, not WebSockets

Frontend polls `/runs/:run_id` every 2s using `useSWR` or plain `setInterval`. Only real wait is Kling, which is server-side.

### File layout

```
NEW:  src/app/video-poc/page.tsx                  — wizard
NEW:  src/app/api/video-poc/generate/route.ts     — kicks off pipeline
NEW:  src/app/api/video-poc/runs/[id]/route.ts    — status polling
NEW:  src/components/ProductPicker.tsx            — multi-select up to 2

NEW:  src/lib/prompts.ts                          — all 5 prompts (Section 4)
NEW:  src/lib/pipeline/template-analysis.ts       — Stage 1
NEW:  src/lib/pipeline/product-analysis.ts        — Stage 2
NEW:  src/lib/pipeline/face-analysis.ts           — Stage 3
NEW:  src/lib/pipeline/orchestrate.ts             — Stage 4
NEW:  src/lib/pipeline/keyframe.ts                — Stage 5 (Nano Banana Pro)
NEW:  src/lib/pipeline/judge.ts                   — Stage 5b
NEW:  src/lib/pipeline/kling.ts                   — Stage 6 (Kling i2v + polling)
NEW:  src/lib/pipeline/run-store.ts               — in-memory run state
NEW:  src/lib/pipeline/types.ts                   — shared TypeScript types

NEW:  scripts/ingest-templates.ts                 — runs Stage 1 once per template
NEW:  scripts/ingest-products.ts                  — runs Stage 2 once per product
NEW:  scripts/smoke/smoke-stage-1.ts              — debug Stage 1 standalone
NEW:  scripts/smoke/smoke-stage-5.ts              — debug keyframe compositing
NEW:  scripts/smoke/smoke-stage-6.ts              — debug Kling generation

NEW:  public/templates/<id>/{video.mp4, first_frame.png, metadata.json}
NEW:  public/products/<id>/{image.png, metadata.json}

UNCHANGED: existing /, /api/virtual-tryon, src/lib/imagen.ts, src/lib/genai-client.ts, etc.
```

---

## 6. Error Handling

### Failure taxonomy

**Hard errors** (API down, network, malformed JSON, timeout): one retry with exponential backoff, then surface to the UI as a failed run with the stage label. Operator restarts the demo.

**Quality failures** (call succeeded but output is bad):
- Identity drift in keyframe → caught by Stage 5b judge, retry Stage 5 once with corrections
- Missing/misplaced product → caught by Stage 5b judge, retry Stage 5 once with corrections
- Identity drift in final video → not auto-detected; relies on pre-demo eyeball check

If the Stage 5 retry also fails the judge, surface the keyframe to the UI with a warning rather than blocking the demo. The operator decides whether to proceed.

### Hard timeouts

| Stage | Timeout | Polling |
|---|---|---|
| 3 — face analysis | 15s | — |
| 4 — orchestration | 15s | — |
| 5 — keyframe | 60s | — |
| 5b — judge | 15s | — |
| 6 — Kling | 5min wall clock | poll every 5s, max 60 polls |

If Kling exceeds the wall clock, kill the run and mark it failed. Do not let a stuck task lock up the demo.

---

## 7. Testing Strategy

POC-grade. Manual, not automated.

1. **Golden set** — 5 fixed `(template, product_ids, reference_face)` tuples stored under `test-fixtures/runs/`. Re-run them after every change to `src/lib/prompts.ts`. Outputs go to `test-fixtures/runs/<tuple>/<date>/`. Compare visually to last good output.

2. **Per-stage smoke scripts** — `scripts/smoke/smoke-stage-{1,5,6}.ts`. Each script runs one stage standalone against a fixture. Used to debug "did Nano Banana Pro break, or did the prompt break?".

3. **Pre-demo dry run** — 30 minutes before the demo, run all 5 golden tuples end-to-end. Catch regressions before the audience.

---

## 8. Cost & Latency Budget

Per live demo run:

| Stage | Latency | Cost (USD, approx) |
|---|---|---|
| 3 — face analysis | 3–5s | ~$0.01 |
| 4 — orchestration | 2–3s | ~$0.01 |
| 5 — keyframe | 10–15s | ~$0.04 |
| 5b — judge | 3–5s | ~$0.01 |
| 6 — Kling | 30–90s | ~$0.30–0.50 |
| **Total** | **~50s–2min** | **~$0.40 per run** |

A 2-hour stakeholder demo with 20 runs ≈ $8 in API spend. Stages 1 and 2 are cached and not in this budget.

---

## 9. Decisions Locked During Brainstorming

For traceability:

| Decision | Choice | Reasoning |
|---|---|---|
| Template format | Pre-rendered mp4 reference videos | User input |
| Motion fidelity | Structurally faithful, not pixel-exact | Pixel-aligned would require pose/depth conditioning beyond Kling's standard endpoints; not POC-feasible |
| Product handling | Insertion (no template anchor), multi-product | Templates do not contain placeholder products; products are added based on type |
| Keyframe compositing | Single-pass multi-image on Nano Banana Pro | Native multi-image input, fastest iteration; staged compositing rejected due to compound error and 3× cost |
| Kling endpoint | image-to-video | Confirmed accessible; required for keyframe → video step |
| Video length | 5 seconds | Reduces cost, latency, and temporal consistency risk |
| Max products per video | 2 | Matches user's watch+bag example; keeps keyframe prompt tractable |
| Quality judge after Stage 5 | Included | Cheap (~$0.01 + ~5s); Kling is the expensive step, so catching bad keyframes pre-Kling pays for itself |
| Run state | In-memory `Map` | POC scope; Redis comes later |
| Async transport | HTTP polling every 2s | WebSockets are over-engineering for POC |
| Auth | None | Out of POC scope |

---

## 10. Open Questions for Implementation Phase

These are not blockers for the spec but will need to be answered during implementation:

1. **Exact Kling model id** — `kling-v1` is a placeholder. The actual model name depends on the user's Kling account tier and must be confirmed against Kling's current API documentation when implementing `src/lib/pipeline/kling.ts`.
2. **Nano Banana Pro multi-image limits** — confirm the maximum number of input images the `gemini-3-pro-image` endpoint accepts in a single call. If it caps at <4 (template_frame + face + 2 products = 4), the design holds. If it caps lower, the second product gets added in a second pass.
3. **Template first-frame extraction tool** — `ffmpeg` via Node's `child_process` is the obvious choice, but confirm it's available in the deployment environment (or use a JS-native lib like `fluent-ffmpeg`).
