"use client";

import React from "react";
import { motion } from "framer-motion";
import { Sparkles, X } from "lucide-react";

interface ProgressModalProps {
  progress: number;
}

export function ProgressModal({ progress }: ProgressModalProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="relative w-full max-w-md bg-background-secondary rounded-3xl border border-border-subtle p-8 shadow-2xl"
      >
        {/* Glow effect */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-accent-primary/20 to-purple-600/20 rounded-3xl blur-xl" />

        {/* Content */}
        <div className="flex flex-col items-center text-center">
          {/* Animated icon */}
          <div className="relative w-24 h-24 mb-6">
            {/* Orbiting particles */}
            {[0, 1, 2, 3].map((i) => (
              <motion.div
                key={i}
                className="absolute w-2 h-2 rounded-full bg-accent-primary"
                animate={{
                  rotate: 360,
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "linear",
                  delay: i * 0.5,
                }}
                style={{
                  top: "50%",
                  left: "50%",
                  transformOrigin: `${-20 + i * 5}px 0px`,
                }}
              />
            ))}

            {/* Center spinner */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              className="absolute inset-0 rounded-full border-4 border-transparent border-t-accent-primary border-r-accent-primary/50"
            />

            {/* Inner icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Sparkles className="w-10 h-10 text-accent-primary" />
              </motion.div>
            </div>
          </div>

          <h3 className="text-2xl font-bold text-text-primary mb-2">
            Creating Your Video
          </h3>
          <p className="text-text-secondary mb-6">
            Our AI is working its magic. This usually takes 30 seconds to 3 minutes.
          </p>

          {/* Progress bar */}
          <div className="w-full mb-4">
            <div className="h-3 bg-background-tertiary rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-accent-primary to-purple-500 relative"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              >
                {/* Shimmer effect on progress bar */}
                <motion.div
                  className="absolute inset-0"
                  animate={{
                    background: [
                      "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)",
                    ],
                    backgroundPosition: ["-100% 0", "200% 0"],
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                  style={{ backgroundSize: "200% 100%" }}
                />
              </motion.div>
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-text-muted text-sm">Processing...</span>
              <span className="text-accent-primary font-medium text-sm">
                {Math.round(progress)}%
              </span>
            </div>
          </div>

          {/* Status messages */}
          <div className="space-y-2 text-sm">
            <motion.p
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="text-text-muted"
            >
              {progress < 30 && "Analyzing your inputs..."}
              {progress >= 30 && progress < 60 && "Generating video frames..."}
              {progress >= 60 && progress < 90 && "Applying effects and transitions..."}
              {progress >= 90 && "Finalizing your video..."}
            </motion.p>
          </div>

          {/* Tip */}
          <div className="mt-6 p-3 rounded-xl bg-background-tertiary/50 border border-border-subtle">
            <p className="text-text-muted text-xs">
              💡 Tip: You can leave this screen. We&apos;ll notify you when your video is ready!
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
