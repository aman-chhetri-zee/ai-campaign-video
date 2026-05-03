"use client";

import { useState, useCallback } from 'react';
import { UploadResult } from '@/lib/storage';

export interface ProductAnalysis {
  description: string;
  productName: string;
  suggestedUSP: string;
  videoPrompt: string;
}

export function useVertexAI() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Analyze a product image using Gemini 2.5 Pro
   */
  const analyzeProduct = useCallback(async (
    image: UploadResult
  ): Promise<ProductAnalysis | null> => {
    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await fetch('/api/analyze-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: image.base64,
          mimeType: image.mimeType,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to analyze product');
      }

      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed';
      setError(message);
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  /**
   * Generate image using Nano Banana Pro (gemini-3-pro-image)
   */
  const generateImage = useCallback(async (
    prompt: string,
    options?: {
      aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
      negativePrompt?: string;
    }
  ): Promise<{ base64: string; mimeType: string }[] | null> => {
    setIsGeneratingImage(true);
    setError(null);

    try {
      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, options }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate image');
      }

      const data = await response.json();
      return data.images;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image generation failed';
      setError(message);
      return null;
    } finally {
      setIsGeneratingImage(false);
    }
  }, []);

  /**
   * Build a video generation prompt based on product analysis
   */
  const buildVideoPrompt = useCallback(async (
    productAnalysis: ProductAnalysis,
    templateStyle: string,
    captionTone: string,
    mood: string,
    duration: string
  ): Promise<string | null> => {
    setError(null);

    try {
      const response = await fetch('/api/build-video-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productAnalysis,
          templateStyle,
          captionTone,
          mood,
          duration,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to build video prompt');
      }

      const data = await response.json();
      return data.videoPrompt;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Prompt generation failed';
      setError(message);
      return null;
    }
  }, []);

  return {
    // Methods
    analyzeProduct,
    generateImage,
    buildVideoPrompt,
    
    // State
    isAnalyzing,
    isGeneratingImage,
    error,
    
    // Clear error
    clearError: () => setError(null),
  };
}
