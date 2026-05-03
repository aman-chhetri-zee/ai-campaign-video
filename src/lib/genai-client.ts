/**
 * Google Gen AI SDK Client
 * 
 * Using the new @google/genai SDK for:
 * - Gemini 2.5 Pro (text/vision analysis)
 * - Gemini 2.0 Flash (image generation with dual-image input)
 * 
 * Virtual try-on now uses BOTH product AND creator images
 * to ensure exact matching of both the product and the face.
 */

import { GoogleGenAI, Modality } from '@google/genai';
import { 
  generateWithImagen, 
  generateWithImagenAndReference, 
  generateVirtualTryOnImage,
  buildImagenPrompt,
  buildImagenPromptWithReference 
} from './imagen';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'creatoreconomy-479409';
const LOCATION = process.env.GCP_LOCATION || 'us-central1';

// Models
export const MODELS = {
  GEMINI_TEXT: 'gemini-2.5-pro',
  // Fallback Gemini models for image gen (if Imagen fails)
  IMAGE_GEN_FALLBACKS: [
    'gemini-2.0-flash-exp',
    'gemini-3-pro-image',
  ],
} as const;

// Initialize the Gen AI client with Vertex AI configuration
let genaiClient: GoogleGenAI | null = null;

export function getGenAIClient(): GoogleGenAI {
  if (!genaiClient) {
    // For Vertex AI, we need to use the vertexai option
    genaiClient = new GoogleGenAI({
      vertexai: true,
      project: PROJECT_ID,
      location: LOCATION,
    });
  }
  return genaiClient;
}

// ============================================
// TEXT/VISION ANALYSIS (Gemini 2.5 Pro)
// ============================================

export interface AnalysisResult {
  productType: string;
  productCategory: 'wearable' | 'holdable' | 'accessory';
  wearLocation: string;
  productDescription: string;
  colors: string[];
  style: string;
  material: string;
  brandVibe: string;
  keyFeatures: string[];
}

export interface CreatorResult {
  gender: string;
  ageRange: string;
  skinTone: string;
  hairStyle: string;
  hairColor: string;
  facialFeatures: string;
  bodyType: string;
  currentOutfit: string;
  pose: string;
  expression: string;
  background: string;
  lighting: string;
  photographyStyle: string;
}

