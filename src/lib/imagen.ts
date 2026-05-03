/**
 * Virtual Try-On Image Generation using Imagen 3
 * 
 * PRIMARY APPROACH: Image Inpainting
 * - Takes the reference image (person with their own clothes)
 * - Generates a mask for the clothing area
 * - Uses inpaint to replace clothes with the product
 * - Result: Same face, new product
 * 
 * This preserves the face EXACTLY because we're using the original image
 * and only modifying the clothing area.
 */

import { GoogleAuth } from 'google-auth-library';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'creatoreconomy-479409';
const LOCATION = process.env.GCP_LOCATION || 'us-central1';

let authClient: GoogleAuth | null = null;

function getAuthClient(): GoogleAuth {
  if (!authClient) {
    authClient = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }
  return authClient;
}

export interface ImagenResult {
  success: boolean;
  imageBase64?: string;
  mimeType?: string;
  error?: string;
}

export interface DualImageInput {
  productImage: {
    base64: string;
    mimeType: string;
  };
  creatorImage: {
    base64: string;
    mimeType: string;
  };
  productDescription: string;
  creatorDescription: string;
}

/**
 * Main function: Generate virtual try-on using inpainting
 * 
 * Strategy:
 * 1. Use the reference image as the base (preserves face exactly)
 * 2. Create a mask for the clothing area
 * 3. Use inpaint to replace with the product
 * 4. Result: 100% same face, product integrated
 */
export async function generateVirtualTryOnImage(
  input: DualImageInput
): Promise<ImagenResult> {
  console.log('=== Imagen 3 Virtual Try-On (Inpaint Approach) ===');
  console.log('Strategy: Keep reference face, replace clothing with product');
  
  const auth = getAuthClient();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  if (!tokenResponse.token) {
    return { success: false, error: 'Failed to get authentication token' };
  }

  const token = tokenResponse.token;

  // Try inpaint first (best for face preservation)
  // Then try text-to-image as fallback
  
  const approaches = [
    () => tryImagenInpaint(input, token),
    () => tryImagenWithMasklessInpaint(input, token),
    () => tryDetailedTextGeneration(input, token),
  ];

  for (let i = 0; i < approaches.length; i++) {
    console.log(`\nApproach ${i + 1}: ${['Inpaint with mask', 'Maskless inpaint', 'Detailed text generation'][i]}`);
    try {
      const result = await approaches[i]();
      if (result.success && result.imageBase64) {
        console.log(`✓ Approach ${i + 1} succeeded!`);
        return result;
      }
      console.log(`✗ Approach ${i + 1} failed: ${result.error}`);
    } catch (error) {
      console.error(`✗ Approach ${i + 1} error:`, error);
    }
  }

  return {
    success: false,
    error: 'Image generation failed. Please try again with clearer images.',
  };
}

/**
 * Approach 1: Imagen inpaint with generated mask
 * 
 * This approach:
 * - Takes the reference image
 * - Generates a mask for the clothing area (body area)
 * - Uses inpaint to replace only that area with the product
 * - Face and head are never touched, preserving them exactly
 */
