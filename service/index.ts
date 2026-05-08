// service/index.ts
//
// Public API surface for the AI Campaign Video pipeline.
// Backend integrators should import from "./service" — everything below is
// the supported public API. Anything else inside src/lib/pipeline/* is
// considered internal and may change without notice.

// ─── Run lifecycle (in-memory state store) ───────────────────────────────────
export {
  createRun,
  getRun,
  updateRun,
} from "../src/lib/pipeline/run-store";

// ─── End-to-end orchestration ────────────────────────────────────────────────
// runPipeline(run_id, { referenceFaceBytes, referenceFaceMimeType }) drives
// the full multi-stage flow: face analysis → master-subject generation →
// per-look keyframe(s) → kie.ai video → audio mux. Status is mirrored into
// the run-store, poll via getRun().
export { runPipeline } from "../src/lib/pipeline/orchestrator";

// ─── Stage-3 face analysis ───────────────────────────────────────────────────
export { analyzeReferenceFace } from "../src/lib/pipeline/face-analysis";

// ─── Stage-1 template analysis (Gemini reverse-engineers the metadata) ──────
export { analyzeTemplateVideo } from "../src/lib/pipeline/template-analysis";

// ─── Stage-2 product analysis (Gemini classifies + describes a product) ─────
export { analyzeProduct } from "../src/lib/pipeline/product-analysis";

// ─── Stage-3.5 master subject generation ─────────────────────────────────────
// Generates a canonical full-body image of the creator that anchors identity
// across per-look keyframes. Used internally by runPipeline; exposed for
// callers that want fine-grained control.
export { generateMasterSubjectReference } from "../src/lib/pipeline/master-subject";

// ─── Stage-5 keyframe compositing (Nano Banana Pro / gemini-3-pro-image) ────
export {
  compositeKeyframe,
  compositeProductOnlyKeyframe,
} from "../src/lib/pipeline/keyframe";

// ─── Stage-5b judge (Gemini visual QA on a generated keyframe) ──────────────
export { judgeKeyframe } from "../src/lib/pipeline/judge";

// ─── Stage-6 video generation providers ──────────────────────────────────────
export {
  generateViaKieSeedance,
  generateMultiShotViaKieSeedance,
} from "../src/lib/pipeline/kie-seedance";
export { generateMultiShotViaSeedance } from "../src/lib/pipeline/seedance";
export { generateVideoFromKeyframe } from "../src/lib/pipeline/kling";

// ─── Stage-7 ffmpeg utilities (concat, audio mux, frame extraction) ─────────
export { concatClips } from "../src/lib/pipeline/concat";
export { conformClipDuration } from "../src/lib/pipeline/clip-conform";
export {
  extractFirstFrame,
  extractFrameAtTime,
} from "../src/lib/pipeline/ffmpeg";

// ─── Helper utilities ────────────────────────────────────────────────────────
export { inferFramingScope, framingInstruction } from "../src/lib/pipeline/framing";
export { uploadToBlob } from "../src/lib/pipeline/upload";

// ─── Public types ────────────────────────────────────────────────────────────
export type * from "./types";
