/**
 * scripts/probe-seedance.ts
 *
 * Sends a minimal valid request to the Seedance / BytePlus Ark API to verify:
 *   1. Auth is accepted (key works)
 *   2. Endpoint is reachable
 *   3. Request body shape is correct (or get schema-hint errors from the API)
 *
 * Usage:
 *   npx tsx scripts/probe-seedance.ts
 *
 * Expected outcomes:
 *   HTTP 200  → task submitted, prints task_id
 *   HTTP 4xx  → prints error body (schema hints)
 *   Network error → endpoint/auth issue
 *
 * SECURITY: This script NEVER prints the full API key value.
 * It only logs the first 8 characters as a sanity prefix check.
 */

import { config } from "dotenv";
import { resolve } from "node:path";

// Load .env.local before anything else
config({ path: resolve(process.cwd(), ".env.local") });

const API_KEY = process.env.SEEDANCE_API_KEY ?? "";
// Fall back to defaults when the env vars are present but empty (as per .env.local setup)
const API_BASE =
  process.env.SEEDANCE_API_BASE ||
  "https://ark.ap-southeast.bytepluses.com";
// Confirmed model ID for BytePlus international endpoint
const MODEL_ID =
  process.env.SEEDANCE_MODEL_ID || "dreamina-seedance-2-0-260128";

if (!API_KEY) {
  console.error("[probe] ERROR: SEEDANCE_API_KEY is not set in .env.local");
  process.exit(1);
}

console.log(`[probe] API_BASE  : ${API_BASE}`);
console.log(`[probe] MODEL_ID  : ${MODEL_ID}`);
// Log only the first 8 chars of the key — never the full value
console.log(`[probe] API_KEY   : ${API_KEY.slice(0, 8)}... (${API_KEY.length} chars total)`);
console.log("");

// Minimal image-to-video request body
// Using a small public HTTPS image so the API can validate the URL shape.
// This is intentionally minimal — we want schema-level errors if the body is wrong,
// not actual video generation (which would cost money and take 15+ min).
const body = {
  model: MODEL_ID,
  content: [
    {
      type: "text",
      text: "A fashion model walks confidently on a runway. Cinematic lighting.",
    },
    {
      type: "image_url",
      image_url: {
        // Tiny 1×1 public PNG — enough for the API to validate field names without
        // triggering a full generation. If the API refuses tiny images we'll get a
        // field-hint error, not a credit charge.
        url: "https://via.placeholder.com/64x64.png",
      },
    },
  ],
  ratio: "9:16",
  duration: 5,
  generate_audio: false,
  watermark: false,
};

const endpoint = `${API_BASE.replace(/\/$/, "")}/api/v3/contents/generations/tasks`;
console.log(`[probe] POST ${endpoint}`);
console.log("[probe] body:", JSON.stringify(body, null, 2));
console.log("");

async function probe() {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    console.error("[probe] NETWORK ERROR:", err.message ?? String(err));
    console.error("        Check that the endpoint domain is reachable and the API_BASE is correct.");
    process.exit(1);
  }

  const rawBody = await res.text();
  const truncated = rawBody.slice(0, 800);

  console.log(`[probe] HTTP STATUS: ${res.status} ${res.statusText}`);
  console.log(`[probe] RESPONSE BODY (first 800 chars):\n${truncated}`);
  console.log("");

  if (res.ok) {
    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      console.log("[probe] Response is not valid JSON.");
      return;
    }
    const taskId = parsed.id ?? parsed.task_id ?? parsed.data?.task_id;
    if (taskId) {
      console.log(`[probe] SUCCESS — task submitted. task_id: ${taskId}`);
      console.log("[probe] API shape confirmed: top-level 'id' field contains task ID.");
    } else {
      console.log("[probe] 200 OK but no task_id found. Full parsed:", JSON.stringify(parsed, null, 2).slice(0, 600));
    }
  } else if (res.status === 401 || res.status === 403) {
    console.error("[probe] AUTH FAILED — check SEEDANCE_API_KEY and that the key targets the correct endpoint (BytePlus international vs Volcengine China).");
  } else if (res.status === 400) {
    console.log("[probe] 400 Bad Request — API rejected our body shape. The error message above contains field name hints.");
    console.log("[probe] Update seedance.ts content array or body fields accordingly.");
  } else if (res.status === 404) {
    console.error("[probe] 404 — Endpoint path not found. Try /api/v3/contents/generations/tasks vs /v1/contents/generations/tasks.");
  } else {
    console.log(`[probe] Unexpected status ${res.status}. Review response body for clues.`);
  }
}

probe().catch((err) => {
  console.error("[probe] Unhandled error:", err);
  process.exit(1);
});
