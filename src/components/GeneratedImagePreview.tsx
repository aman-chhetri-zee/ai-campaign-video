"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  RotateCcw,
  Share2,
  Sparkles,
  Image as ImageIcon,
  Eye,
  Wand2,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TryOnResult } from "@/hooks/useVirtualTryOn";

interface GeneratedImagePreviewProps {
  result: TryOnResult | null;
  isGenerating: boolean;
  progress: number;
  onRecreate: () => void;
  onDownload?: () => void;
  onShare?: () => void;
}

export function GeneratedImagePreview({
  result,
  isGenerating,
  progress,
  onRecreate,
  onDownload,
  onShare,
}: GeneratedImagePreviewProps) {
  // Check if we have an image - handle both URL and base64
  const hasImage = result?.success && result.image?.url;
  const imageUrl = result?.image?.url || (result?.image?.base64 ? `data:${result.image.mimeType};base64,${result.image.base64}` : null);

  const handleDownload = () => {
    if (imageUrl) {
      const link = document.createElement('a');
      link.href = imageUrl;
      link.download = `creatify-tryon-${Date.now()}.png`;
      link.click();
    }
    onDownload?.();
  };

  const handleShare = async () => {
    if (result?.image?.url && navigator.share) {
      try {
        await navigator.share({
          title: 'My Creatify AI Creation',
          text: 'Check out this AI-generated try-on image!',
          url: window.location.href,
        });
      } catch (err) {
        console.log('Share cancelled');
      }
    }
    onShare?.();
  };

  // Check if we have analysis but no image (partial success)
  const hasAnalysis = result?.analysis?.product || result?.analysis?.creator;
  const analysisOnly = result?.success && !hasImage && hasAnalysis;

  return (
    <div className="bg-background-secondary rounded-2xl border border-border-subtle overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border-subtle flex items-center justify-between">
        <div>
          <h3 className="text-text-primary font-semibold text-lg flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-accent-primary" />
            AI Generated Result
          </h3>
          <p className="text-text-muted text-sm">
            {hasImage
              ? "Your AI-generated image is ready!"
              : analysisOnly
              ? "Analysis complete! Image generation coming soon."
              : isGenerating
              ? "Creating your personalized image..."
              : "Upload images and click Generate"}
          </p>
        </div>
        {(hasImage || analysisOnly) && (
          <div className={`flex items-center gap-1 px-3 py-1 rounded-full ${
            hasImage 
              ? "bg-green-500/10 border border-green-500/20" 
              : "bg-amber-500/10 border border-amber-500/20"
          }`}>
            <CheckCircle className={`w-4 h-4 ${hasImage ? "text-green-500" : "text-amber-500"}`} />
            <span className={`text-sm font-medium ${hasImage ? "text-green-500" : "text-amber-500"}`}>
              {hasImage ? "Complete" : "Analysis Done"}
            </span>
          </div>
        )}
      </div>

      {/* Image Container */}
      <div className="relative aspect-square max-h-[500px] bg-background-tertiary m-4 rounded-xl overflow-hidden">
        <AnimatePresence mode="wait">
          {isGenerating ? (
            <motion.div
              key="generating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center p-6"
            >
              {/* Animated generation effect */}
              <div className="relative w-32 h-32 mb-6">
                {/* Orbiting rings */}
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="absolute inset-0 rounded-full border-2 border-accent-primary/30"
                    animate={{
                      scale: [1, 1.5 + i * 0.3],
                      opacity: [0.6, 0],
                      rotate: [0, 360],
                    }}
                    transition={{
                      duration: 2.5,
                      repeat: Infinity,
                      delay: i * 0.4,
                      ease: "easeOut",
                    }}
                  />
                ))}
                
                {/* Center spinner */}
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 rounded-full border-4 border-transparent border-t-accent-primary border-r-accent-primary/50"
                />
                
                {/* Center icon */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    <Sparkles className="w-10 h-10 text-accent-primary" />
                  </motion.div>
                </div>
              </div>

              <p className="text-text-primary font-medium mb-2">
                Generating your image...
              </p>
              <p className="text-text-muted text-sm text-center mb-4 max-w-xs">
                Our AI is analyzing both images and creating a personalized result
              </p>

              {/* Progress bar */}
              <div className="w-full max-w-xs">
                <div className="h-2 bg-background-elevated rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-accent-primary to-purple-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <div className="flex justify-between mt-2 text-xs text-text-muted">
                  <span>
                    {progress < 30 && "Analyzing images..."}
                    {progress >= 30 && progress < 60 && "Understanding product..."}
                    {progress >= 60 && progress < 85 && "Generating try-on..."}
                    {progress >= 85 && "Finalizing..."}
                  </span>
                  <span className="text-accent-primary font-medium">
                    {Math.round(progress)}%
                  </span>
                </div>
              </div>
            </motion.div>
          ) : hasImage && imageUrl ? (
            <motion.div
              key="result"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0"
            >
              <img
                src={imageUrl}
                alt="AI Generated Try-On"
                className="w-full h-full object-contain"
              />
              
              {/* Overlay with view button on hover */}
              <motion.div
                initial={{ opacity: 0 }}
                whileHover={{ opacity: 1 }}
                className="absolute inset-0 bg-black/40 flex items-center justify-center"
              >
                <button className="p-4 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-colors">
                  <Eye className="w-8 h-8 text-white" />
                </button>
              </motion.div>
            </motion.div>
          ) : analysisOnly ? (
            <motion.div
              key="analysis-only"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 flex flex-col items-center justify-center p-6 overflow-y-auto"
            >
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-4">
                <CheckCircle className="w-8 h-8 text-amber-500" />
              </div>
              <p className="text-text-primary font-medium mb-2">Analysis Complete!</p>
              <p className="text-text-muted text-sm text-center max-w-xs mb-4">
                AI has analyzed your images. Image generation integration coming soon!
              </p>
              
              {/* Show prompt preview */}
              {result?.prompt?.mainPrompt && (
                <div className="w-full max-w-md bg-background-elevated rounded-xl p-4 mt-2">
                  <p className="text-accent-primary text-xs font-medium mb-2">Generated Prompt:</p>
                  <p className="text-text-secondary text-xs leading-relaxed max-h-32 overflow-y-auto">
                    {result.prompt.mainPrompt.slice(0, 500)}...
                  </p>
                </div>
              )}
            </motion.div>
          ) : result?.success === false ? (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 flex flex-col items-center justify-center p-6"
            >
              <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
              <p className="text-text-primary font-medium mb-2">Generation Failed</p>
              <p className="text-text-muted text-sm text-center max-w-xs mb-4">
                {result.error || "Something went wrong. Please try again."}
              </p>
              <button
                onClick={onRecreate}
                className="px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-secondary transition-colors text-white text-sm font-medium"
              >
                Try Again
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center p-6"
            >
              <div className="w-20 h-20 rounded-2xl bg-background-elevated flex items-center justify-center mb-4">
                <ImageIcon className="w-10 h-10 text-text-muted" />
              </div>
              <p className="text-text-primary font-medium mb-2">
                Ready to Create Magic
              </p>
              <p className="text-text-muted text-sm text-center max-w-xs">
                Upload a product image and your reference photo, then click Generate to see the AI magic!
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Analysis Results (if available) */}
      {result?.analysis?.product && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="px-4 pb-2"
        >
          <details className="group">
            <summary className="cursor-pointer text-sm text-text-muted hover:text-text-secondary transition-colors flex items-center gap-2">
              <span>View AI Analysis</span>
              <span className="group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="mt-2 p-3 rounded-lg bg-background-tertiary text-xs space-y-2">
              <div>
                <span className="text-accent-primary font-medium">Product:</span>
                <span className="text-text-secondary ml-2">
                  {result.analysis.product.productType || 'Unknown'} ({result.analysis.product.style || 'N/A'})
                </span>
              </div>
              {result.analysis.product.colors && result.analysis.product.colors.length > 0 && (
                <div>
                  <span className="text-accent-primary font-medium">Colors:</span>
                  <span className="text-text-secondary ml-2">
                    {result.analysis.product.colors.join(', ')}
                  </span>
                </div>
              )}
              {result.analysis.product.brandVibe && (
                <div>
                  <span className="text-accent-primary font-medium">Style:</span>
                  <span className="text-text-secondary ml-2">
                    {result.analysis.product.brandVibe}
                  </span>
                </div>
              )}
            </div>
          </details>
        </motion.div>
      )}

      {/* Action Buttons */}
      {hasImage && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 border-t border-border-subtle"
        >
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={onRecreate}
              className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-background-tertiary hover:bg-background-elevated border border-border-subtle hover:border-border-hover transition-all text-text-secondary hover:text-text-primary"
            >
              <RotateCcw className="w-4 h-4" />
              <span className="text-sm font-medium">Recreate</span>
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-background-tertiary hover:bg-background-elevated border border-border-subtle hover:border-border-hover transition-all text-text-secondary hover:text-text-primary"
            >
              <Download className="w-4 h-4" />
              <span className="text-sm font-medium">Download</span>
            </button>
            <button
              onClick={handleShare}
              className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-accent-primary hover:bg-accent-secondary transition-all text-white"
            >
              <Share2 className="w-4 h-4" />
              <span className="text-sm font-medium">Share</span>
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
