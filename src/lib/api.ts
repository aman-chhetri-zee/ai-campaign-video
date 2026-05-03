/**
 * API Integration Layer
 * 
 * Handles communication with:
 * - NanoBanana (Video Generation)
 * - Gemini (AI Processing)
 */

import { UploadResult, prepareForGemini } from './storage';

// ============================================
// TYPES
// ============================================

export interface GenerationRequest {
  productImage: UploadResult;
  referenceImage: UploadResult;
  templateId: string;
  options: {
    captionTone: string;
    mood: string;
  };
}

export interface GenerationResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  thumbnailUrl?: string;
  estimatedTime?: number;
  error?: string;
}

// ============================================
// GEMINI INTEGRATION (for image analysis/prompts)
// ============================================

export async function analyzeProductWithGemini(
  productImage: UploadResult,
  apiKey: string
): Promise<{ description: string; suggestedPrompt: string }> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: 'Analyze this product image and provide: 1) A brief description of the product, 2) A creative video script suggestion for a 15-second ad. Keep it engaging and modern.',
              },
              prepareForGemini(productImage),
            ],
          },
        ],
      }),
    }
  );

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  
  return {
    description: text,
    suggestedPrompt: text,
  };
}

// ============================================
// NANOBANANA / VIDEO GENERATION API
// ============================================

export async function generateVideo(
  request: GenerationRequest,
  apiKey: string
): Promise<GenerationResponse> {
  // TODO: Replace with actual NanoBanana API endpoint
  const API_ENDPOINT = process.env.NEXT_PUBLIC_NANOBANANA_API || 'https://api.nanobanana.ai/v1/generate';

  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      product_image: request.productImage.base64,
      reference_image: request.referenceImage.base64,
      template_id: request.templateId,
      caption_tone: request.options.captionTone,
      mood: request.options.mood,
      // Add more parameters as needed by the API
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Video generation failed');
  }

  return response.json();
}

// ============================================
// POLLING FOR VIDEO STATUS
// ============================================

export async function checkVideoStatus(
  jobId: string,
  apiKey: string
): Promise<GenerationResponse> {
  const API_ENDPOINT = process.env.NEXT_PUBLIC_NANOBANANA_API || 'https://api.nanobanana.ai/v1/status';

  const response = await fetch(`${API_ENDPOINT}/${jobId}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to check video status');
  }

  return response.json();
}

// ============================================
// MOCK API (for development without real API)
// ============================================

export async function mockGenerateVideo(
  request: GenerationRequest
): Promise<GenerationResponse> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1000));

  return {
    jobId: `mock_${Date.now()}`,
    status: 'queued',
    estimatedTime: 45, // seconds
  };
}

export async function mockCheckStatus(
  jobId: string,
  elapsedTime: number
): Promise<GenerationResponse> {
  // Simulate progression
  if (elapsedTime < 15) {
    return { jobId, status: 'queued', estimatedTime: 45 - elapsedTime };
  } else if (elapsedTime < 40) {
    return { jobId, status: 'processing', estimatedTime: 45 - elapsedTime };
  } else {
    return {
      jobId,
      status: 'completed',
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
      thumbnailUrl: 'https://via.placeholder.com/400x300',
    };
  }
}
