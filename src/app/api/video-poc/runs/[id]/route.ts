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
