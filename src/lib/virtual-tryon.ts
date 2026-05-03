/**
 * AI Virtual Try-On / Product Placement System
 * 
 * Analyzes product and creator images, then generates a new image
 * where the creator is wearing/holding the product naturally.
 * 
 * Powered by Vertex AI (Gemini + Imagen)
 */

import { VertexAI } from '@google-cloud/vertexai';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'creatoreconomy-479409';
const LOCATION = process.env.GCP_LOCATION || 'us-central1';

// Models - Vertex AI Gemini models
// For text/vision analysis: gemini-2.5-pro
// For image generation: gemini-3-pro-image (Nano Banana Pro)
const GEMINI_MODEL = 'gemini-2.5-pro';
const IMAGE_GEN_MODEL = 'gemini-3-pro-image';

let vertexAI: VertexAI | null = null;

function getVertexAI(): VertexAI {
  if (!vertexAI) {
    vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  }
  return vertexAI;
}

// ============================================
// TYPES
// ============================================

export interface ProductAnalysis {
  productType: string;           // 'watch', 'shirt', 'sunglasses', 'bag', 'shoes', etc.
  productCategory: 'wearable' | 'holdable' | 'accessory';
  wearLocation: string;          // 'wrist', 'torso', 'face', 'hand', 'feet', etc.
  productDescription: string;    // Detailed description
  colors: string[];              // Main colors
  style: string;                 // 'casual', 'formal', 'sporty', etc.
  material: string;              // 'leather', 'cotton', 'metal', etc.
  brandVibe: string;             // 'luxury', 'streetwear', 'minimalist', etc.
  keyFeatures: string[];         // Distinctive features to preserve
}

export interface CreatorAnalysis {
  gender: string;
  ageRange: string;
  skinTone: string;
  hairStyle: string;
  hairColor: string;
  facialFeatures: string;        // Key identifying features
  bodyType: string;
  currentOutfit: string;         // What they're currently wearing
  pose: string;                  // Standing, sitting, etc.
  expression: string;            // Smiling, serious, etc.
  background: string;            // Current background description
  lighting: string;              // Lighting conditions
  photographyStyle: string;      // Portrait, candid, professional, etc.
}

export interface GenerationPrompt {
  mainPrompt: string;
  negativePrompt: string;
  styleGuide: string;
  technicalSpecs: string;
}

// ============================================
// STEP 1: ANALYZE PRODUCT IMAGE
// ============================================

export async function analyzeProduct(
  imageBase64: string,
  mimeType: string
): Promise<ProductAnalysis> {
  const vertex = getVertexAI();
  const model = vertex.getGenerativeModel({ model: GEMINI_MODEL });

  const prompt = `You are an expert fashion and product analyst. Analyze this product image in detail.

Return a JSON object with these exact fields:
{
  "productType": "specific product name (watch, t-shirt, hoodie, sunglasses, sneakers, handbag, necklace, etc.)",
  "productCategory": "wearable" | "holdable" | "accessory",
  "wearLocation": "where on body (wrist, torso, face/eyes, hand, feet, neck, head, waist, etc.)",
  "productDescription": "detailed visual description including design elements",
  "colors": ["primary color", "secondary colors"],
  "style": "casual/formal/sporty/streetwear/bohemian/minimalist/luxury/vintage",
  "material": "apparent material (leather, cotton, denim, metal, silk, etc.)",
  "brandVibe": "luxury/premium/affordable/streetwear/athletic/artisan",
  "keyFeatures": ["distinctive feature 1", "feature 2", "feature 3"]
}

Be extremely detailed about visual elements that should be preserved when placing this on a person.
Only respond with valid JSON.`;

  const result = await model.generateContent({
    contents: [{ 
      role: 'user', 
      parts: [
        { text: prompt },
        { inlineData: { data: imageBase64, mimeType } },
      ]
    }],
  });

  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const jsonStr = text.match(/```json\n?([\s\S]*?)\n?```/)?.[1] || text.match(/\{[\s\S]*\}/)?.[0] || '{}';
  
  return JSON.parse(jsonStr);
}

