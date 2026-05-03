"use client";

import React from "react";
import { motion } from "framer-motion";
import { Check, Play, Clock, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Template } from "@/types";

const TEMPLATES: Template[] = [
  {
    id: "1",
    name: "Product Showcase",
    description: "Dynamic product reveal with face overlay",
    duration: "15s",
    orientation: "vertical",
    thumbnail: "https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=300&h=400&fit=crop",
    category: "Product Demo",
  },
  {
    id: "2",
    name: "Lifestyle Blend",
    description: "Seamless lifestyle integration",
    duration: "30s",
    orientation: "vertical",
    thumbnail: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=300&h=400&fit=crop",
    category: "Lifestyle",
  },
  {
    id: "3",
    name: "Minimal Elegance",
    description: "Clean, premium product presentation",
    duration: "20s",
    orientation: "vertical",
    thumbnail: "https://images.unsplash.com/photo-1634017839464-5c339bbe3f35?w=300&h=400&fit=crop",
    category: "Minimal",
  },
  {
    id: "4",
    name: "Energy Burst",
    description: "High-energy dynamic transitions",
    duration: "15s",
    orientation: "vertical",
    thumbnail: "https://images.unsplash.com/photo-1614851099175-e5b30eb6f696?w=300&h=400&fit=crop",
    category: "Dynamic",
  },
  {
    id: "5",
    name: "Story Format",
    description: "Optimized for social stories",
    duration: "10s",
    orientation: "vertical",
    thumbnail: "https://images.unsplash.com/photo-1618172193763-c511deb635ca?w=300&h=400&fit=crop",
    category: "Stories",
  },
  {
    id: "6",
    name: "Cinematic",
    description: "Film-like quality and transitions",
    duration: "45s",
    orientation: "vertical",
    thumbnail: "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=300&h=400&fit=crop",
    category: "Premium",
  },
];

interface TemplateSelectorProps {
  selectedTemplate: Template | null;
  onSelectTemplate: (template: Template) => void;
}

export function TemplateSelector({
  selectedTemplate,
  onSelectTemplate,
}: TemplateSelectorProps) {
  return (
    <div className="bg-background-secondary rounded-2xl p-5 border border-border-subtle">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-text-primary font-semibold text-lg">Select Template</h3>
          <p className="text-text-muted text-sm">Choose a video style for your campaign</p>
        </div>
        <span className="text-xs text-text-muted bg-background-tertiary px-3 py-1 rounded-full">
          {TEMPLATES.length} templates
        </span>
      </div>

      {/* Template Grid - Horizontal Scroll on mobile */}
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
        {TEMPLATES.map((template, index) => (
          <motion.div
            key={template.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelectTemplate(template)}
            className={cn(
              "relative flex-shrink-0 w-32 cursor-pointer group",
              "rounded-xl overflow-hidden border-2 transition-all duration-300",
              selectedTemplate?.id === template.id
                ? "border-accent-primary glow"
                : "border-transparent hover:border-border-hover"
            )}
          >
            {/* Thumbnail */}
            <div className="relative aspect-[3/4] overflow-hidden">
              <img
                src={template.thumbnail}
                alt={template.name}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              />
              
              {/* Overlay gradient */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

              {/* Play button on hover */}
              <motion.div
                initial={{ opacity: 0 }}
                whileHover={{ opacity: 1 }}
                className="absolute inset-0 flex items-center justify-center bg-black/30"
              >
                <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <Play className="w-5 h-5 text-white fill-white" />
                </div>
              </motion.div>

              {/* Selected indicator */}
              {selectedTemplate?.id === template.id && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-accent-primary flex items-center justify-center"
                >
                  <Check className="w-4 h-4 text-white" />
                </motion.div>
              )}

              {/* Duration badge */}
              <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm">
                <Clock className="w-3 h-3 text-white/80" />
                <span className="text-xs text-white/80">{template.duration}</span>
              </div>

              {/* Template info */}
              <div className="absolute bottom-0 left-0 right-0 p-3">
                <h4 className="text-white text-sm font-medium truncate">{template.name}</h4>
                <p className="text-white/60 text-xs truncate">{template.description}</p>
              </div>
            </div>

            {/* Category tag */}
            <div className="absolute bottom-14 left-2">
              <span className="text-[10px] text-accent-secondary bg-accent-primary/20 px-2 py-0.5 rounded-full">
                {template.category}
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Selected template info */}
      {selectedTemplate && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-4 p-3 rounded-xl bg-accent-primary/10 border border-accent-primary/20"
        >
          <div className="flex items-center gap-3">
            <Smartphone className="w-5 h-5 text-accent-primary" />
            <div>
              <p className="text-text-primary text-sm font-medium">
                {selectedTemplate.name} selected
              </p>
              <p className="text-text-muted text-xs">
                {selectedTemplate.duration} • {selectedTemplate.orientation} format
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
