"use client";

import React, { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  RotateCcw,
  Download,
  Share2,
  Volume2,
  VolumeX,
  Maximize2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface VideoPreviewProps {
  videoUrl: string | null;
  isGenerating: boolean;
  onRecreate: () => void;
  progress: number;
}

export function VideoPreview({
  videoUrl,
  isGenerating,
  onRecreate,
  progress,
}: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  return (
    <div className="bg-background-secondary rounded-2xl border border-border-subtle overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border-subtle">
        <h3 className="text-text-primary font-semibold text-lg">Video Preview</h3>
        <p className="text-text-muted text-sm">
          {videoUrl ? "Your generated video is ready" : "Video will appear here after generation"}
        </p>
      </div>

      {/* Video Container - Horizontal Layout */}
      <div className="relative aspect-video max-h-[400px] bg-background-tertiary mx-4 my-4 rounded-xl overflow-hidden">
        <AnimatePresence mode="wait">
          {isGenerating ? (
            <motion.div
              key="generating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center p-6"
            >
              {/* Animated rings */}
              <div className="relative w-32 h-32 mb-6">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="absolute inset-0 rounded-full border-2 border-accent-primary/30"
                    animate={{
                      scale: [1, 1.5 + i * 0.3],
                      opacity: [0.6, 0],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      delay: i * 0.4,
                      ease: "easeOut",
                    }}
                  />
                ))}
                <div className="absolute inset-0 flex items-center justify-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="w-16 h-16 rounded-full border-4 border-transparent border-t-accent-primary"
                  />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-accent-primary" />
                </div>
              </div>

              <p className="text-text-primary font-medium mb-2">Creating your video...</p>
              <p className="text-text-muted text-sm mb-4">This may take 30s to 3 minutes</p>

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
                <p className="text-text-muted text-xs text-center mt-2">
                  {Math.round(progress)}% complete
                </p>
              </div>
            </motion.div>
          ) : videoUrl ? (
            <motion.div
              key="video"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0"
            >
              {/* Sample video placeholder - replace with actual video */}
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                muted={isMuted}
                loop
                playsInline
                onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
                onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                onEnded={() => setIsPlaying(false)}
              >
                <source src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4" type="video/mp4" />
              </video>

              {/* Video overlay controls */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 hover:opacity-100 transition-opacity">
                {/* Center play button */}
                <button
                  onClick={togglePlay}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-colors">
                    {isPlaying ? (
                      <Pause className="w-8 h-8 text-white fill-white" />
                    ) : (
                      <Play className="w-8 h-8 text-white fill-white ml-1" />
                    )}
                  </div>
                </button>

                {/* Bottom controls */}
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  {/* Progress bar */}
                  <div className="w-full h-1 bg-white/20 rounded-full mb-3 cursor-pointer">
                    <div
                      className="h-full bg-accent-primary rounded-full transition-all"
                      style={{ width: `${(currentTime / duration) * 100}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button onClick={togglePlay} className="text-white hover:text-accent-secondary transition-colors">
                        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                      </button>
                      <button onClick={toggleMute} className="text-white hover:text-accent-secondary transition-colors">
                        {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                      </button>
                      <span className="text-white/80 text-sm">
                        {formatTime(currentTime)} / {formatTime(duration)}
                      </span>
                    </div>
                    <button className="text-white hover:text-accent-secondary transition-colors">
                      <Maximize2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
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
                <Play className="w-10 h-10 text-text-muted" />
              </div>
              <p className="text-text-muted text-center">
                Your AI-generated video will appear here
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Action Buttons */}
      {videoUrl && (
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
            <button className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-background-tertiary hover:bg-background-elevated border border-border-subtle hover:border-border-hover transition-all text-text-secondary hover:text-text-primary">
              <Download className="w-4 h-4" />
              <span className="text-sm font-medium">Download</span>
            </button>
            <button className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-accent-primary hover:bg-accent-secondary transition-all text-white">
              <Share2 className="w-4 h-4" />
              <span className="text-sm font-medium">Share</span>
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