export async function analyzeProductWithGenAI(
  imageBase64: string,
  mimeType: string
): Promise<AnalysisResult> {
  const client = getGenAIClient();
  
  const prompt = `You are an expert fashion and product analyst. Analyze this product image in detail.

Respond with ONLY a valid JSON object (no markdown, no code blocks):
{
  "productType": "specific product type (e.g., 'watch', 'camisole top', 'sunglasses')",
  "productCategory": "wearable" OR "holdable" OR "accessory",
  "wearLocation": "where it goes on body (e.g., 'wrist', 'torso', 'face', 'hand')",
  "productDescription": "extremely detailed description including fit, silhouette, and how it should look when worn. Include specific details that MUST be preserved when placing on a person.",
  "colors": ["primary color", "secondary colors if any"],
  "style": "style category (e.g., 'casual', 'formal', 'streetwear', 'vintage')",
  "material": "material type (e.g., 'leather', 'cotton', 'metal', 'jersey knit')",
  "brandVibe": "brand positioning (e.g., 'luxury', 'affordable', 'premium', 'streetwear')",
  "keyFeatures": ["feature 1", "feature 2", "feature 3 - distinctive elements to preserve"]
}`;

  const response = await client.models.generateContent({
    model: MODELS.GEMINI_TEXT,
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

  const text = response.text || '{}';
  
  // Parse JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || [null, text];
  const jsonStr = (jsonMatch[1] || text).trim();
  
  return JSON.parse(jsonStr);
}

export async function analyzeCreatorWithGenAI(
  imageBase64: string,
  mimeType: string
): Promise<CreatorResult> {
  const client = getGenAIClient();
  
  const prompt = `You are an expert in precise facial recognition and fashion analysis. Analyze this person's image with EXTREME detail for accurate recreation.

Respond with ONLY a valid JSON object (no markdown, no code blocks):
{
  "gender": "gender presentation (e.g., 'Female', 'Male', 'Non-binary')",
  "ageRange": "approximate age range (e.g., '20s', '30s to 40s')",
  "skinTone": "DETAILED skin tone including: base tone (fair/medium/deep), undertones (warm/cool/neutral), any freckles/marks/texture",
  "hairStyle": "DETAILED hair: length, cut style, layers, texture (straight/wavy/curly), volume, how it falls",
  "hairColor": "DETAILED hair color: primary color, secondary highlights, any variations or streaks, roots if visible",
  "facialFeatures": "CRITICAL - Ultra detailed face description: face shape (oval/round/square/heart/oblong), forehead size, cheekbones, jawline, chin shape. Eyes: eye shape (almond/round/hooded), eye color, eye distance, eyebrow shape and color. Nose: shape (straight/curved/upturned), size, nostrils. Lips: size, shape, color. Any distinctive marks, scars, moles, beauty marks, or unique features.",
  "bodyType": "body type (pear/apple/rectangle/hourglass) based on visible frame",
  "currentOutfit": "current clothing in detail: type, colors, fit, style",
  "pose": "pose description: angle of body, arm position, head tilt, seated/standing",
  "expression": "facial expression: eyes (open/closed, looking direction), mouth (smile/neutral/other), overall mood",
  "background": "background color and style",
  "lighting": "lighting direction and quality (natural/studio/soft/harsh)",
  "photographyStyle": "photography style: professional/casual/candid/portrait, camera distance"
}`;

  const response = await client.models.generateContent({
    model: MODELS.GEMINI_TEXT,
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

  const text = response.text || '{}';
  
  // Parse JSON from response
  const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || [null, text];
  const jsonStr = (jsonMatch[1] || text).trim();
  
  return JSON.parse(jsonStr);
}

// ============================================
// IMAGE GENERATION - Use Imagen 3 (primary) with Gemini fallbacks
// ============================================

export interface ImageGenerationResult {
  success: boolean;
  imageBase64?: string;
  mimeType?: string;
  modelUsed?: string;
  error?: string;
}

/**
 * Generate an image - tries Imagen 3 first, then falls back to Gemini models
 */
export async function generateImage(
  prompt: string
): Promise<ImageGenerationResult> {
  // Try Imagen 3 first (confirmed working!)
  console.log('Trying Imagen 3 (primary)...');
  const imagenResult = await generateWithImagen(prompt);
  
  if (imagenResult.success && imagenResult.imageBase64) {
    return {
      success: true,
      imageBase64: imagenResult.imageBase64,
      mimeType: imagenResult.mimeType || 'image/png',
      modelUsed: 'imagen-3.0-generate-001',
    };
  }
  
  console.log('Imagen 3 failed, trying Gemini fallbacks...');
  
  // Fall back to Gemini models
  const client = getGenAIClient();
  const errors: string[] = [`imagen-3: ${imagenResult.error}`];

  for (const modelName of MODELS.IMAGE_GEN_FALLBACKS) {
    try {
      console.log(`Trying image generation with model: ${modelName}...`);
      
      const response = await client.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseModalities: [Modality.IMAGE],
        },
      });

      const parts = response.candidates?.[0]?.content?.parts || [];
      
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          console.log(`✓ Image generated successfully with ${modelName}!`);
          return {
            success: true,
            imageBase64: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'image/png',
            modelUsed: modelName,
          };
        }
      }

      errors.push(`${modelName}: No image in response`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.log(`✗ Model ${modelName} failed: ${errorMsg}`);
      errors.push(`${modelName}: ${errorMsg}`);
    }
  }

  return {
    success: false,
    error: `All image generation models failed. ${errors.join('; ')}`,
  };
}

/**
 * Generate image with context - use Imagen 3 with a detailed prompt
 * (Imagen doesn't support image input, so we build a detailed text prompt)
 */
export async function generateImageWithContext(
  productImage: { base64: string; mimeType: string },
  creatorImage: { base64: string; mimeType: string },
  prompt: string
): Promise<ImageGenerationResult> {
  // For Imagen, we just use the detailed prompt
  // The prompt should already contain all the details from the analysis
  return generateImage(prompt);
}

// ============================================
// COMBINED VIRTUAL TRY-ON FLOW
// ============================================

export interface VirtualTryOnInput {
  productImage: { base64: string; mimeType: string };
  creatorImage: { base64: string; mimeType: string };
  options?: {
    setting?: string;
    mood?: string;
    cameraAngle?: string;
  };
}

export interface VirtualTryOnResult {
  success: boolean;
  imageBase64?: string;
  imageMimeType?: string;
  prompt?: string;
  productAnalysis?: AnalysisResult;
  creatorAnalysis?: CreatorResult;
  error?: string;
}

