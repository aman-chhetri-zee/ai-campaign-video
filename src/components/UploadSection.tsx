"use client";

import React, { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { Upload, Package, User, X, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface UploadSectionProps {
  title: string;
  subtitle: string;
  icon: "package" | "user";
  file: File | null;
  onFileChange: (file: File | null) => void;
  accept?: string;
}

export function UploadSection({
  title,
  subtitle,
  icon,
  file,
  onFileChange,
  accept = "image/*",
}: UploadSectionProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const Icon = icon === "package" ? Package : User;

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile && droppedFile.type.startsWith("image/")) {
        onFileChange(droppedFile);
        setPreview(URL.createObjectURL(droppedFile));
      }
    },
    [onFileChange]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile) {
        onFileChange(selectedFile);
        setPreview(URL.createObjectURL(selectedFile));
      }
    },
    [onFileChange]
  );

  const handleRemove = useCallback(() => {
    onFileChange(null);
    setPreview(null);
  }, [onFileChange]);

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      transition={{ type: "spring", stiffness: 300 }}
      className={cn(
        "relative rounded-2xl border-2 border-dashed transition-all duration-300 overflow-hidden",
        isDragging
          ? "border-accent-primary bg-accent-primary/10"
          : "border-border-subtle hover:border-border-hover bg-background-secondary",
        file && "border-solid border-accent-primary/50"
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept={accept}
        onChange={handleFileInput}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
      />

      {preview ? (
        <div className="relative aspect-square">
          <img
            src={preview}
            alt="Preview"
            className="w-full h-full object-cover rounded-xl"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <button
            onClick={handleRemove}
            className="absolute top-2 right-2 z-20 p-1.5 rounded-full bg-background-primary/80 hover:bg-background-primary transition-colors"
          >
            <X className="w-4 h-4 text-text-primary" />
          </button>
          <div className="absolute bottom-3 left-3 right-3">
            <p className="text-sm font-medium text-white truncate">{file?.name}</p>
            <p className="text-xs text-white/70">
              {file && (file.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-6 aspect-square">
          <div className="w-14 h-14 rounded-2xl bg-background-tertiary flex items-center justify-center mb-4">
            <Icon className="w-7 h-7 text-text-muted" />
          </div>
          <h3 className="text-text-primary font-medium mb-1">{title}</h3>
          <p className="text-text-muted text-sm text-center mb-4">{subtitle}</p>
          <div className="flex items-center gap-2 text-accent-primary text-sm">
            <Upload className="w-4 h-4" />
            <span>Drop or click to upload</span>
          </div>
        </div>
      )}

      {/* Glow effect when dragging */}
      {isDragging && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 bg-accent-primary/5 pointer-events-none"
        />
      )}
    </motion.div>
  );
}