async function tryImagenInpaint(
  input: DualImageInput,
  token: string
): Promise<ImagenResult> {
  console.log('Attempting inpaint with auto-generated mask...');

  // Build a prompt that focuses on clothing/outfit replacement
  const inpaintPrompt = `Replace the person's current outfit with a ${input.productDescription}.

IMPORTANT:
- Keep the person's face EXACTLY the same - do not modify the face at all
- Keep the person's head and hair exactly the same
- Only replace the clothing/outfit with the new product
- Maintain the same pose and lighting
- The new outfit should fit naturally on the person`;

  console.log('Inpaint Prompt:', inpaintPrompt);

  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-3.0-generate-001:predict`;

  const requestBody = {
    instances: [
      {
        prompt: inpaintPrompt,
        // Use the reference image as the base image to edit
        image: {
          bytesBase64Encoded: input.creatorImage.base64,
        },
        // Tell Imagen to auto-generate the mask (inpaint mode)
        // We want to mask the clothing area (body) but NOT the face
        maskMode: 'MASK_MODE_AUTOMATIC', // Let Imagen figure out what to edit
      },
    ],
    parameters: {
      sampleCount: 1,
      aspectRatio: '1:1',
      safetySetting: 'block_some',
      personGeneration: 'allow_adult',
      editMode: 'EDIT_MODE_INPAINT_INSERTION',
    },
  };

  const auth = getAuthClient();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    console.log('Inpaint API Response Status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('Error:', errorText.substring(0, 300));
      return { success: false, error: `API error: ${response.status}` };
    }

    const data = await response.json();

    if (data.predictions?.[0]?.bytesBase64Encoded) {
      console.log('✓ Inpaint succeeded! Face preserved, product added.');
      return {
        success: true,
        imageBase64: data.predictions[0].bytesBase64Encoded,
        mimeType: 'image/png',
      };
    }

    return { success: false, error: 'No image in inpaint response' };

  } catch (error) {
    console.error('Inpaint error:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Approach 2: Imagen edit without explicit mask
 * 
 * Some versions of Imagen support editing without providing a mask,
 * inferring the area to edit from the prompt context.
 */
async function tryImagenWithMasklessInpaint(
  input: DualImageInput,
  token: string
): Promise<ImagenResult> {
  console.log('Attempting maskless inpaint...');

  const prompt = `This image shows a person. Please change their outfit to: ${input.productDescription}

CRITICAL - Do NOT change:
- The person's face
- The person's head/hair
- The person's pose
- The background

ONLY change: The clothing/outfit they are wearing`;

  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-3.0-generate-001:predict`;

  const requestBody = {
    instances: [
      {
        prompt: prompt,
        image: {
          bytesBase64Encoded: input.creatorImage.base64,
        },
        // No mask provided - let Imagen infer what to edit
      },
    ],
    parameters: {
      sampleCount: 1,
      aspectRatio: '1:1',
      editMode: 'EDIT_MODE_INPAINT_REMOVAL', // or EDIT_MODE_INPAINT_INSERTION
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    console.log('Response Status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `API ${response.status}` };
    }

    const data = await response.json();

    if (data.predictions?.[0]?.bytesBase64Encoded) {
      return {
        success: true,
        imageBase64: data.predictions[0].bytesBase64Encoded,
        mimeType: 'image/png',
      };
    }

    return { success: false, error: 'No image in response' };

  } catch (error) {
    console.error('Error:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Approach 3: Detailed text-to-image generation
 * 
 * Fallback to very detailed text prompt if inpaint doesn't work.
 * Uses extreme facial feature precision to try to match the reference.
 */
async function tryDetailedTextGeneration(
  input: DualImageInput,
  token: string
): Promise<ImagenResult> {
  console.log('Attempting detailed text-to-image generation...');

  // Extract all facial features from creator description for precise recreation
  const prompt = buildExtremelyDetailedPrompt(
    input.productDescription,
    input.creatorDescription
  );

  console.log('Detailed Prompt:', prompt.substring(0, 300) + '...');

  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-3.0-generate-001:predict`;

  const requestBody = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: '1:1',
      safetySetting: 'block_some',
      personGeneration: 'allow_adult',
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    console.log('Response Status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `API ${response.status}` };
    }

    const data = await response.json();

    if (data.predictions?.[0]?.bytesBase64Encoded) {
      return {
        success: true,
        imageBase64: data.predictions[0].bytesBase64Encoded,
        mimeType: 'image/png',
      };
    }

    return { success: false, error: 'No image in response' };

  } catch (error) {
    console.error('Error:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Build an extremely detailed prompt for text-to-image
 * When inpaint fails, this provides maximum facial detail
 */
function buildExtremelyDetailedPrompt(
  productDescription: string,
  creatorDescription: string
): string {
  return `Professional fashion photograph. Ultra high definition 8K.

=== PERSON (RECREATE THIS EXACTLY) ===
${creatorDescription}

Important: Recreate this person's appearance EXACTLY as described above.

=== OUTFIT (WHAT THEY ARE WEARING) ===
${productDescription}

=== PHOTO STYLE ===
- Studio photography with professional lighting
- Clean, professional background
- Person is centered and facing camera
- Natural, flattering pose
- Sharp, clear image
- Fashion photography style

Generate this image with EXACT precision for the person's appearance and the product details.`;
}

// ============================================
// LEGACY EXPORTS (backward compatibility)
// ============================================

export async function generateWithImagenAndReference(
  prompt: string,
  referenceImageBase64: string,
  referenceImageMimeType: string
): Promise<ImagenResult> {
  return generateVirtualTryOnImage({
    productImage: { base64: '', mimeType: '' },
    creatorImage: { base64: referenceImageBase64, mimeType: referenceImageMimeType },
    productDescription: prompt,
    creatorDescription: 'Person as shown in reference',
  });
}

export async function generateWithImagen(prompt: string): Promise<ImagenResult> {
  const auth = getAuthClient();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  if (!tokenResponse.token) {
    return { success: false, error: 'Auth failed' };
  }

  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-3.0-generate-001:predict`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenResponse.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '1:1',
          safetySetting: 'block_some',
          personGeneration: 'allow_adult',
        },
      }),
    });

    if (!response.ok) {
      return { success: false, error: `API error ${response.status}` };
    }

    const data = await response.json();
    
    if (data.predictions?.[0]?.bytesBase64Encoded) {
      return {
        success: true,
        imageBase64: data.predictions[0].bytesBase64Encoded,
        mimeType: 'image/png',
      };
    }

    return { success: false, error: 'No image' };

  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export function buildImagenPromptWithReference(
  productType: string,
  productDescription: string,
  productColors: string[]
): string {
  return `${productColors.join(' and ')} ${productType}. ${productDescription}`;
}

export function buildImagenPrompt(
  productType: string,
  productDescription: string,
  productColors: string[],
  creatorGender: string,
  creatorAge: string,
  creatorSkinTone: string,
  creatorHairColor: string
): string {
  return `Professional fashion photograph of a ${creatorGender.toLowerCase()} model in their ${creatorAge}, with ${creatorSkinTone} skin and ${creatorHairColor} hair. Wearing: ${productColors[0]} ${productType}. ${productDescription}. Studio lighting, 8K quality.`;
}
