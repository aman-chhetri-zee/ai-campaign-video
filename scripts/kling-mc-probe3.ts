/* eslint-disable */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createHmac } from 'node:crypto';

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

async function probe(label: string, endpoint: string, body: object) {
  console.log(`\n=== ${label} ===`);
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${buildJwt()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`  HTTP ${res.status}: ${text.slice(0, 400)}`);
}

async function main() {
  const base = {
    model_name: 'kling-v2-6',
    image_url: 'https://example.com/keyframe.png',
    video_url: 'https://example.com/video.mp4',
    mode: 'pro',
    prompt: 'test',
  };

  // Try character_orientation values
  for (const orientation of ['0', '1', 'front', 'image', 'character', 'horizontal', 'vertical']) {
    await probe(`character_orientation=${orientation}`, '/v1/videos/motion-control', {
      ...base,
      character_orientation: orientation,
    });
  }
}

main().catch(err => console.error(err.message));
