"use client";

import React from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

export function Header() {
  return (
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="sticky top-0 z-50 glass glass-border"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-primary to-purple-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-text-primary">
              Creatify
              <span className="text-accent-primary">AI</span>
            </span>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-8">
            <a href="#" className="text-text-secondary hover:text-text-primary transition-colors">
              Templates
            </a>
            <a href="#" className="text-text-secondary hover:text-text-primary transition-colors">
              Pricing
            </a>
            <a href="#" className="text-text-secondary hover:text-text-primary transition-colors">
              Gallery
            </a>
          </nav>

          {/* CTA */}
          <div className="flex items-center gap-4">
            <button className="text-text-secondary hover:text-text-primary transition-colors text-sm">
              Sign In
            </button>
            <button className="px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-secondary transition-all text-white text-sm font-medium">
              Get Started
            </button>
          </div>
        </div>
      </div>
    </motion.header>
  );
}