// ============================================
// STEP 2: ANALYZE CREATOR/REFERENCE IMAGE
// ============================================

export async function analyzeCreator(
  imageBase64: string,
  mimeType: string
): Promise<CreatorAnalysis> {
  const vertex = getVertexAI();
  const model = vertex.getGenerativeModel({ model: GEMINI_MODEL });

  const prompt = `You are an expert portrait and fashion photographer analyst. Analyze this person's image in detail for AI image generation purposes.

Return a JSON object with these exact fields:
{
  "gender": "apparent gender presentation",
  "ageRange": "approximate age range (20s, 30s, etc.)",
  "skinTone": "descriptive skin tone for accurate reproduction",
  "hairStyle": "detailed hair description (length, texture, style)",
  "hairColor": "hair color",
  "facialFeatures": "key identifying facial features (face shape, distinctive features)",
  "bodyType": "body type description",
  "currentOutfit": "what they're currently wearing",
  "pose": "body pose description",
  "expression": "facial expression",
  "background": "background description",
  "lighting": "lighting conditions (natural, studio, warm, cool, etc.)",
  "photographyStyle": "style of photo (portrait, candid, professional headshot, lifestyle, etc.)"
}

Be detailed but respectful. Focus on visual elements needed to recreate their likeness accurately.
Only respond with valid JSON.`;

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: { data: imageBase64, mimeType } },
      ]
    }],
  });

  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const jsonStr = text.match(/```json\n?([\s\S]*?)\n?```/)?.[1] || text.match(/\{[\s\S]*\}/)?.[0] || '{}';
  
  return JSON.parse(jsonStr);
}

// ============================================
// STEP 3: BUILD SOPHISTICATED GENERATION PROMPT
// ============================================

export function buildGenerationPrompt(
  product: ProductAnalysis,
  creator: CreatorAnalysis,
  options: {
    setting?: string;        // 'studio', 'outdoor', 'urban', 'nature', 'keep original'
    mood?: string;           // 'professional', 'casual', 'energetic', 'elegant'
    cameraAngle?: string;    // 'front', 'three-quarter', 'side'
  } = {}
): GenerationPrompt {
  const { setting = 'keep original', mood = 'natural', cameraAngle = 'three-quarter' } = options;

  // Determine how the product should be integrated
  const integrationGuide = getProductIntegrationGuide(product);
  
  // Build the main prompt with extreme detail
  const mainPrompt = `
SUBJECT: A ${creator.gender} person in their ${creator.ageRange} with ${creator.skinTone} skin, ${creator.hairStyle} ${creator.hairColor} hair, ${creator.facialFeatures}.

WEARING/HOLDING: ${integrationGuide.actionDescription}

PRODUCT DETAILS (MUST PRESERVE):
- Product: ${product.productDescription}
- Colors: ${product.colors.join(', ')}
- Material: ${product.material} texture clearly visible
- Key features: ${product.keyFeatures.join(', ')}
- Style: ${product.style} ${product.brandVibe} aesthetic

POSE & EXPRESSION:
- ${integrationGuide.suggestedPose}
- Expression: ${creator.expression}, ${mood} mood
- Camera angle: ${cameraAngle} view

STYLING:
${integrationGuide.stylingNotes}

SETTING & LIGHTING:
- Background: ${setting === 'keep original' ? creator.background : setting}
- Lighting: ${creator.lighting}, professional quality
- Photography style: ${creator.photographyStyle}, high-end ${product.brandVibe} campaign quality

TECHNICAL REQUIREMENTS:
- Photorealistic, 8K quality
- Sharp focus on both face and product
- Natural skin texture
- Accurate product placement and proportions
- Professional fashion photography aesthetics
- Magazine editorial quality
`.trim();

  // Negative prompt to avoid common issues
  const negativePrompt = `
deformed, distorted, disfigured, poorly drawn, bad anatomy, wrong anatomy,
extra limbs, missing limbs, floating limbs, disconnected limbs, mutation, mutated,
ugly, disgusting, blurry, out of focus, bad quality, low quality, amateur,
watermark, text, logo, signature, 
unnatural pose, awkward positioning, 
product floating, product wrong size, product distorted, product blurry,
wrong skin tone, wrong hair color, different person,
oversaturated, overexposed, underexposed,
cartoon, anime, illustration, painting, drawing,
duplicate, clone, multiple people (unless specified)
`.trim();

  const styleGuide = `
Style: ${product.brandVibe} ${product.style} fashion photography
Reference: High-end brand campaign, Vogue editorial, professional lookbook
Color grading: ${mood === 'elegant' ? 'Rich, sophisticated tones' : mood === 'energetic' ? 'Vibrant, dynamic colors' : 'Natural, true-to-life colors'}
Composition: Rule of thirds, product prominently featured, face clearly visible
`.trim();

  const technicalSpecs = `
Resolution: Maximum quality
Aspect ratio: 4:5 (Instagram portrait) or 1:1 (square)
Focus: Sharp on subject and product
Depth of field: Slight background blur for subject separation
`.trim();

  return {
    mainPrompt,
    negativePrompt,
    styleGuide,
    technicalSpecs,
  };
}

