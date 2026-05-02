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
