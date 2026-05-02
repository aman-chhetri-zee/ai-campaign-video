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
            (pick 1-2, in order)
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

          {run.keyframe_url && !run.video_url && run.status !== "failed" && (
            <div>
              <p className="text-xs text-gray-500 mb-1">
                Identity locked, rendering motion...
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
