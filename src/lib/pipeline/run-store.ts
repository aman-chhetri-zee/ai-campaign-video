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
