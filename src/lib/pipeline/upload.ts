// src/lib/pipeline/upload.ts
import { put } from "@vercel/blob";

/**
 * Upload a buffer to Vercel Blob storage and return the public HTTPS URL.
 *
 * Requires BLOB_READ_WRITE_TOKEN in the environment. Throws if the token
 * is missing or the upload fails — callers should catch and decide whether
 * to fall back to image-to-video.
 */
export async function uploadToBlob(
  filename: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN not set. Add it to .env.local from your Vercel project's Storage → Blob → tokens.",
    );
  }

  const blob = await put(filename, bytes, {
    access: "public",
    addRandomSuffix: true,
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  return blob.url;
}
