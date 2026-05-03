// src/lib/pipeline/run-store.ts
import type { RunState, RunStatus, Look } from "./types";

// Pin the Map onto globalThis so it survives Next.js dev-mode HMR module
// re-evaluation. Without this, the POST /generate route stores a run in one
// Map instance and the GET /runs/:id route reads from a freshly-created Map,
// returning {error: "not found"} for every poll.
const globalForRuns = globalThis as unknown as {
  __video_poc_runs?: Map<string, RunState>;
};

const runs: Map<string, RunState> =
  globalForRuns.__video_poc_runs ?? new Map<string, RunState>();
if (!globalForRuns.__video_poc_runs) {
  globalForRuns.__video_poc_runs = runs;
}

export function createRun(input: {
  template_id: string;
  looks: Look[];
  reference_face_path: string;
}): RunState {
  const run_id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const state: RunState = {
    run_id,
    status: "analyzing_face",
    progress_label: "Reading reference identity…",
    template_id: input.template_id,
    looks: input.looks,
    reference_face_path: input.reference_face_path,
    total_looks: input.looks.length,
    current_look_index: 0,
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
  concatenating: "Stitching final video…",
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
