/**
 * API Route: Analyze Product Image
 * 
 * POST /api/analyze-product
 * Body: { imageBase64: string, mimeType: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { analyzeProductImage } from '@/lib/vertex-ai';

export async function POST(request: NextRequest) {
  try {
    const { imageBase64, mimeType } = await request.json();

    if (!imageBase64 || !mimeType) {
      return NextResponse.json(
        { error: 'Missing imageBase64 or mimeType' },
        { status: 400 }
      );
    }

    const analysis = await analyzeProductImage(imageBase64, mimeType);

    return NextResponse.json(analysis);
  } catch (error) {
    console.error('Product analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze product image' },
      { status: 500 }
    );
  }
}
