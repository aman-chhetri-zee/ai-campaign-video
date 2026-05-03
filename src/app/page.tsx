"use client";

import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/Header";
import { UploadSection } from "@/components/UploadSection";
import { TemplateSelector } from "@/components/TemplateSelector";
import { GeneratedImagePreview } from "@/components/GeneratedImagePreview";
import { ProgressModal } from "@/components/ProgressModal";
import { Template } from "@/types";
import { storage, UploadResult } from "@/lib/storage";
import { useVirtualTryOn, TryOnOptions } from "@/hooks/useVirtualTryOn";
import { Sparkles, ArrowRight, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Home() {
  // Image upload state
  const [productImage, setProductImage] = useState<File | null>(null);
  const [productUpload, setProductUpload] = useState<UploadResult | null>(null);
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referenceUpload, setReferenceUpload] = useState<UploadResult | null>(null);
  
  // Step tracking: 'upload' -> 'image-generated' -> 'video-selection'
  const [currentStep, setCurrentStep] = useState<'upload' | 'image-generated' | 'video-selection'>('upload');
  
  // Video template state (for step 2)
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  // Virtual Try-On hook
  const virtualTryOn = useVirtualTryOn();

  // Handle file uploads with storage
  const handleProductImageChange = useCallback(async (file: File | null) => {
    setProductImage(file);
    if (file) {
      const uploaded = await storage.upload(file);
      setProductUpload(uploaded);
    } else {
      setProductUpload(null);
    }
  }, []);

  const handleReferenceImageChange = useCallback(async (file: File | null) => {
    setReferenceImage(file);
    if (file) {
      const uploaded = await storage.upload(file);
      setReferenceUpload(uploaded);
    } else {
      setReferenceUpload(null);
    }
  }, []);

  const canGenerate = productUpload && referenceUpload;

  // Generate the try-on image
  const handleGenerateImage = useCallback(async () => {
    if (!canGenerate || !productUpload || !referenceUpload) return;

    const tryOnOptions: TryOnOptions = {
      setting: 'keep original',
      mood: 'professional',
      cameraAngle: 'three-quarter',
    };

    const result = await virtualTryOn.generate(
      productUpload,
      referenceUpload,
      tryOnOptions
    );

    if (result?.success) {
      setCurrentStep('image-generated');
    }
  }, [canGenerate, productUpload, referenceUpload, virtualTryOn]);

  // Recreate / go back to upload
  const handleRecreate = useCallback(() => {
    virtualTryOn.reset();
    setCurrentStep('upload');
  }, [virtualTryOn]);

  // Proceed to video selection
  const handleProceedToVideo = useCallback(() => {
    setCurrentStep('video-selection');
  }, []);

  return (
    <main className="min-h-screen bg-background-primary bg-gradient-mesh">
      {/* Ambient background effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-accent-primary/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-600/10 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10">
        <Header />

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Hero Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-10"
          >
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-4">
              <span className="text-gradient">AI Virtual Try-On</span>
            </h1>
            <p className="text-text-secondary text-lg md:text-xl max-w-2xl mx-auto">
              Upload your product & creator photo — see the magic happen instantly.
            </p>
          </motion.div>

          {/* Step Indicator */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center justify-center gap-4 mb-8"
          >
            <div className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all",
              currentStep === 'upload' 
                ? "bg-accent-primary text-white" 
                : "bg-accent-primary/20 text-accent-primary"
            )}>
              <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-xs">1</span>
              Upload & Generate
            </div>
            <ChevronRight className="w-5 h-5 text-text-muted" />
            <div className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all",
              currentStep === 'image-generated' || currentStep === 'video-selection'
                ? "bg-accent-primary text-white" 
                : "bg-background-tertiary text-text-muted"
            )}>
              <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-xs">2</span>
              Preview & Video
            </div>
          </motion.div>

          {/* Main Content */}
          <div className="space-y-6">
            
            {/* STEP 1: Upload Images */}
            <AnimatePresence mode="wait">
              {(currentStep === 'upload' || !virtualTryOn.result?.success) && !virtualTryOn.isGenerating && (
                <motion.div
                  key="upload-step"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-6"
                >
                  {/* Upload Sections */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <UploadSection
                      title="Product Image"
                      subtitle="Watch, shirt, bag, sunglasses, etc."
                      icon="package"
                      file={productImage}
                      onFileChange={handleProductImageChange}
                      accept="image/png,image/jpeg,image/webp"
                    />
                    <UploadSection
                      title="Creator Reference"
                      subtitle="Photo of you or the creator"
                      icon="user"
                      file={referenceImage}
                      onFileChange={handleReferenceImageChange}
                      accept="image/png,image/jpeg,image/webp"
                    />
                  </div>

                  {/* Generate Image Button */}
                  <motion.button
                    onClick={handleGenerateImage}
                    disabled={!canGenerate || virtualTryOn.isGenerating}
                    whileHover={{ scale: canGenerate ? 1.02 : 1 }}
                    whileTap={{ scale: canGenerate ? 0.98 : 1 }}
                    className={cn(
                      "relative w-full py-4 px-6 rounded-2xl font-semibold text-lg",
                      "transition-all duration-300 overflow-hidden",
                      "flex items-center justify-center gap-3",
                      !canGenerate
                        ? "bg-background-tertiary text-text-muted cursor-not-allowed"
                        : "bg-gradient-to-r from-accent-primary to-purple-600 text-white glow-lg hover:shadow-2xl"
                    )}
                  >
                    {/* Animated background */}
                    {canGenerate && !virtualTryOn.isGenerating && (
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-accent-primary via-purple-500 to-accent-primary"
                        animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                        style={{ backgroundSize: "200% 200%" }}
                      />
                    )}
                    
                    <span className="relative z-10 flex items-center gap-3">
                      <Sparkles className="w-5 h-5" />
                      <span>Generate Try-On Image</span>
                    </span>
                  </motion.button>

                  {!canGenerate && (
                    <p className="text-center text-text-muted text-sm">
                      Upload both images to generate
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Generating State */}
            {virtualTryOn.isGenerating && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <GeneratedImagePreview
                  result={null}
                  isGenerating={true}
                  progress={virtualTryOn.progress}
                  onRecreate={handleRecreate}
                />
              </motion.div>
            )}

            {/* STEP 2: Image Generated - Show Result */}
            <AnimatePresence mode="wait">
              {virtualTryOn.result?.success && currentStep !== 'upload' && (
                <motion.div
                  key="result-step"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-6"
                >
                  {/* Generated Image Preview */}
                  <GeneratedImagePreview
                    result={virtualTryOn.result}
                    isGenerating={false}
                    progress={100}
                    onRecreate={handleRecreate}
                  />

                  {/* Proceed to Video Button */}
                  {currentStep === 'image-generated' && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      className="flex flex-col items-center gap-4"
                    >
                      <p className="text-text-secondary text-center">
                        Happy with the result? Continue to create a video!
                      </p>
                      <button
                        onClick={handleProceedToVideo}
                        className="flex items-center gap-2 px-6 py-3 rounded-xl bg-accent-primary hover:bg-accent-secondary transition-all text-white font-medium"
                      >
                        <span>Continue to Video</span>
                        <ArrowRight className="w-5 h-5" />
                      </button>
                    </motion.div>
                  )}

                  {/* Video Template Selection */}
                  {currentStep === 'video-selection' && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-6"
                    >
                      <div className="text-center">
                        <h2 className="text-2xl font-bold text-text-primary mb-2">
                          Now, Choose a Video Style
                        </h2>
                        <p className="text-text-secondary">
                          Select a template to turn your image into a dynamic video
                        </p>
                      </div>

                      <TemplateSelector
                        selectedTemplate={selectedTemplate}
                        onSelectTemplate={setSelectedTemplate}
                      />

                      {/* Generate Video Button */}
                      <button
                        disabled={!selectedTemplate}
                        className={cn(
                          "w-full py-4 px-6 rounded-2xl font-semibold text-lg",
                          "transition-all duration-300",
                          "flex items-center justify-center gap-3",
                          !selectedTemplate
                            ? "bg-background-tertiary text-text-muted cursor-not-allowed"
                            : "bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:shadow-lg"
                        )}
                      >
                        <span>🎬 Generate Video</span>
                      </button>

                      {!selectedTemplate && (
                        <p className="text-center text-text-muted text-sm">
                          Select a template to generate video
                        </p>
                      )}
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error State */}
            {virtualTryOn.result?.success === false && !virtualTryOn.isGenerating && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <GeneratedImagePreview
                  result={virtualTryOn.result}
                  isGenerating={false}
                  progress={0}
                  onRecreate={handleRecreate}
                />
              </motion.div>
            )}

          </div>
        </div>
      </div>

      {/* Progress Modal */}
      <AnimatePresence>
        {virtualTryOn.isGenerating && (
          <ProgressModal progress={virtualTryOn.progress} />
        )}
      </AnimatePresence>
    </main>
  );
}