// ============================================
// PRODUCT-SPECIFIC INTEGRATION GUIDES
// ============================================

function getProductIntegrationGuide(product: ProductAnalysis): {
  actionDescription: string;
  suggestedPose: string;
  stylingNotes: string;
} {
  const guides: Record<string, { action: string; pose: string; styling: string }> = {
    // WRIST ACCESSORIES
    'watch': {
      action: `wearing a ${product.style} ${product.colors[0]} ${product.material} watch on their wrist, watch face clearly visible`,
      pose: 'One hand slightly raised or touching face/chin to showcase the watch naturally, wrist angled toward camera',
      styling: 'Watch should be the focal point of the wrist area, catching light naturally. Sleeve (if any) should be pulled back to fully expose the watch.',
    },
    'bracelet': {
      action: `wearing a ${product.style} ${product.colors[0]} ${product.material} bracelet on their wrist`,
      pose: 'Relaxed pose with wrist visible, hand gesture that shows off the bracelet',
      styling: 'Bracelet should complement the outfit, wrist positioned to catch light.',
    },

    // UPPER BODY WEAR
    'shirt': {
      action: `wearing a ${product.style} ${product.colors[0]} ${product.material} shirt, perfectly fitted`,
      pose: 'Confident stance, torso facing camera, shirt details clearly visible',
      styling: 'Shirt should fit naturally on the body, fabric draping realistically. Collar, buttons, and any patterns must be accurate.',
    },
    't-shirt': {
      action: `wearing a ${product.style} ${product.colors[0]} ${product.material} t-shirt with ${product.keyFeatures.join(', ')}`,
      pose: 'Casual, relaxed pose showing the full front of the t-shirt',
      styling: 'T-shirt graphics/design must be clearly visible and undistorted. Natural fabric wrinkles around arms and torso.',
    },
    'hoodie': {
      action: `wearing a ${product.style} ${product.colors[0]} hoodie, ${product.keyFeatures.includes('hood up') ? 'hood up' : 'hood down'}`,
      pose: 'Relaxed streetwear pose, hands possibly in front pocket',
      styling: 'Hoodie should have realistic volume and draping. Drawstrings, pocket, and any logos clearly visible.',
    },
    'jacket': {
      action: `wearing a ${product.style} ${product.colors[0]} ${product.material} jacket`,
      pose: 'Standing pose showing jacket silhouette, possibly with one hand in pocket',
      styling: 'Jacket should fit properly on shoulders, lapels and collar properly shaped. Zippers/buttons accurate.',
    },

    // EYEWEAR
    'sunglasses': {
      action: `wearing ${product.style} ${product.colors[0]} ${product.material} sunglasses`,
      pose: 'Face angled slightly, sunglasses prominently featured, possibly a slight smile',
      styling: 'Sunglasses should sit naturally on the nose bridge, temples properly positioned. Lens reflection should look natural.',
    },
    'glasses': {
      action: `wearing ${product.style} ${product.colors[0]} ${product.material} eyeglasses`,
      pose: 'Facing camera, glasses clearly visible, intellectual or professional vibe',
      styling: 'Glasses should fit the face shape naturally, not distort the eyes behind lenses.',
    },

    // FOOTWEAR
    'sneakers': {
      action: `wearing ${product.style} ${product.colors[0]} ${product.material} sneakers`,
      pose: 'Full body or 3/4 shot showing the sneakers, possibly one foot slightly forward',
      styling: 'Sneakers should be laced properly, shown from flattering angle. Pant hem should interact naturally with the shoe.',
    },
    'shoes': {
      action: `wearing ${product.style} ${product.colors[0]} ${product.material} shoes`,
      pose: 'Elegant stance showcasing the footwear, weight distributed naturally',
      styling: 'Shoes should have proper proportions relative to the body, realistic shadows and ground contact.',
    },

    // BAGS & HOLDABLES
    'bag': {
      action: `holding/carrying a ${product.style} ${product.colors[0]} ${product.material} bag`,
      pose: 'Bag held naturally - over shoulder, in hand, or crossbody depending on bag type',
      styling: 'Bag strap should drape naturally, bag proportions correct relative to body size.',
    },
    'handbag': {
      action: `carrying a ${product.style} ${product.colors[0]} ${product.material} handbag`,
      pose: 'Sophisticated pose, bag held in hand or on forearm',
      styling: 'Handbag hardware (clasps, chains) should be visible and detailed.',
    },

    // NECK ACCESSORIES
    'necklace': {
      action: `wearing a ${product.style} ${product.colors[0]} ${product.material} necklace`,
      pose: 'Slight head tilt or straight-on, neckline exposed to show necklace',
      styling: 'Necklace should lay naturally on the collarbone/chest area, clasp hidden at back.',
    },

    // HEAD ACCESSORIES
    'hat': {
      action: `wearing a ${product.style} ${product.colors[0]} ${product.material} hat`,
      pose: 'Head angle that shows the hat well, possibly slight tilt',
      styling: 'Hat should sit properly on head, not floating. Hair should interact naturally with the hat.',
    },
    'cap': {
      action: `wearing a ${product.style} ${product.colors[0]} cap`,
      pose: 'Casual pose, cap worn forward or slightly tilted',
      styling: 'Cap brim should cast natural shadow, hair visible around edges.',
    },
  };

  // Find matching guide or create generic one
  const productKey = Object.keys(guides).find(key => 
    product.productType.toLowerCase().includes(key)
  );

  if (productKey) {
    const guide = guides[productKey];
    return {
      actionDescription: guide.action,
      suggestedPose: guide.pose,
      stylingNotes: guide.styling,
    };
  }

  // Generic fallback based on category
  const categoryGuides = {
    'wearable': {
      actionDescription: `wearing a ${product.style} ${product.colors[0]} ${product.productType} at the ${product.wearLocation}`,
      suggestedPose: 'Natural pose that showcases the product clearly',
      stylingNotes: `Product should appear naturally integrated into the outfit, ${product.material} texture visible.`,
    },
    'holdable': {
      actionDescription: `holding a ${product.style} ${product.colors[0]} ${product.productType} naturally`,
      suggestedPose: 'Relaxed grip, product held at a visible angle',
      stylingNotes: 'Product should be held with realistic hand positioning, proper scale relative to hands.',
    },
    'accessory': {
      actionDescription: `with a ${product.style} ${product.colors[0]} ${product.productType} as an accessory`,
      suggestedPose: 'Pose that highlights the accessory without overshadowing the person',
      stylingNotes: 'Accessory should complement the overall look, positioned for visibility.',
    },
  };

  const fallback = categoryGuides[product.productCategory] || categoryGuides['wearable'];
  return {
    actionDescription: fallback.actionDescription,
    suggestedPose: fallback.suggestedPose,
    stylingNotes: fallback.stylingNotes,
  };
}

