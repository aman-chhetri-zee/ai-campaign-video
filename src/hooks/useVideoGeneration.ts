"use client";

import { useState, useCallback, useRef } from 'react';
import { UploadResult } from '@/lib/storage';
import { 
  mockGenerateVideo, 
  mockCheckStatus,
  GenerationResponse 
} from '@/lib/api';

export type GenerationStatus = 'idle' | 'queued' | 'processing' | 'completed' | 'failed';

interface UseVideoGenerationOptions {
  onComplete?: (videoUrl: string) => void;
  onError?: (error: string) => void;
}

export function useVideoGeneration(options: UseVideoGenerationOptions = {}) {
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const jobIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(0);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const generate = useCallback(async (
    productImage: UploadResult,
    referenceImage: UploadResult,
    templateId: string,
    advancedOptions: { captionTone: string; mood: string }
  ) => {
    // Reset state
    setStatus('queued');
    setProgress(0);
    setVideoUrl(null);
    setError(null);
    startTimeRef.current = Date.now();

    try {
      // Start generation (using mock for now)
      const response = await mockGenerateVideo({
        productImage,
        referenceImage,
        templateId,
        options: advancedOptions,
      });

      jobIdRef.current = response.jobId;

      // Start polling for status
      pollingRef.current = setInterval(async () => {
        const elapsedSeconds = (Date.now() - startTimeRef.current) / 1000;
        
        try {
          // Using mock status check (replace with real API)
          const statusResponse = await mockCheckStatus(
            jobIdRef.current!,
            elapsedSeconds
          );

          // Update progress based on status
          if (statusResponse.status === 'queued') {
            setStatus('queued');
            setProgress(Math.min(30, elapsedSeconds * 2));
          } else if (statusResponse.status === 'processing') {
            setStatus('processing');
            setProgress(30 + Math.min(60, (elapsedSeconds - 15) * 2.4));
          } else if (statusResponse.status === 'completed') {
            setStatus('completed');
            setProgress(100);
            setVideoUrl(statusResponse.videoUrl!);
            stopPolling();
            options.onComplete?.(statusResponse.videoUrl!);
          } else if (statusResponse.status === 'failed') {
            setStatus('failed');
            setError(statusResponse.error || 'Generation failed');
            stopPolling();
            options.onError?.(statusResponse.error || 'Generation failed');
          }
        } catch (err) {
          console.error('Status check failed:', err);
        }
      }, 1000);

    } catch (err) {
      setStatus('failed');
      setError(err instanceof Error ? err.message : 'Generation failed');
      options.onError?.(err instanceof Error ? err.message : 'Generation failed');
    }
  }, [options, stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setStatus('idle');
    setProgress(0);
    setVideoUrl(null);
    setError(null);
    jobIdRef.current = null;
  }, [stopPolling]);

  return {
    status,
    progress,
    videoUrl,
    error,
    generate,
    reset,
    isGenerating: status === 'queued' || status === 'processing',
  };
}
