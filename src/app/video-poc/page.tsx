// src/app/video-poc/page.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronUp,
  ChevronDown,
  Pencil,
  X,
  Plus,
  Sparkles,
  Upload,
  Download,
} from "lucide-react";
import { type CatalogProduct } from "@/components/ProductPicker";

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
    | "concatenating"
    | "succeeded"
    | "failed";
  progress_label: string;
  current_look_index?: number;
  total_looks?: number;
  per_look_keyframe_urls?: string[];
  per_look_clip_urls?: string[];
  video_url?: string;
  error?: string;
};

type LookDraft = { product_ids: string[] };

const PIPELINE_PHASES = [
  { key: "analyzing_face", label: "Reading Face" },
  { key: "orchestrating", label: "Composing" },
  { key: "generating_video", label: "Rendering" },
  { key: "concatenating", label: "Stitching" },
];

function StepBadge({ n }: { n: number }) {
  return (
    <div className="w-7 h-7 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center text-sm font-medium shrink-0">
      {n}
    </div>
  );
}

// ─── Inline catalog grid ──────────────────────────────────────────────────────
function CatalogGrid({
  products,
  selected,
  onToggle,
  isFull,
}: {
  products: CatalogProduct[];
  selected: string[];
  onToggle: (id: string) => void;
  isFull: boolean;
}) {
  const [search, setSearch] = useState("");
  const filtered = search
    ? products.filter(
        (p) =>
          p.primary_item_type.toLowerCase().includes(search.toLowerCase()) ||
          p.overall_description.toLowerCase().includes(search.toLowerCase())
      )
    : products;

  return (
    <div className="flex flex-col gap-3 h-full">
      <input
        type="text"
        placeholder="Filter products…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 overflow-y-auto max-h-[520px] pr-1">
        {filtered.map((p) => {
          const isSelected = selected.includes(p.id);
          const isDisabled = isFull && !isSelected;
          const selIdx = selected.indexOf(p.id);
          return (
            <button
              key={p.id}
              type="button"
              disabled={isDisabled}
              onClick={() => onToggle(p.id)}
              title={p.overall_description}
              className={`relative rounded-xl border p-2 text-left transition-all group ${
                isSelected
                  ? "border-blue-500 ring-2 ring-blue-500/40 bg-zinc-800"
                  : isDisabled
                    ? "border-zinc-800 opacity-40 cursor-not-allowed bg-zinc-900"
                    : "border-zinc-800 hover:border-zinc-600 bg-zinc-900 hover:bg-zinc-800"
              }`}
            >
              <img
                src={p.image_url}
                alt={p.primary_item_type}
                className="w-full aspect-square object-cover rounded-lg"
              />
              <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-100">
                {p.primary_item_type}
              </div>
              <div className="text-xs text-zinc-400 line-clamp-1 mt-0.5">
                {p.overall_description}
              </div>
              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute top-1.5 right-1.5 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold"
                >
                  {selIdx + 1}
                </motion.div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Face dropzone ────────────────────────────────────────────────────────────
function FaceDropzone({
  faceFile,
  onFile,
  onRemove,
}: {
  faceFile: File | null;
  onFile: (f: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!faceFile) { setPreview(null); return; }
    const url = URL.createObjectURL(faceFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [faceFile]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) onFile(file);
  }

  if (faceFile && preview) {
    return (
      <div className="flex items-center gap-4">
        <img
          src={preview}
          alt="reference face"
          className="w-20 h-20 object-cover rounded-xl border border-zinc-700"
        />
        <div>
          <p className="text-sm text-zinc-100 font-medium">{faceFile.name}</p>
          <button
            type="button"
            onClick={onRemove}
            className="mt-1 text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-10 cursor-pointer transition-colors ${
          dragging
            ? "border-blue-500 bg-blue-500/10"
            : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/50"
        }`}
      >
        <Upload className="w-8 h-8 text-zinc-500" />
        <div className="text-center">
          <p className="text-zinc-300 text-sm font-medium">
            Drag a selfie here, or click to browse
          </p>
          <p className="text-zinc-500 text-xs mt-1">PNG or JPEG</p>
        </div>
      </div>
    </>
  );
}

// ─── Progress stepper ────────────────────────────────────────────────────────
function ProgressStepper({ run }: { run: RunStatusResponse }) {
  const currentPhaseIndex = PIPELINE_PHASES.findIndex(
    (p) => p.key === run.status
  );
  const isDone = run.status === "succeeded";
  const isFailed = run.status === "failed";

  return (
    <div className="flex items-start gap-0">
      {PIPELINE_PHASES.map((phase, i) => {
        const isActive = phase.key === run.status;
        const isPast =
          isDone ||
          (currentPhaseIndex > i && currentPhaseIndex !== -1);
        const isLast = i === PIPELINE_PHASES.length - 1;

        return (
          <div key={phase.key} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                  isPast
                    ? "bg-blue-500 text-white"
                    : isActive
                      ? "bg-blue-500/30 text-blue-300 ring-2 ring-blue-500"
                      : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {isPast ? "✓" : i + 1}
              </div>
              <span
                className={`text-xs text-center whitespace-nowrap ${
                  isActive ? "text-blue-300" : isPast ? "text-zinc-400" : "text-zinc-600"
                }`}
              >
                {phase.label}
              </span>
              {isActive && (
                <span className="text-xs text-zinc-500 text-center max-w-[100px] leading-tight">
                  {run.progress_label}
                </span>
              )}
            </div>
            {!isLast && (
              <div
                className={`h-px flex-1 mb-6 transition-all ${
                  isPast ? "bg-blue-500" : "bg-zinc-700"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function VideoPocPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [looks, setLooks] = useState<LookDraft[]>([]);
  const [activeLookIndex, setActiveLookIndex] = useState<number>(0);
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunStatusResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Fetch catalog + auto-open first look
  useEffect(() => {
    fetch("/api/video-poc/catalog")
      .then((r) => r.json())
      .then((data) => {
        setTemplates(data.templates);
        setProducts(data.products);
        setLooks((prev) => {
          if (prev.length === 0) {
            setActiveLookIndex(0);
            return [{ product_ids: [] }];
          }
          return prev;
        });
      });
  }, []);

  // Poll run status
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

  function toggleProductInActiveLook(product_id: string) {
    setLooks((prev) =>
      prev.map((l, i) => {
        if (i !== activeLookIndex) return l;
        if (l.product_ids.includes(product_id)) {
          return { product_ids: l.product_ids.filter((x) => x !== product_id) };
        }
        if (l.product_ids.length >= 4) return l;
        return { product_ids: [...l.product_ids, product_id] };
      })
    );
  }

  function addLook() {
    if (looks.length >= 4) return;
    setLooks((prev) => [...prev, { product_ids: [] }]);
    setActiveLookIndex(looks.length);
  }

  function removeLook(i: number) {
    setLooks((prev) => {
      const next = prev.filter((_, x) => x !== i);
      return next;
    });
    setActiveLookIndex((prev) => {
      if (i < prev) return prev - 1;
      if (i === prev) return Math.max(0, i - 1);
      return prev;
    });
  }

  function moveLookUp(i: number) {
    if (i === 0) return;
    setLooks((prev) => {
      const next = [...prev];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
    if (activeLookIndex === i) setActiveLookIndex(i - 1);
    else if (activeLookIndex === i - 1) setActiveLookIndex(i);
  }

  function moveLookDown(i: number) {
    if (i === looks.length - 1) return;
    setLooks((prev) => {
      const next = [...prev];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      return next;
    });
    if (activeLookIndex === i) setActiveLookIndex(i + 1);
    else if (activeLookIndex === i + 1) setActiveLookIndex(i);
  }

  const activeLook = looks[activeLookIndex];
  const activeLookFull = (activeLook?.product_ids.length ?? 0) >= 4;

  const canGenerate =
    !!templateId &&
    looks.length >= 1 &&
    looks.every((l) => l.product_ids.length >= 1) &&
    !!faceFile &&
    !submitting &&
    !runId;

  const cost = (looks.length * 0.4).toFixed(2);
  const duration = looks.length * 5;
  const plural = looks.length === 1 ? "" : "s";

  async function handleGenerate() {
    if (!templateId || !faceFile) return;
    setSubmitting(true);
    try {
      const reader = new FileReader();
      const base64: string = await new Promise((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(faceFile);
      });
      const res = await fetch("/api/video-poc/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: templateId, looks, reference_face_base64: base64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "submit failed");
      setRunId(data.run_id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`Failed to start: ${message}`);
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
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">

        {/* Header */}
        <header className="space-y-1">
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-100">
            AI Campaign Video
          </h1>
          <p className="text-zinc-400 text-lg">
            Build outfit looks, upload a face, and generate a fashion video in seconds.
          </p>
        </header>

        {/* Step 1 — Template */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <StepBadge n={1} />
            <h2 className="text-lg font-semibold text-zinc-100">Choose a Template</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {templates.map((t) => {
              const isSelected = templateId === t.id;
              return (
                <div
                  key={t.id}
                  className={`rounded-xl border-2 p-2 transition-all ${
                    isSelected
                      ? "border-blue-500 ring-2 ring-blue-500/30"
                      : "border-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  {/* Preview video — uses native HTML5 controls. Click play to preview. */}
                  <video
                    src={t.video_url}
                    poster={t.first_frame_url}
                    controls
                    preload="metadata"
                    playsInline
                    className="w-full aspect-[9/16] object-cover rounded-lg bg-black"
                  />
                  {/* Explicit Select button — separate from video controls so they don't fight */}
                  <button
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={`mt-2 w-full text-sm font-medium px-3 py-2 rounded-md transition ${
                      isSelected
                        ? "bg-blue-500 text-white"
                        : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }`}
                  >
                    {isSelected ? `✓ ${t.id} selected` : `Select ${t.id}`}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Step 2 — Looks + Catalog (two columns) */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <StepBadge n={2} />
            <h2 className="text-lg font-semibold text-zinc-100">Build Looks</h2>
            <span className="text-sm text-zinc-500">1–4 shots · up to 4 items each</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
            {/* Left: looks list */}
            <div className="space-y-3">
              <AnimatePresence initial={false}>
                {looks.map((look, i) => {
                  const isActive = i === activeLookIndex;
                  return (
                    <motion.div
                      key={i}
                      layout
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.18 }}
                      className={`rounded-xl border p-3 transition-all ${
                        isActive
                          ? "border-blue-500/50 ring-2 ring-blue-500/20 bg-zinc-900"
                          : "border-zinc-800 bg-zinc-900/50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {/* Order controls */}
                        <div className="flex flex-col gap-0.5">
                          <button
                            type="button"
                            disabled={i === 0}
                            onClick={() => moveLookUp(i)}
                            className="p-1 rounded hover:bg-zinc-700 disabled:opacity-30 transition-colors"
                          >
                            <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                          </button>
                          <button
                            type="button"
                            disabled={i === looks.length - 1}
                            onClick={() => moveLookDown(i)}
                            className="p-1 rounded hover:bg-zinc-700 disabled:opacity-30 transition-colors"
                          >
                            <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                          </button>
                        </div>

                        {/* Look label */}
                        <span className="text-sm font-medium text-zinc-300 w-16 shrink-0">
                          Look {i + 1}
                        </span>

                        {/* Products thumbnails */}
                        <div className="flex gap-1.5 flex-1 flex-wrap min-h-[2.5rem] items-center">
                          {look.product_ids.length === 0 ? (
                            <span className="text-xs text-zinc-600 italic">
                              Select items from the catalog →
                            </span>
                          ) : (
                            look.product_ids.map((pid) => {
                              const p = products.find((x) => x.id === pid);
                              return p ? (
                                <motion.img
                                  key={pid}
                                  initial={{ scale: 0.8, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  transition={{ duration: 0.15 }}
                                  src={p.image_url}
                                  alt={p.primary_item_type}
                                  className="w-10 h-10 object-cover rounded-lg border border-zinc-700"
                                />
                              ) : null;
                            })
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setActiveLookIndex(i)}
                            title="Edit this look"
                            className={`p-1.5 rounded-lg transition-colors ${
                              isActive
                                ? "bg-blue-500/20 text-blue-300"
                                : "hover:bg-zinc-700 text-zinc-400"
                            }`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeLook(i)}
                            title="Remove look"
                            className="p-1.5 rounded-lg hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              <button
                type="button"
                disabled={looks.length >= 4}
                onClick={addLook}
                className="flex items-center gap-2 px-4 py-2.5 text-sm border-2 border-dashed border-zinc-700 rounded-xl text-zinc-500 hover:border-blue-500/50 hover:text-blue-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Look
              </button>
            </div>

            {/* Right: catalog (always visible) */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
                {activeLook
                  ? `Editing Look ${activeLookIndex + 1} · ${activeLook.product_ids.length}/4 items`
                  : "Catalog"}
              </p>
              {activeLook ? (
                <CatalogGrid
                  products={products}
                  selected={activeLook.product_ids}
                  onToggle={toggleProductInActiveLook}
                  isFull={activeLookFull}
                />
              ) : (
                <p className="text-zinc-600 text-sm">Add a look to start selecting items.</p>
              )}
            </div>
          </div>
        </section>

        {/* Step 3 — Face */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <StepBadge n={3} />
            <h2 className="text-lg font-semibold text-zinc-100">Reference Face</h2>
          </div>
          <div className="max-w-sm">
            <FaceDropzone
              faceFile={faceFile}
              onFile={setFaceFile}
              onRemove={() => setFaceFile(null)}
            />
          </div>
        </section>

        {/* Step 4 — Generate */}
        <section className="space-y-3 flex flex-col items-center text-center">
          <button
            type="button"
            disabled={!canGenerate}
            onClick={handleGenerate}
            className="flex items-center gap-2 px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold text-base disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-lg shadow-blue-500/10"
          >
            <Sparkles className="w-5 h-5" />
            {submitting ? "Starting…" : "Generate Video"}
          </button>
          {looks.length >= 1 && (
            <p className="text-zinc-500 text-sm">
              Generates {looks.length} shot{plural} (~{duration}s output) — ~${cost} per run
            </p>
          )}
        </section>

        {/* Step 5 — Progress + Result */}
        {run && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-zinc-800 rounded-xl bg-zinc-900 p-6 space-y-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-100">Progress</h2>
              <button
                type="button"
                onClick={reset}
                className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Start over
              </button>
            </div>

            <ProgressStepper run={run} />

            {/* Per-look keyframes */}
            {run.per_look_keyframe_urls &&
              run.per_look_keyframe_urls.length > 0 &&
              !run.video_url &&
              run.status !== "failed" && (
                <div>
                  <p className="text-xs text-zinc-500 mb-2 uppercase tracking-widest">
                    Identity locked — rendering motion…
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {run.per_look_keyframe_urls.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt={`keyframe look ${i + 1}`}
                        className="h-32 rounded-lg border border-zinc-700"
                      />
                    ))}
                  </div>
                </div>
              )}

            {/* Per-look clip previews */}
            {run.per_look_clip_urls &&
              run.per_look_clip_urls.length > 0 &&
              !run.video_url &&
              run.status !== "failed" && (
                <div>
                  <p className="text-xs text-zinc-500 mb-2 uppercase tracking-widest">
                    Per-shot previews ({run.per_look_clip_urls.length} of {run.total_looks ?? "?"})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {run.per_look_clip_urls.map((url, i) => (
                      <video
                        key={i}
                        src={url}
                        muted
                        autoPlay
                        loop
                        playsInline
                        className="h-32 rounded-lg border border-zinc-700"
                      />
                    ))}
                  </div>
                </div>
              )}

            {/* Final video */}
            {run.video_url && (
              <div className="flex flex-col items-center gap-3">
                <video
                  src={run.video_url}
                  controls
                  autoPlay
                  loop
                  className="max-w-md w-full rounded-2xl shadow-2xl shadow-black/60 border border-zinc-800"
                />
                <a
                  href={run.video_url}
                  download={`video-poc-${run.run_id}.mp4`}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition"
                >
                  <Download className="w-4 h-4" />
                  Download video
                </a>
              </div>
            )}

            {run.status === "failed" && (
              <p className="text-red-400 text-sm">Failed: {run.error}</p>
            )}
          </motion.section>
        )}
      </div>
    </main>
  );
}
