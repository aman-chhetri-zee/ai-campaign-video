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

export default function VideoPocPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [looks, setLooks] = useState<LookDraft[]>([]);
  const [editingLookIndex, setEditingLookIndex] = useState<number | null>(null);
  const [editorDraft, setEditorDraft] = useState<string[] | null>(null);
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
    !!templateId &&
    looks.length >= 1 &&
    looks.every((l) => l.product_ids.length >= 1) &&
    !!faceFile &&
    !submitting &&
    !runId &&
    editingLookIndex === null;

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
          looks,
          reference_face_base64: base64,
        }),
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

  function handleAddLook() {
    if (looks.length >= 4) return;
    setLooks((prev) => [...prev, { product_ids: [] }]);
    setEditingLookIndex(looks.length);
    setEditorDraft([]);
  }

  function handleEditLook(i: number) {
    setEditingLookIndex(i);
    setEditorDraft([...looks[i].product_ids]);
  }

  function handleSaveLook() {
    if (editingLookIndex === null || editorDraft === null) return;
    setLooks((prev) =>
      prev.map((l, i) =>
        i === editingLookIndex ? { product_ids: editorDraft } : l
      )
    );
    setEditingLookIndex(null);
    setEditorDraft(null);
  }

  function handleCancelLook() {
    if (
      editingLookIndex !== null &&
      editingLookIndex === looks.length - 1 &&
      looks[editingLookIndex].product_ids.length === 0
    ) {
      setLooks((prev) => prev.slice(0, -1));
    }
    setEditingLookIndex(null);
    setEditorDraft(null);
  }

  function handleRemoveLook(i: number) {
    if (editingLookIndex === i) {
      setEditingLookIndex(null);
      setEditorDraft(null);
    }
    setLooks((prev) => prev.filter((_, x) => x !== i));
  }

  function handleMoveLookUp(i: number) {
    if (i === 0) return;
    setLooks((prev) => {
      const next = [...prev];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
  }

  function handleMoveLookDown(i: number) {
    if (i === looks.length - 1) return;
    setLooks((prev) => {
      const next = [...prev];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      return next;
    });
  }

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-8">
      <header>
        <h1 className="text-3xl font-bold">AI Video POC</h1>
        <p className="text-gray-600">
          Pick a template, build up to 4 outfit looks, upload a reference face. Generate.
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

      {/* Step 2: Looks */}
      <section>
        <h2 className="text-xl font-semibold mb-2">
          2. Looks{" "}
          <span className="text-sm font-normal text-gray-500">
            (1-4 shots, each with 1-3 items)
          </span>
        </h2>

        <div className="space-y-3">
          {looks.map((look, i) => (
            <div key={i} className="border rounded-lg overflow-hidden">
              {/* Look row */}
              <div className="flex items-center gap-2 p-3 bg-white">
                <span className="font-medium text-sm">Look {i + 1}</span>

                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => handleMoveLookUp(i)}
                  className="px-2 py-1 text-xs border rounded disabled:opacity-40"
                >
                  Up
                </button>
                <button
                  type="button"
                  disabled={i === looks.length - 1}
                  onClick={() => handleMoveLookDown(i)}
                  className="px-2 py-1 text-xs border rounded disabled:opacity-40"
                >
                  Down
                </button>
                <button
                  type="button"
                  onClick={() => handleEditLook(i)}
                  className="px-2 py-1 text-xs border rounded hover:border-blue-400"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveLook(i)}
                  className="px-2 py-1 text-xs border border-red-200 rounded text-red-600 hover:border-red-400"
                >
                  x
                </button>

                <div className="flex gap-2 ml-2 flex-wrap">
                  {look.product_ids.length === 0 ? (
                    <span className="text-xs text-gray-400 italic">
                      (no items selected)
                    </span>
                  ) : (
                    look.product_ids.map((pid) => {
                      const p = products.find((x) => x.id === pid);
                      return p ? (
                        <img
                          key={pid}
                          src={p.image_url}
                          alt={p.primary_item_type}
                          className="w-10 h-10 object-cover rounded border"
                        />
                      ) : null;
                    })
                  )}
                </div>
              </div>

              {/* Inline editor */}
              {editingLookIndex === i && editorDraft !== null && (
                <div className="border-t bg-gray-50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">
                      Editing Look {i + 1}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={editorDraft.length === 0}
                        onClick={handleSaveLook}
                        className="px-3 py-1 text-sm bg-blue-600 text-white rounded disabled:opacity-40"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelLook}
                        className="px-3 py-1 text-sm border rounded text-gray-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <ProductPicker
                    products={products}
                    selected={editorDraft}
                    onChange={setEditorDraft}
                    max={3}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          disabled={looks.length >= 4}
          onClick={handleAddLook}
          className="mt-3 px-4 py-2 text-sm border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Add Look
        </button>
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
          {submitting ? "Starting..." : "Generate Video"}
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

          {run.per_look_keyframe_urls &&
            run.per_look_keyframe_urls.length > 0 &&
            !run.video_url &&
            run.status !== "failed" && (
              <div>
                <p className="text-xs text-gray-500 mb-1">
                  Identity locked, rendering motion...
                </p>
                <div className="flex flex-wrap gap-2">
                  {run.per_look_keyframe_urls.map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt={`keyframe look ${i + 1}`}
                      className="max-w-[8rem] rounded"
                    />
                  ))}
                </div>
              </div>
            )}

          {run.per_look_clip_urls &&
            run.per_look_clip_urls.length > 0 &&
            !run.video_url &&
            run.status !== "failed" && (
              <div>
                <p className="text-xs text-gray-500 mb-1">
                  Per-shot previews ({run.per_look_clip_urls.length} of{" "}
                  {run.total_looks ?? "?"})
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
                      className="max-w-[8rem] rounded"
                    />
                  ))}
                </div>
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
