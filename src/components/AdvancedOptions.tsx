"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, MessageSquare, Palette } from "lucide-react";
import { cn } from "@/lib/utils";

interface AdvancedOptionsProps {
  captionTone: string;
  setCaptionTone: (tone: string) => void;
  mood: string;
  setMood: (mood: string) => void;
}

const CAPTION_TONES = [
  { id: "professional", label: "Professional", emoji: "💼" },
  { id: "casual", label: "Casual", emoji: "😊" },
  { id: "playful", label: "Playful", emoji: "🎉" },
  { id: "bold", label: "Bold", emoji: "🔥" },
  { id: "minimal", label: "Minimal", emoji: "✨" },
];

const MOODS = [
  { id: "energetic", label: "Energetic", color: "from-orange-500 to-red-500" },
  { id: "calm", label: "Calm", color: "from-blue-400 to-cyan-400" },
  { id: "luxury", label: "Luxury", color: "from-amber-400 to-yellow-500" },
  { id: "tech", label: "Tech", color: "from-violet-500 to-purple-500" },
  { id: "natural", label: "Natural", color: "from-green-400 to-emerald-500" },
  { id: "vintage", label: "Vintage", color: "from-amber-600 to-orange-700" },
];

export function AdvancedOptions({
  captionTone,
  setCaptionTone,
  mood,
  setMood,
}: AdvancedOptionsProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-background-secondary rounded-2xl border border-border-subtle overflow-hidden">
      {/* Toggle Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-background-tertiary/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-background-tertiary flex items-center justify-center">
            <Palette className="w-4 h-4 text-accent-primary" />
          </div>
          <div className="text-left">
            <h3 className="text-text-primary font-medium">Advanced Options</h3>
            <p className="text-text-muted text-sm">Caption tone, mood & more</p>
          </div>
        </div>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="w-5 h-5 text-text-muted" />
        </motion.div>
      </button>

      {/* Expandable Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="p-4 pt-0 space-y-5">
              {/* Caption Tone */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare className="w-4 h-4 text-text-muted" />
                  <label className="text-text-secondary text-sm font-medium">
                    Caption Tone
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  {CAPTION_TONES.map((tone) => (
                    <button
                      key={tone.id}
                      onClick={() => setCaptionTone(tone.id)}
                      className={cn(
                        "px-4 py-2 rounded-xl text-sm font-medium transition-all",
                        "flex items-center gap-2",
                        captionTone === tone.id
                          ? "bg-accent-primary text-white"
                          : "bg-background-tertiary text-text-secondary hover:bg-background-elevated hover:text-text-primary"
                      )}
                    >
                      <span>{tone.emoji}</span>
                      <span>{tone.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Mood/Vibe Selector */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Palette className="w-4 h-4 text-text-muted" />
                  <label className="text-text-secondary text-sm font-medium">
                    Mood / Vibe
                  </label>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {MOODS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMood(m.id)}
                      className={cn(
                        "relative p-3 rounded-xl transition-all flex flex-col items-center gap-2",
                        "border-2",
                        mood === m.id
                          ? "border-accent-primary bg-accent-primary/10"
                          : "border-transparent bg-background-tertiary hover:bg-background-elevated"
                      )}
                    >
                      <div
                        className={cn(
                          "w-8 h-8 rounded-full bg-gradient-to-br",
                          m.color
                        )}
                      />
                      <span className="text-xs text-text-secondary">{m.label}</span>
                      {mood === m.id && (
                        <motion.div
                          layoutId="mood-indicator"
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-accent-primary flex items-center justify-center"
                        >
                          <span className="text-white text-[10px]">✓</span>
                        </motion.div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
