/**
 * API Route: Virtual Try-On / Product Placement
 * 
 * POST /api/virtual-tryon
 * Body: { 
 *   productImage: { base64: string, mimeType: string },
 *   creatorImage: { base64: string, mimeType: string },
 *   options?: { setting?: string, mood?: string, cameraAngle?: string }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateVirtualTryOn } from '@/lib/genai-client';

export const maxDuration = 60; // Allow up to 60 seconds for image generation

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { productImage, creatorImage, options } = body;

    // Validate inputs
    if (!productImage?.base64 || !productImage?.mimeType) {
      return NextResponse.json(
        { error: 'Missing product image' },
        { status: 400 }
      );
    }

    if (!creatorImage?.base64 || !creatorImage?.mimeType) {
      return NextResponse.json(
        { error: 'Missing creator/reference image' },
        { status: 400 }
      );
    }

    // Generate the try-on image using new Gen AI SDK
    const result = await generateVirtualTryOn({
      productImage,
      creatorImage,
      options,
    });

    if (result.success) {
      return NextResponse.json({
        success: true,
        image: result.imageBase64 ? {
          base64: result.imageBase64,
          mimeType: result.imageMimeType,
        } : undefined,
        analysis: {
          product: result.productAnalysis,
          creator: result.creatorAnalysis,
        },
        // Format prompt as expected by frontend
        prompt: {
          mainPrompt: result.prompt || '',
          negativePrompt: '',
          styleGuide: '',
        },
        error: result.error,
      });
    } else {
      return NextResponse.json({
        success: false,
        error: result.error,
        analysis: {
          product: result.productAnalysis,
          creator: result.creatorAnalysis,
        },
        prompt: {
          mainPrompt: result.prompt || '',
          negativePrompt: '',
          styleGuide: '',
        },
      });
    }

  } catch (error) {
    console.error('Virtual try-on error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate try-on image' 
      },
      { status: 500 }
    );
  }
}

// GET endpoint to analyze images separately (useful for preview)
export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: 'Virtual Try-On API',
    endpoints: {
      'POST /api/virtual-tryon': 'Generate try-on image',
      'POST /api/virtual-tryon/analyze-product': 'Analyze product only',
      'POST /api/virtual-tryon/analyze-creator': 'Analyze creator only',
    },
    supportedProducts: [
      'Watches', 'Shirts', 'T-shirts', 'Hoodies', 'Jackets',
      'Sunglasses', 'Glasses', 'Sneakers', 'Shoes',
      'Bags', 'Handbags', 'Necklaces', 'Hats', 'Caps',
    ],
    options: {
      setting: ['studio', 'outdoor', 'urban', 'nature', 'keep original'],
      mood: ['professional', 'casual', 'energetic', 'elegant'],
      cameraAngle: ['front', 'three-quarter', 'side'],
    },
  });
}
