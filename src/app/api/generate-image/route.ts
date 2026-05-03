/**
 * API Route: Generate Image with Nano Banana Pro
 * 
 * POST /api/generate-image
 * Body: { prompt: string, options?: ImageGenerationOptions }
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateImage, ImageGenerationOptions } from '@/lib/vertex-ai';

export async function POST(request: NextRequest) {
  try {
    const { prompt, options } = await request.json() as {
      prompt: string;
      options?: ImageGenerationOptions;
    };

    if (!prompt) {
      return NextResponse.json(
        { error: 'Missing prompt' },
        { status: 400 }
      );
    }

    const images = await generateImage(prompt, options);

    return NextResponse.json({ images });
  } catch (error) {
    console.error('Image generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate image' },
      { status: 500 }
    );
  }
}
