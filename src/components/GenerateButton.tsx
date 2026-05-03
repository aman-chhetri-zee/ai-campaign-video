"use client";

import React from "react";
import { motion } from "framer-motion";
import { Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface GenerateButtonProps {
  onClick: () => void;
  disabled: boolean;
  isGenerating: boolean;
}

export function GenerateButton({ onClick, disabled, isGenerating }: GenerateButtonProps) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled || isGenerating}
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      className={cn(
        "relative w-full py-4 px-6 rounded-2xl font-semibold text-lg",
        "transition-all duration-300 overflow-hidden",
        "flex items-center justify-center gap-3",
        disabled
          ? "bg-background-tertiary text-text-muted cursor-not-allowed"
          : "bg-gradient-to-r from-accent-primary to-purple-600 text-white glow-lg hover:shadow-2xl"
      )}
    >
      {/* Animated background gradient */}
      {!disabled && !isGenerating && (
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-accent-primary via-purple-500 to-accent-primary"
          animate={{
            backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "linear",
          }}
          style={{ backgroundSize: "200% 200%" }}
        />
      )}

      {/* Shimmer effect */}
      {!disabled && !isGenerating && (
        <motion.div
          className="absolute inset-0 opacity-30"
          animate={{
            background: [
              "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)",
            ],
            backgroundPosition: ["-200% 0", "200% 0"],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "linear",
          }}
          style={{ backgroundSize: "200% 100%" }}
        />
      )}

      {/* Content */}
      <span className="relative z-10 flex items-center gap-3">
        {isGenerating ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Generating Magic...</span>
          </>
        ) : (
          <>
            <Sparkles className="w-5 h-5" />
            <span>Generate Video</span>
          </>
        )}
      </span>

      {/* Disabled state message */}
      {disabled && !isGenerating && (
        <span className="absolute -bottom-6 left-0 right-0 text-center text-xs text-text-muted">
          Upload images and select a template to continue
        </span>
      )}
    </motion.button>
  );
}
