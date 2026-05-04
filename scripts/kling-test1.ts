/* eslint-disable */
// Run with: npx tsx --tsconfig scripts/tsconfig.test.json scripts/kling-test1.ts
import { config } from 'dotenv';
config({ path: '.env.local' });
process.env.KLING_MODEL_ID = 'kling-v1-5';

async function main() {
  const { generateVideoFromKeyframe } = await import('../src/lib/pipeline/kling');
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');

  const keyframe = readFileSync(resolve('test-fixtures/runs/template-1__product-1__face-A/keyframe.png'));
  const result = await generateVideoFromKeyframe({
    keyframeBytes: keyframe,
    keyframeMimeType: 'image/png',
    motionPrompt: 'Subject leans toward camera with a confident smolder, slight head tilt.',
    negativePrompt: 'blurry, distorted, deformed limbs',
    durationSeconds: 5,
    aspectRatio: '9:16',
    poseArchetype: 'confident',
  });
  writeFileSync('/tmp/kling-test-cam.mp4', result.videoBytes);
  console.log('TEST1 OK', result.videoBytes.length, 'bytes saved to /tmp/kling-test-cam.mp4');
}

main().catch((err) => {
  console.error('TEST1 FAILED:', err.message);
  process.exit(1);
});
