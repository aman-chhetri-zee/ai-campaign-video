import { config } from "dotenv";
config({ path: ".env.local" });

const KIE_API_KEY = process.env.KIE_API_KEY!;
const KIE_API_BASE = process.env.KIE_API_BASE || "https://api.kie.ai";

async function main() {
  if (!KIE_API_KEY) {
    console.error("KIE_API_KEY missing from .env.local");
    process.exit(1);
  }

  // Use an existing public keyframe URL from a previous run as the seed image
  // (any HTTPS-accessible image will do).
  const seed =
    "https://yiuxtmedkwmtw0mt.public.blob.vercel-storage.com/products/oversized-tee/image-gQdo4W1UPLDsgwMPBhxs22wohTXRJN.png";

  const body = {
    model: "bytedance/seedance-2",
    input: {
      prompt: "credit check probe — minimal 4s clip",
      first_frame_url: seed,
      resolution: "480p",
      aspect_ratio: "9:16",
      duration: 4,
      generate_audio: false,
      nsfw_checker: false,
    },
  };

  console.log("submitting minimal kie.ai task to test credit availability...");
  const res = await fetch(`${KIE_API_BASE}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KIE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _rawText: text.slice(0, 500) };
  }

  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(json, null, 2));

  if (res.status !== 200 || !json?.data?.taskId) {
    if (JSON.stringify(json).toLowerCase().includes("credits insufficient")) {
      console.error("");
      console.error("VERDICT: kie.ai credits STILL DEPLETED — no charge to your account.");
      process.exit(2);
    }
    console.error("");
    console.error("VERDICT: submit failed for some other reason — see response above.");
    process.exit(1);
  }

  console.log("");
  console.log("VERDICT: kie.ai accepted the task — CREDITS ARE AVAILABLE.");
  console.log(`task ${json.data.taskId} is now running and will cost ~$0.40 once complete.`);
  console.log("you can let it finish in the background or ignore — kie.ai will produce a 4s clip we don't need.");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
