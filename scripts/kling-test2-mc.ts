/* eslint-disable */
// Test 2 — Motion Control product variants
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

function buildJwt(): string {
  const ACCESS_KEY = process.env.KLING_ACCESS_KEY ?? '';
  const SECRET_KEY = process.env.KLING_SECRET_KEY ?? '';
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: ACCESS_KEY, exp: now + 1800, nbf: now - 5 };
  const b64 = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const data = `${b64(header)}.${b64(payload)}`;
  const sig = createHmac('sha256', SECRET_KEY).update(data).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${data}.${sig}`;
}

const API_BASE = process.env.KLING_API_BASE ?? 'https://api.klingai.com';

async function fetchRaw(path: string, body: object): Promise<{ ok: boolean; status: number; text: string; json?: any }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${buildJwt()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, text, json };
}

async function pollTask(endpoint: string, taskId: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5_000));
    const res = await fetch(`${API_BASE}${endpoint}/${taskId}`, {
      headers: { Authorization: `Bearer ${buildJwt()}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    const status = data.data?.task_status ?? data.task_status;
    console.log(`  poll ${i+1}/60: status=${status}`);
    if (status === 'succeed' || status === 'succeeded') {
      return data.data?.task_result?.videos?.[0]?.url ?? data.task_result?.videos?.[0]?.url ?? '';
    }
    if (status === 'failed') {
      throw new Error(`Task failed: ${data.data?.task_status_msg ?? JSON.stringify(data).slice(0, 200)}`);
    }
  }
  throw new Error('Poll timeout');
}

const keyframe = readFileSync('/Users/vc.aman.chhetri/Desktop/Codes/ai-campaign-video/test-fixtures/runs/template-1__product-1__face-A/keyframe.png');
const refVideo = readFileSync('/Users/vc.aman.chhetri/Desktop/Codes/ai-campaign-video/public/templates/template-1/video.mp4');
const keyframeB64 = keyframe.toString('base64');
const refVideoB64 = refVideo.toString('base64');

console.log(`keyframe: ${keyframe.length} bytes, refVideo: ${refVideo.length} bytes`);

const variants = [
  {
    label: 'Variant 1: /v1/videos/motion-control, model=kling-v2-6',
    endpoint: '/v1/videos/motion-control',
    pollEndpoint: '/v1/videos/motion-control',
    body: {
      model_name: 'kling-v2-6',
      image: keyframeB64,
      video: refVideoB64,
      character_orientation: 'image',
      keep_audio: false,
      prompt: 'Character performs the motion shown in the reference video.',
      negative_prompt: 'blurry, distorted',
    },
  },
  {
    label: 'Variant 2: /v1/videos/motion-control, model=kling-v2-1-master',
    endpoint: '/v1/videos/motion-control',
    pollEndpoint: '/v1/videos/motion-control',
    body: {
      model_name: 'kling-v2-1-master',
      image: keyframeB64,
      video: refVideoB64,
      character_orientation: 'image',
      keep_audio: false,
      prompt: 'Character performs the motion shown in the reference video.',
      negative_prompt: 'blurry, distorted',
    },
  },
  {
    label: 'Variant 3: /v1/videos/multi-image2video, model=kling-v1-6',
    endpoint: '/v1/videos/multi-image2video',
    pollEndpoint: '/v1/videos/multi-image2video',
    body: {
      model_name: 'kling-v1-6',
      image: keyframeB64,
      video: refVideoB64,
      prompt: 'Character performs the motion shown in the reference video.',
      negative_prompt: 'blurry, distorted',
      duration: '5',
      aspect_ratio: '9:16',
    },
  },
];

async function main() {
  for (const variant of variants) {
    console.log(`\n=== ${variant.label} ===`);
    const result = await fetchRaw(variant.endpoint, variant.body);
    console.log(`  HTTP ${result.status}: ${result.text.slice(0, 400)}`);
    if (result.ok && result.json) {
      const taskId = result.json.data?.task_id ?? result.json.task_id;
      if (taskId) {
        console.log(`  Task submitted: ${taskId}. Polling...`);
        try {
          const videoUrl = await pollTask(variant.pollEndpoint, taskId);
          console.log(`  SUCCESS! videoUrl: ${videoUrl}`);
          if (videoUrl) {
            const videoRes = await fetch(videoUrl);
            const buf = Buffer.from(await videoRes.arrayBuffer());
            writeFileSync('/tmp/kling-test-mc.mp4', buf);
            console.log(`  Saved ${buf.length} bytes to /tmp/kling-test-mc.mp4`);
          }
          return; // success — stop trying variants
        } catch (pollErr) {
          console.error(`  Poll failed: ${(pollErr as Error).message}`);
        }
      }
    }
    // 4xx — capture error and try next variant (don't retry on 5xx)
    if (result.status >= 500) {
      console.log('  Server error (5xx) — stopping to avoid burning more credits');
      break;
    }
    console.log('  Moving to next variant...');
  }
}

main().catch(err => {
  console.error('Test 2 error:', err.message);
  process.exit(1);
});
