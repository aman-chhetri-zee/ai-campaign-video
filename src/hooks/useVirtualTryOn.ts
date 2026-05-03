"use client";

import { useState, useCallback } from 'react';
import { UploadResult } from '@/lib/storage';

export interface TryOnAnalysis {
  product: {
    productType: string;
    productCategory: string;
    wearLocation: string;
    productDescription: string;
    colors: string[];
    style: string;
    material: string;
    brandVibe: string;
    keyFeatures: string[];
  };
  creator: {
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
  };
}

export interface TryOnResult {
  success: boolean;
  image?: {
    base64: string;
    mimeType: string;
    url?: string; // Created from base64 for display
  };
  analysis?: TryOnAnalysis;
  prompt?: {
    mainPrompt: string;
    negativePrompt: string;
    styleGuide: string;
  };
  error?: string;
}

export interface TryOnOptions {
  setting?: 'studio' | 'outdoor' | 'urban' | 'nature' | 'keep original';
  mood?: 'professional' | 'casual' | 'energetic' | 'elegant';
  cameraAngle?: 'front' | 'three-quarter' | 'side';
}

export function useVirtualTryOn() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<TryOnResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (
    productImage: UploadResult,
    creatorImage: UploadResult,
    options?: TryOnOptions
  ): Promise<TryOnResult | null> => {
    setIsGenerating(true);
    setProgress(0);
    setError(null);
    setResult(null);

    // Simulate progress updates
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 15;
      });
    }, 500);

    try {
      const response = await fetch('/api/virtual-tryon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productImage: {
            base64: productImage.base64,
            mimeType: productImage.mimeType,
          },
          creatorImage: {
            base64: creatorImage.base64,
            mimeType: creatorImage.mimeType,
          },
          options,
        }),
      });

      clearInterval(progressInterval);
      setProgress(100);

      const data = await response.json();

      // Check if we have a generated image
      if (data.success && data.image?.base64) {
        // Create a data URL for display
        const imageUrl = `data:${data.image.mimeType};base64,${data.image.base64}`;
        
        const tryOnResult: TryOnResult = {
          success: true,
          image: {
            ...data.image,
            url: imageUrl,
          },
          analysis: data.analysis,
          prompt: data.prompt,
        };

        setResult(tryOnResult);
        return tryOnResult;
      } 
      // Check if we have analysis even without image (partial success)
      else if (data.success && (data.analysis || data.prompt)) {
        const tryOnResult: TryOnResult = {
          success: true, // Mark as success since analysis worked
          analysis: data.analysis,
          prompt: data.prompt,
          error: data.error, // May contain info about image gen
        };

        setResult(tryOnResult);
        return tryOnResult;
      }
      else {
        const tryOnResult: TryOnResult = {
          success: false,
          error: data.error || 'Failed to generate image',
          analysis: data.analysis,
          prompt: data.prompt,
        };

        setResult(tryOnResult);
        setError(data.error);
        return tryOnResult;
      }

    } catch (err) {
      clearInterval(progressInterval);
      const message = err instanceof Error ? err.message : 'Generation failed';
      setError(message);
      setResult({ success: false, error: message });
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const reset = useCallback(() => {
    setIsGenerating(false);
    setProgress(0);
    setResult(null);
    setError(null);
  }, []);

  return {
    generate,
    reset,
    isGenerating,
    progress,
    result,
    error,
  };
}
