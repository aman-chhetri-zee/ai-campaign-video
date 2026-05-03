/**
 * Vertex AI Integration
 * 
 * Uses Google Cloud Vertex AI with:
 * - Gemini 2.5 Pro (text generation)
 * - Nano Banana Pro / gemini-3-pro-image (image generation)
 * 
 * Setup:
 * 1. Place your vertex-tester.json in the project root (it's gitignored)
 * 2. Set GOOGLE_APPLICATION_CREDENTIALS env variable
 */

import { VertexAI } from '@google-cloud/vertexai';

// Configuration
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'creatoreconomy-479409';
const LOCATION = process.env.GCP_LOCATION || 'us-central1';

// Model IDs
export const MODELS = {
  GEMINI_TEXT: 'gemini-2.5-pro',
  NANO_BANANA_IMAGE: 'gemini-3-pro-image', // Nano Banana Pro
} as const;

// Initialize Vertex AI client
let vertexAI: VertexAI | null = null;

export function getVertexAI(): VertexAI {
  if (!vertexAI) {
    vertexAI = new VertexAI({
      project: PROJECT_ID,
      location: LOCATION,
    });
  }
  return vertexAI;
}

// ============================================
// GEMINI TEXT GENERATION
// ============================================

export interface TextGenerationOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

export async function generateText(
  prompt: string,
  options: TextGenerationOptions = {}
): Promise<string> {
  const vertex = getVertexAI();
  const model = vertex.getGenerativeModel({
    model: MODELS.GEMINI_TEXT,
    generationConfig: {
      maxOutputTokens: options.maxTokens || 1024,
      temperature: options.temperature || 0.7,
      topP: options.topP || 0.9,
    },
  });

  const result = await model.generateContent(prompt);
  const response = result.response;
  
  return response.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ============================================
// GEMINI WITH IMAGE INPUT (Vision)
// ============================================

export interface ImageAnalysisResult {
  description: string;
  productName: string;
  suggestedUSP: string;
  videoPrompt: string;
}

export async function analyzeProductImage(
  imageBase64: string,
  mimeType: string
): Promise<ImageAnalysisResult> {
  const vertex = getVertexAI();
  const model = vertex.getGenerativeModel({
    model: MODELS.GEMINI_TEXT,
  });

  const prompt = `Analyze this product image and provide a JSON response with:
{
  "description": "Brief product description",
  "productName": "Identified product name",
  "suggestedUSP": "A compelling 1-line USP for this product",
  "videoPrompt": "A creative 15-second video ad script/prompt for this product"
}

Be creative, engaging, and modern in tone. Only respond with valid JSON.`;

  const result = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              data: imageBase64,
              mimeType: mimeType,
            },
          },
        ],
      },
    ],
  });

  const response = result.response;
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  
  // Parse JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || [null, text];
  const jsonStr = jsonMatch[1] || text;
  
  try {
    return JSON.parse(jsonStr);
  } catch {
    return {
      description: text,
      productName: 'Unknown Product',
      suggestedUSP: '',
      videoPrompt: text,
    };
  }
}

// ============================================
// NANO BANANA PRO - IMAGE GENERATION
// ============================================

export interface ImageGenerationOptions {
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  numberOfImages?: number;
  negativePrompt?: string;
}

export interface GeneratedImage {
  base64: string;
  mimeType: string;
}

export async function generateImage(
  prompt: string,
  options: ImageGenerationOptions = {}
): Promise<GeneratedImage[]> {
  const vertex = getVertexAI();
  const model = vertex.getGenerativeModel({
    model: MODELS.NANO_BANANA_IMAGE,
  });

  // Build the generation prompt with style guidance
  const fullPrompt = options.negativePrompt 
    ? `${prompt}\n\nAvoid: ${options.negativePrompt}`
    : prompt;

  const result = await model.generateContent(fullPrompt);
  const response = result.response;
  
  const images: GeneratedImage[] = [];
  
  // Extract generated images from response
  const candidates = response.candidates || [];
  for (const candidate of candidates) {
    const parts = candidate.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData) {
        images.push({
          base64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || 'image/png',
        });
      }
    }
  }

  return images;
}

// ============================================
// VIDEO GENERATION PROMPT BUILDER
// ============================================

export interface VideoPromptInput {
  productAnalysis: ImageAnalysisResult;
  templateStyle: string;
  captionTone: string;
  mood: string;
  duration: string;
}

export async function buildVideoGenerationPrompt(
  input: VideoPromptInput
): Promise<string> {
  const prompt = `Create a detailed video generation prompt for an AI video model.

Product: ${input.productAnalysis.productName}
Description: ${input.productAnalysis.description}
USP: ${input.productAnalysis.suggestedUSP}

Video Requirements:
- Style: ${input.templateStyle}
- Tone: ${input.captionTone}
- Mood/Vibe: ${input.mood}
- Duration: ${input.duration}

Generate a comprehensive prompt that includes:
1. Scene descriptions with timing
2. Camera movements
3. Transitions
4. Text overlays/captions
5. Music/sound suggestions

Make it modern, engaging, and optimized for social media.`;

  return generateText(prompt, { maxTokens: 2048 });
}

// ============================================
// CREATIVE VARIATIONS
// ============================================

export async function generateCreativeVariations(
  basePrompt: string,
  count: number = 3
): Promise<string[]> {
  const prompt = `Given this video concept: "${basePrompt}"

Generate ${count} creative variations with different approaches:
1. Different visual styles
2. Different emotional hooks
3. Different storytelling angles

Format as JSON array of strings: ["variation1", "variation2", "variation3"]`;

  const result = await generateText(prompt);
  
  try {
    const jsonMatch = result.match(/\[[\s\S]*\]/) || ['[]'];
    return JSON.parse(jsonMatch[0]);
  } catch {
    return [basePrompt];
  }
}