export async function generateVirtualTryOn(
  input: VirtualTryOnInput
): Promise<VirtualTryOnResult> {
  try {
    // Step 1: Analyze both images to get detailed descriptions
    console.log('=== STEP 1: Analyzing both images ===');
    
    console.log('Analyzing product...');
    const productAnalysis = await analyzeProductWithGenAI(
      input.productImage.base64,
      input.productImage.mimeType
    );
    console.log('Product Analysis:', JSON.stringify(productAnalysis, null, 2));

    console.log('Analyzing creator...');
    const creatorAnalysis = await analyzeCreatorWithGenAI(
      input.creatorImage.base64,
      input.creatorImage.mimeType
    );
    console.log('Creator Analysis:', JSON.stringify(creatorAnalysis, null, 2));

    // Step 2: Build detailed descriptions for the generation
    const productDescription = `${productAnalysis.colors.join(' and ')} ${productAnalysis.productType}. 
Style: ${productAnalysis.style}. Material: ${productAnalysis.material}. 
Features: ${productAnalysis.keyFeatures.join(', ')}. 
${productAnalysis.productDescription}`;

    const creatorDescription = `${creatorAnalysis.gender}, ${creatorAnalysis.ageRange}. 
Skin tone: ${creatorAnalysis.skinTone}. Hair: ${creatorAnalysis.hairColor} ${creatorAnalysis.hairStyle}. 
Face: ${creatorAnalysis.facialFeatures}. Body: ${creatorAnalysis.bodyType}. 
Expression: ${creatorAnalysis.expression}`;

    console.log('\n=== STEP 2: Product Description ===');
    console.log(productDescription);
    console.log('\n=== Creator Description ===');
    console.log(creatorDescription);

    // Step 3: Generate image using BOTH images as input
    // This is the key change - we now send BOTH images to the model
    console.log('\n=== STEP 3: Generating with DUAL IMAGE INPUT ===');
    console.log('Sending both product image AND creator image to the model...');
    
    const imageResult = await generateVirtualTryOnImage({
      productImage: {
        base64: input.productImage.base64,
        mimeType: input.productImage.mimeType,
      },
      creatorImage: {
        base64: input.creatorImage.base64,
        mimeType: input.creatorImage.mimeType,
      },
      productDescription,
      creatorDescription,
    });

    if (imageResult.success && imageResult.imageBase64) {
      console.log('✓ Image generated successfully!');
      console.log('  - Product should match exactly');
      console.log('  - Creator face should match exactly');
      return {
        success: true,
        imageBase64: imageResult.imageBase64,
        imageMimeType: imageResult.mimeType || 'image/png',
        prompt: `Product: ${productDescription}\nCreator: ${creatorDescription}`,
        productAnalysis,
        creatorAnalysis,
      };
    }

    // Image generation failed - return analysis only
    console.log('Image generation failed:', imageResult.error);
    return {
      success: true, // Analysis still worked
      prompt: `Product: ${productDescription}\nCreator: ${creatorDescription}`,
      productAnalysis,
      creatorAnalysis,
      error: imageResult.error || 'Image generation failed - model may not support image output',
    };

  } catch (error) {
    console.error('Virtual try-on error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Build a detailed prompt for virtual try-on
function buildVirtualTryOnPrompt(
  product: AnalysisResult,
  creator: CreatorResult,
  options?: { setting?: string; mood?: string; cameraAngle?: string }
): string {
  const setting = options?.setting || 'keep original';
  const mood = options?.mood || 'natural';
  const cameraAngle = options?.cameraAngle || 'three-quarter';

  // Determine action based on product category
  let action = '';
  switch (product.productCategory) {
    case 'wearable':
      action = `wearing a ${product.style} ${product.colors[0]} ${product.productType}`;
      break;
    case 'holdable':
      action = `holding a ${product.style} ${product.colors[0]} ${product.productType}`;
      break;
    case 'accessory':
      action = `with a ${product.style} ${product.colors[0]} ${product.productType}`;
      break;
  }

  return `Create a photorealistic image of a person ${action}.

SUBJECT DESCRIPTION:
- ${creator.gender} person in their ${creator.ageRange}
- Skin tone: ${creator.skinTone}
- Hair: ${creator.hairStyle}, ${creator.hairColor}
- Face: ${creator.facialFeatures}
- Expression: ${creator.expression}

PRODUCT DETAILS (MUST BE ACCURATE):
- Product: ${product.productDescription}
- Colors: ${product.colors.join(', ')}
- Material: ${product.material}
- Key features to preserve: ${product.keyFeatures.join(', ')}

SETTING:
- Background: ${setting === 'keep original' ? creator.background : setting}
- Lighting: ${creator.lighting}
- Camera angle: ${cameraAngle} view
- Mood: ${mood}

QUALITY REQUIREMENTS:
- Photorealistic, high resolution
- Professional fashion photography quality
- Sharp focus on both person and product
- Natural skin texture
- Accurate product proportions and placement

AVOID: deformed, distorted, blurry, wrong colors, floating products, unnatural poses`;
}
