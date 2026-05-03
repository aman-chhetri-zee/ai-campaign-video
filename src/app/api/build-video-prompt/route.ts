/**
 * API Route: Build Video Generation Prompt
 * 
 * POST /api/build-video-prompt
 * Body: VideoPromptInput
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildVideoGenerationPrompt, VideoPromptInput } from '@/lib/vertex-ai';

export async function POST(request: NextRequest) {
  try {
    const input = await request.json() as VideoPromptInput;

    if (!input.productAnalysis) {
      return NextResponse.json(
        { error: 'Missing product analysis' },
        { status: 400 }
      );
    }

    const videoPrompt = await buildVideoGenerationPrompt(input);

    return NextResponse.json({ videoPrompt });
  } catch (error) {
    console.error('Video prompt generation error:', error);
    return NextResponse.json(
      { error: 'Failed to build video prompt' },
      { status: 500 }
    );
  }
}