// ============================================
// STEP 4: GENERATE THE FINAL IMAGE
// ============================================

export async function generateTryOnImage(
  productImage: { base64: string; mimeType: string },
  creatorImage: { base64: string; mimeType: string },
  options?: {
    setting?: string;
    mood?: string;
    cameraAngle?: string;
  }
): Promise<{
  success: boolean;
  imageBase64?: string;
  imageMimeType?: string;
  prompt?: GenerationPrompt;
  productAnalysis?: ProductAnalysis;
  creatorAnalysis?: CreatorAnalysis;
  error?: string;
}> {
  try {
    // Step 1: Analyze both images in parallel using Gemini Vision
    const [productAnalysis, creatorAnalysis] = await Promise.all([
      analyzeProduct(productImage.base64, productImage.mimeType),
      analyzeCreator(creatorImage.base64, creatorImage.mimeType),
    ]);

    console.log('Product Analysis:', productAnalysis);
    console.log('Creator Analysis:', creatorAnalysis);

    // Step 2: Build the generation prompt
    const prompt = buildGenerationPrompt(productAnalysis, creatorAnalysis, options);
    
    console.log('Generated Prompt:', prompt.mainPrompt);

    // Step 3: Generate the image using Nano Banana Pro (gemini-3-pro-image)
    try {
      const vertex = getVertexAI();
      const imageModel = vertex.getGenerativeModel({ model: IMAGE_GEN_MODEL });

      // Build a comprehensive prompt for image generation
      const imagePrompt = `${prompt.mainPrompt}

Style guidelines:
${prompt.styleGuide}

Avoid: ${prompt.negativePrompt}`;

      console.log('Generating image with Nano Banana Pro...');
      
      const result = await imageModel.generateContent(imagePrompt);
      const parts = result.response.candidates?.[0]?.content?.parts || [];

      // Look for generated image in the response
      for (const part of parts) {
        if (part.inlineData) {
          return {
            success: true,
            imageBase64: part.inlineData.data,
            imageMimeType: part.inlineData.mimeType || 'image/png',
            prompt,
            productAnalysis,
            creatorAnalysis,
          };
        }
      }

      // If no image in response, return analysis with prompt
      return {
        success: true,
        imageBase64: undefined,
        imageMimeType: 'image/png',
        prompt,
        productAnalysis,
        creatorAnalysis,
        error: 'Analysis complete. Image generation model returned text only.',
      };
    } catch (imageGenError) {
      console.error('Image generation error:', imageGenError);
      // Return success with analysis even if image gen fails
      return {
        success: true,
        imageBase64: undefined,
        imageMimeType: 'image/png',
        prompt,
        productAnalysis,
        creatorAnalysis,
        error: `Analysis complete. Image generation failed: ${imageGenError instanceof Error ? imageGenError.message : 'Unknown error'}`,
      };
    }

  } catch (error) {
    console.error('Try-on generation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

// ============================================
// ALTERNATIVE: TEXT-TO-IMAGE WITH DETAILED PROMPT
// (If direct image-to-image isn't supported)
// ============================================

export async function generateFromPromptOnly(
  prompt: GenerationPrompt
): Promise<{ imageBase64?: string; mimeType?: string; error?: string }> {
  try {
    const vertex = getVertexAI();
    const imageModel = vertex.getGenerativeModel({ model: IMAGE_GEN_MODEL });

    const fullPrompt = `${prompt.mainPrompt}\n\n${prompt.styleGuide}`;
    
    const result = await imageModel.generateContent(fullPrompt);
    const parts = result.response.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
      if (part.inlineData) {
        return {
          imageBase64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || 'image/png',
        };
      }
    }

    return { error: 'No image generated' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Generation failed' };
  }
}
