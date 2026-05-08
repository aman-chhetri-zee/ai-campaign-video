# AI Campaign Video — Backend SDK

A Node.js + TypeScript pipeline that takes a **reference face**, a **template video**, and a **set of product images**, and produces a multi-shot AI-generated video of the creator demonstrating the products in the style of the template.

This folder is the **public-facing surface** of the pipeline — the functions in `service/index.ts` are what you call from your backend. Everything inside `src/lib/pipeline/*` is internal and may change between revisions; treat the SDK as your stable contract.

---

## Pipeline at a glance

```
[ creator photo ]   [ products[] ]   [ template video ]
       │                  │                  │
       ▼                  ▼                  ▼
 Stage 3: face   Stage 2: product    Stage 1: template
 analysis        analysis            analysis (Gemini)
 (Gemini)        (Gemini)
       │                  │                  │
       └─────────► Stage 4: orchestrate per-look prompts (Gemini)
                              │
                              ▼
                  Stage 3.5: master subject reference
                              │
                              ▼
              Stage 5: per-look keyframe (Nano Banana Pro)
                              │
                              ▼
                Stage 5b: judge keyframe (Gemini)
                              │
                              ▼
            Stage 6: per-look video clip (kie.ai/Seedance)
                              │
                              ▼
              Stage 7: concat clips + mux template audio
                              │
                              ▼
                          output.mp4
```

You don't have to call each stage — `runPipeline()` orchestrates everything. The lower-level functions (`analyzeProduct`, `compositeKeyframe`, etc.) are exposed for callers that need fine-grained control.

---

## Prerequisites

