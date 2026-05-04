/* eslint-disable */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';

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

const TASK_ID = '879958587500535892';
const API_BASE = process.env.KLING_API_BASE ?? 'https://api.klingai.com';

async function poll() {
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 10_000)); // 10s intervals
    const res = await fetch(`${API_BASE}/v1/videos/image2video/${TASK_ID}`, {
      headers: { Authorization: `Bearer ${buildJwt()}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    const status = data.data?.task_status ?? data.task_status;
    console.log(`[${new Date().toISOString()}] poll ${i+1}/24: status=${status}`);

    if (status === 'succeed' || status === 'succeeded') {
      const videoUrl = data.data?.task_result?.videos?.[0]?.url ?? data.task_result?.videos?.[0]?.url;
      console.log('SUCCESS! videoUrl:', videoUrl);
      if (videoUrl) {
        const videoRes = await fetch(videoUrl);
        const buf = Buffer.from(await videoRes.arrayBuffer());
        writeFileSync('/tmp/kling-test-cam.mp4', buf);
        console.log('Saved', buf.length, 'bytes to /tmp/kling-test-cam.mp4');
      }
      return;
    }
    if (status === 'failed') {
      console.error('TASK FAILED:', JSON.stringify(data).slice(0, 500));
      return;
    }
  }
  console.log('Still processing after additional 4 minutes...');
}

poll().catch(err => console.error('Poll error:', err.message));
