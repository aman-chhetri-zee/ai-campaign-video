// src/lib/pipeline/master-subject.ts
import { GoogleAuth } from "google-auth-library";
import type { FaceMetadata } from "./types";
import { withRetry } from "./retry";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "creatoreconomy-479409";
const LOCATION = process.env.GCP_LOCATION || "us-central1";
const TIMEOUT_MS = 120_000;

let _auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!_auth) {
    _auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  }
  return _auth;
}

async function getAccessToken(): Promise<string> {
  const auth = getAuth();
  const authClient = await auth.getClient();
  const tokenResponse = await authClient.getAccessToken();
  if (!tokenResponse.token) throw new Error("master-subject: failed to obtain access token");
  return tokenResponse.token;
}

/**
 * Generate a canonical full-body image of the creator using Imagen 3
 * Customization with REFERENCE_TYPE_SUBJECT. The output is an identity-locked
 * "master" image used as the face reference for every per-look keyframe — this
 * fixes cross-shot identity drift in the final multi-shot output.
 *
 * The generated image deliberately:
 *   - Shows the full body (head to feet) so leg-item looks have coverage
 *   - Wears neutral basic clothing (white tee, light jeans) — minimal so it
 *     doesn't bleed into per-look outfit rendering
 *   - Stands against a plain neutral backdrop — minimal scene noise
 *   - Has a neutral, frontal, natural pose
 */
export async function generateMasterSubjectReference(input: {
  faceImageBytes: Buffer;
  faceImageMimeType: string;
  faceMetadata: FaceMetadata;
}): Promise<{ imageBytes: Buffer; mimeType: string } | null> {
  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-3.0-capability-001:predict`;

  const fm = input.faceMetadata;
  const subjectDesc = [
    fm.perceived_gender,
    fm.age_range,
    `${fm.skin_tone} skin`,
    fm.hair,
    fm.distinctive_features,
    fm.ethnicity_cues,
  ]
    .filter(Boolean)
    .join(", ");

  const prompt = [
    "Generate a clean, full-body, head-to-toe vertical 9:16 portrait of Subject [1] (the specific person from the reference image).",
    "The person stands in a neutral frontal pose, arms relaxed at their sides, looking at camera, against a plain neutral light-grey backdrop with even soft studio lighting.",
    "They wear a simple plain white t-shirt and plain light-blue straight-cut jeans — minimal, basic, no patterns, no accessories, no jewelry.",
    "Render their face EXACTLY matching Subject [1] — same eyes, skin tone, hair, distinctive features. Identity preservation is the highest priority.",
    "The shot is wide enough to show the entire person from the very top of the head to below the feet — feet must be in the lower third of the frame.",
    "No text, no logos, no watermarks. Clean studio fashion-photography aesthetic.",
  ].join(" ");

  const body = {
    instances: [
      {
        prompt,
        referenceImages: [
          {
            referenceType: "REFERENCE_TYPE_SUBJECT",
            referenceId: 1,
            referenceImage: { bytesBase64Encoded: input.faceImageBytes.toString("base64") },
            subjectImageConfig: {
              subjectDescription: subjectDesc || "person from reference image",
              subjectType: "SUBJECT_TYPE_PERSON",
            },
          },
        ],
      },
    ],
    parameters: {
      sampleCount: 1,
      aspectRatio: "9:16",
      personGeneration: "allow_adult",
      safetySetting: "block_some",
    },
  };

  try {
    const token = await getAccessToken();
    const resp = await withRetry(
      async () => {
        const r = await Promise.race([
          fetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("master-subject HTTP timed out")), TIMEOUT_MS),
          ),
        ]);
        if (r.status >= 500 && r.status < 600) {
          throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        }
        return r;
      },
      { label: "master-subject" },
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(`[master-subject] HTTP ${resp.status}: ${errText.slice(0, 300)}`);
      return null;
    }

    const data = await resp.json();
    const b64 = data.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) {
      console.warn("[master-subject] no image in response");
      return null;
    }

    return {
      imageBytes: Buffer.from(b64, "base64"),
      mimeType: data.predictions[0].mimeType ?? "image/png",
    };
  } catch (err) {
    console.warn(`[master-subject] failed: ${(err as Error).message}`);
    return null;
  }
}