| What | Why | How |
|---|---|---|
| **Node.js 18+** | Pipeline runtime | `node --version` |
| **ffmpeg** | Frame extraction, clip normalization, concat, audio mux | `brew install ffmpeg` (macOS) / `apt install ffmpeg` (Linux) / [download](https://ffmpeg.org/download.html) |
| **Google Cloud project + service account** | Vertex AI access (Gemini + Nano Banana Pro) | See [Vertex AI setup](#vertex-ai-setup) |
| **kie.ai account** | Video generation provider (recommended) | [api.kie.ai](https://api.kie.ai), top up credits — each video costs ~$0.40 |
| **Vercel Blob storage** | kie.ai needs HTTPS URLs for keyframes/products it fetches server-side | [Vercel dashboard → Storage](https://vercel.com/dashboard/stores) |

### Vertex AI setup

1. Create or use a GCP project. Enable the **Vertex AI API**.
2. Create a service account with these roles: `roles/aiplatform.user`.
3. Create a JSON key for the service account, save it as `vertex-tester.json` at the repo root.
4. Set `GOOGLE_APPLICATION_CREDENTIALS=./vertex-tester.json` in your env.
5. Set `GCP_PROJECT_ID` to your project ID.

The SDK uses `gemini-2.5-pro` for text/vision analysis and `gemini-3-pro-image-preview` (Nano Banana Pro) for image generation. The latter currently only serves from the `global` location regardless of `GCP_LOCATION` — that's hardcoded in the SDK and you don't have to configure anything.

---

## Environment variables

Copy `service/.env.example` to `.env.local` (or your runtime equivalent) and fill in the required vars. Full reference:

| Var | Required | Default | Notes |
|---|---|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | ✓ | — | Path to Vertex AI service account JSON |
| `GCP_PROJECT_ID` | ✓ | — | Your GCP project ID |
| `GCP_LOCATION` | | `us-central1` | Vertex region for Gemini text calls (Nano Banana Pro is hardcoded to `global`) |
| `KIE_API_KEY` | ✓ | — | kie.ai API key |
| `KIE_API_BASE` | | `https://api.kie.ai` | |
| `KIE_MODEL_ID` | | `bytedance/seedance-2` | |
| `KIE_RESOLUTION` | | `720p` | `480p` / `720p` / `1080p` |
| `KIE_VIDEO_STRATEGY` | | `multishot_single_call` | `multishot_single_call` (cheap, default) / `per_shot_conform` (one kie.ai call per look) |
| `BLOB_READ_WRITE_TOKEN` | ✓ | — | Vercel Blob token; kie.ai fetches keyframes from Blob URLs |
| `VERCEL_DEPLOYMENT_URL` | ✓ | `https://ai-campaign-video.vercel.app` | Public deployment that serves `public/templates/*` and `public/products/*` |
| `MOTION_REFERENCE_URL_OVERRIDE` | | — | Override the template video URL with a Blob URL (use when the template isn't deployed yet) |
| `PRODUCT_URL_OVERRIDES` | | — | JSON `{ "product_id": "blob_url" }` for products not yet deployed |
| `VIDEO_PROVIDER` | | `kie_seedance` | `kie_seedance` / `seedance` / `kling` |
| `SEEDANCE_API_KEY` | only if `VIDEO_PROVIDER=seedance` | — | Direct BytePlus Ark fallback |
| `KLING_ACCESS_KEY` / `KLING_SECRET_KEY` | only if `VIDEO_PROVIDER=kling` | — | Kling fallback |
| `SKIP_KLING` | | `false` | When `true`, stops after keyframe generation (skips video calls + concat) |

---

## Directory layout (REQUIRED)

The SDK currently reads templates and products from a fixed directory layout, and writes per-run artifacts to another. Your backend must adopt this layout (or copy the files into it before calling the SDK):

```
public/
├── creators/                          # reference face images (any name)
│   ├── creator-1.jpeg
│   └── creator-2.jpg
├── products/                          # one folder per product
│   └── black-top/
│       ├── image.png                  # PRIMARY product image (PNG required)
│       └── metadata.json              # Gemini-generated, see analyzeProduct()
└── templates/                         # one folder per template
    └── template-2/
        ├── video.mp4
        ├── first_frame.png            # extracted by extractFirstFrame()
        ├── metadata.json              # Gemini-generated + outfit_segments[] declared by you
        └── segment-{0,1,2,3}.mp4      # legacy 4-slice for Kling motion-control fallback (auto-generated)

# At runtime, the SDK writes per-run output to:
public/runs/<run_id>/
    ├── master-subject.png             # canonical creator anchor
    ├── keyframe-{0,1,2}.png           # per-look keyframes
    ├── keyframe-N-absent-shotM.png    # per-shot product-only keyframes (ad templates)
    ├── clip-{0,1,2}.mp4               # raw kie.ai clips (per_shot_conform mode only)
    ├── kie-multishot-raw.mp4          # raw multishot clip
    ├── kie-multishot-conformed.mp4    # speed-conformed to template duration
    └── output.mp4                     # FINAL — what your client downloads
```

> **Heads up:** these paths are hardcoded in `src/lib/pipeline/orchestrator.ts`. Making them configurable is a follow-up refactor (~half a day) — flag this if you need it.

---

## Quickstart

```bash
# 1. Install dependencies (from the repo root, not service/).
npm install

# 2. Copy env template and fill in values.
cp service/.env.example .env.local

# 3. Make sure ffmpeg is on PATH.
ffmpeg -version

# 4. Ingest a product (writes public/products/black-top/{image.png, metadata.json}).
npx tsx service/examples/ingest-product.ts black-top ./incoming/black-top.png

# 5. Ingest a template (writes public/templates/template-X/{video.mp4, first_frame.png, metadata.json}).
#    Then manually edit metadata.json to add outfit_segments[] — see "Outfit segmentation" below.
npx tsx service/examples/ingest-template.ts template-9 ./incoming/montage.mp4

# 6. Drop a creator photo into public/creators/.

# 7. Generate a video.
npx tsx service/examples/generate-video.ts
```

---

## Public API

All exports come from `service/index.ts`. Import shape:

```ts
import {
  runPipeline,
  createRun,
  getRun,
  updateRun,
  analyzeReferenceFace,
  analyzeProduct,
  analyzeTemplateVideo,
  compositeKeyframe,
  compositeProductOnlyKeyframe,
  extractFirstFrame,
  extractFrameAtTime,
  type Look,
  type RunState,
  type TemplateMetadata,
  type ProductMetadata,
  type OutfitSegment,
  type SubjectState,
} from "./service";
```

### Run lifecycle

```ts
// Initialize a run (in-memory, returns immediately).
const run = createRun({
  template_id: "template-2",
  looks: [
    { product_ids: ["black-top", "skirt", "black-boots"] },
    { product_ids: ["blue-tshirt", "baggy-jeans", "sneakers", "purse"] },
  ],
  reference_face_path: "public/creators/creator-1.jpeg",
});
// → { run_id: "run_abc...", status: "analyzing_face", ... }

// Run the full pipeline (long-running; await or fire-and-forget).
const final = await runPipeline(run.run_id, {
  referenceFaceBytes: readFileSync(facePath),
  referenceFaceMimeType: "image/jpeg",
});

// Poll status from another request handler.
const state = getRun(run.run_id);
// → { status: "succeeded", video_url: "/runs/<run_id>/output.mp4", ... }
```

The run-store is an **in-memory Map keyed on run_id**, persisted across HMR via `globalThis`. For a production backend with multiple processes you'll want to swap this for Redis/Postgres/etc. — see [Limitations](#limitations).

### Ingestion

```ts
// Product
const productMeta = await analyzeProduct({
  imageBytes: readFileSync("./black-top.png"),
  mimeType: "image/png",
});
// → { primary_item_type, items[], overall_description, key_features[] }

// Template
const templateMeta = await analyzeTemplateVideo({
  videoBytes: readFileSync("./montage.mp4"),
  mimeType: "video/mp4",
});
// → { scene_description, motion_script[], style, pose_archetypes, shot_backgrounds[], ... }
// Note: outfit_segments[] is NOT auto-generated — you declare it manually based
// on the template's structure. See "Outfit segmentation" below.
```

### Image generation primitives

```ts
// Composite a wearing keyframe (creator + outfit on a scene background).
const keyframe = await compositeKeyframe({
  keyframePrompt: "...",
  templateFirstFrame: { bytes, mimeType: "image/png" },
  referenceFace: { bytes: faceBytes, mimeType: "image/jpeg" },
  masterSubject: { bytes: masterBytes, mimeType: "image/png" },
  products: [{ bytes: topBytes, mimeType: "image/png", description: "black ribbed-knit top" }],
  framingScope: "full_body", // "full_body" | "three_quarter" | "chest_up"
  backgroundDescription: "graffiti wall",
});

// Composite a product-only hero shot (no person — used for ad-style templates).
const heroFrame = await compositeProductOnlyKeyframe({
  templateFirstFrame: { bytes, mimeType: "image/png" },
  products: [{ bytes: bottleBytes, mimeType: "image/png", description: "blue glass perfume bottle" }],
  shotDescription: "perfume bottle resting on a bed of ice",
  backgroundDescription: "bed of ice cubes on light blue surface",
});
```

### Video generation

```ts
// Recommended path — kie.ai/Seedance. Either single-keyframe (per_shot_conform)
// or multi-keyframe (multishot_single_call). The orchestrator picks based on
// KIE_VIDEO_STRATEGY env.

import { generateMultiShotViaKieSeedance } from "./service";

const result = await generateMultiShotViaKieSeedance({
  keyframeUrls: [/* HTTPS Blob URLs for each keyframe */],
  motionReferenceUrl: "https://your-cdn.com/templates/.../video.mp4",
  motionPrompt: "subject changes outfits across the shots — match the reference video's shot structure exactly...",
  durationSeconds: 9,        // 4-15 integer
  aspectRatio: "9:16",
  resolution: "720p",
});
// → { videoBytes: Buffer, videoUrl: string }
```

### ffmpeg utilities

```ts
import { concatClips, extractFirstFrame, extractFrameAtTime } from "./service";

// Extract the very first frame of a video.
await extractFirstFrame("./video.mp4", "./first_frame.png");

// Extract a frame at a specific timestamp (e.g., for a wearing-shot scene reference).
await extractFrameAtTime("./video.mp4", 2.5, "./shot2_frame.png");

// Concat multiple mp4 clips into one with normalized streams + audio mux.
await concatClips(
  ["./clip-0.mp4", "./clip-1.mp4", "./clip-2.mp4"],
  "./output.mp4",
  "./template-audio-source.mp4", // optional — audio is muxed from this video
);
```

---

## Outfit segmentation

`outfit_segments[]` is the most important manual step in template ingestion. It tells the orchestrator how many "outfit slots" the template has and which `motion_script` entries belong to each slot. It's **not auto-generated** by Gemini — you have to look at the template video and declare the slots yourself.

### Schema

```ts
type OutfitSegment = {
  t_start: number;            // seconds
  t_end: number;              // seconds
  shot_indices: number[];     // motion_script entry indices that this slot covers
  subject_states?: {          // OPTIONAL — for ad-style templates with product-only shots
    shot_indices: number[];
    state: "wearing" | "absent";
  }[];
};
```

### Patterns

**Pattern 1 — Single-outfit template (model walk, product review, etc.):**
```json
"outfit_segments": [
  { "t_start": 0, "t_end": 9.5, "shot_indices": [0, 1, 2] }
]
```
The user picks 1 outfit. The pipeline generates 1 wearing keyframe and uses it across all shots.

**Pattern 2 — Multi-outfit lookbook / try-on:**
```json
"outfit_segments": [
  { "t_start": 0,   "t_end": 1.5, "shot_indices": [0] },
  { "t_start": 1.5, "t_end": 3.8, "shot_indices": [1] },
  { "t_start": 3.8, "t_end": 9.1, "shot_indices": [2, 3] }
]
```
The user picks N outfits, one per slot. The pipeline generates N wearing keyframes; kie.ai distributes them across the perceived shots in the reference video.

**Pattern 3 — Ad-style with product-only hero shots:**
```json
"outfit_segments": [
  {
    "t_start": 0, "t_end": 11.9,
    "shot_indices": [0, 1, 2, 3, 4],
    "subject_states": [
      { "shot_indices": [0, 1, 3, 4], "state": "absent"  },
      { "shot_indices": [2],          "state": "wearing" }
    ]
  }
]
```
"absent" shots get product-only keyframes (no person rendered); "wearing" shots get the standard wearing keyframe. One product-only keyframe is generated per absent motion_script entry, each in that shot's specific scene background.

---

## Common gotchas

| Symptom | Cause | Fix |
|---|---|---|
| kie.ai returns "Credits insufficient" | Account balance depleted | Top up at api.kie.ai |
| kie.ai returns "input image may be related to copyright restrictions" | Celebrity face filter | Use a non-celebrity reference photo (stock, AI-generated, consenting individuals) |
| kie.ai task stays in `state=waiting` for full poll budget | Asset 404 (template video or product image not deployed) | Verify `${VERCEL_DEPLOYMENT_URL}/templates/.../video.mp4` returns 200, or set `MOTION_REFERENCE_URL_OVERRIDE` to a Blob URL |
| Output duration doesn't match template (~13s when template was 9s) | per_shot_conform sums clip durations × kie.ai 4s minimum | Switch to `KIE_VIDEO_STRATEGY=multishot_single_call` (default) |
| Master subject's white-tee + jeans bleeds into a shot | Identity refs sent as loose images | Already fixed in current SDK — keyframes carry identity; loose refs are dropped |
| Output is silent | Source template has no audio track | Expected — verify with `ffprobe` |
| Master subject looks slim / idealized | Old Imagen-based path | Already fixed — SDK uses Nano Banana Pro now |

---

## Limitations

1. **Hardcoded paths.** `public/templates/*`, `public/products/*`, `public/runs/*` are baked into the orchestrator. If your backend wants to store assets elsewhere, you'd need to either replicate the layout or refactor (~half a day to extract a config object).
2. **In-memory run-store.** The run state lives in a `Map` on `globalThis`. Single-process only. For a multi-process backend you need to swap this for Redis/Postgres/etc.
3. **No built-in auth, rate limiting, or quotas.** This is a library, not a service — wire those in your own API layer.
4. **kie.ai content filters** reject celebrity faces and (sometimes) recognizable product silhouettes. Your end users need to upload non-celebrity reference photos and avoid branded products.
5. **Outfit segmentation requires manual declaration.** Gemini doesn't infer outfit slots reliably; the human integrating the template has to inspect the video and declare `outfit_segments[]`.
6. **kie.ai integer durations 4–15s.** Sub-4s shots get clamped (the orchestrator handles this via speed-conform in `per_shot_conform` mode, or full-template duration in `multishot_single_call`).

---

## Cost guide (rough)

Per generation run:
- Vertex AI Gemini text/vision calls (template / product / face analysis + per-look orchestration + judge): ~$0.05–0.15
- Vertex AI Nano Banana Pro keyframes: ~$0.02 per keyframe (1 master + N looks + M absent shots)
- kie.ai video generation: **~$0.40 per video** (regardless of duration in the 4–15s range)
- Vercel Blob storage: negligible (~MB-scale uploads)

A typical multi-outfit run on `multishot_single_call`: ~**$0.50–$0.60 total**. Per-shot mode triples the kie.ai cost.

---

## Asking for help

The internal source lives at `src/lib/pipeline/*`. The most useful files when debugging:
- `orchestrator.ts` — the conductor. Most "why did the pipeline do X" questions resolve here.
- `keyframe.ts` — Nano Banana Pro keyframe generation prompt + call.
- `kie-seedance.ts` — kie.ai HTTP client.
- `concat.ts` — ffmpeg concat + audio mux.
- `types.ts` — canonical type definitions.

Logs are verbose by default — every stage prints what it's doing with a `[component]` prefix. When something goes wrong, grep the run log for `Error:` / `FAIL:` / `failMsg=`.
