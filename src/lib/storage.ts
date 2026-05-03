/**
 * Storage Abstraction Layer
 * 
 * Currently uses Base64 (works directly with Gemini API)
 * Can easily swap to GCP/S3/Supabase for production
 */

export interface UploadResult {
  id: string;
  url: string;          // For display/preview
  base64: string;       // For Gemini API (accepts base64)
  mimeType: string;
  fileName: string;
  size: number;
}

export interface StorageProvider {
  upload: (file: File) => Promise<UploadResult>;
  delete: (id: string) => Promise<void>;
  getUrl: (id: string) => string;
}

// ============================================
// BASE64 STORAGE (Development / Gemini-ready)
// ============================================
class Base64Storage implements StorageProvider {
  private cache: Map<string, UploadResult> = new Map();

  async upload(file: File): Promise<UploadResult> {
    const id = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const base64 = await this.fileToBase64(file);
    const url = URL.createObjectURL(file); // For preview display
    
    const result: UploadResult = {
      id,
      url,
      base64,
      mimeType: file.type,
      fileName: file.name,
      size: file.size,
    };

    this.cache.set(id, result);
    return result;
  }

  async delete(id: string): Promise<void> {
    const result = this.cache.get(id);
    if (result) {
      URL.revokeObjectURL(result.url);
      this.cache.delete(id);
    }
  }

  getUrl(id: string): string {
    return this.cache.get(id)?.url || '';
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        // Remove data URL prefix for API use: "data:image/png;base64," -> just the base64
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
    });
  }
}

// ============================================
// GCP CLOUD STORAGE (Production - uncomment when ready)
// ============================================
/*
import { Storage } from '@google-cloud/storage';

class GCPStorage implements StorageProvider {
  private storage: Storage;
  private bucketName: string;

  constructor() {
    this.storage = new Storage({
      projectId: process.env.GCP_PROJECT_ID,
      keyFilename: process.env.GCP_KEY_FILE,
    });
    this.bucketName = process.env.GCP_BUCKET_NAME || 'creatify-uploads';
  }

  async upload(file: File): Promise<UploadResult> {
    const id = `gcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fileName = `uploads/${id}_${file.name}`;
    
    const bucket = this.storage.bucket(this.bucketName);
    const blob = bucket.file(fileName);
    
    const buffer = Buffer.from(await file.arrayBuffer());
    await blob.save(buffer, {
      contentType: file.type,
      metadata: {
        originalName: file.name,
      },
    });

    // Generate signed URL (valid for 7 days)
    const [url] = await blob.getSignedUrl({
      action: 'read',
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    // Also get base64 for Gemini
    const base64 = buffer.toString('base64');

    return {
      id,
      url,
      base64,
      mimeType: file.type,
      fileName: file.name,
      size: file.size,
    };
  }

  async delete(id: string): Promise<void> {
    // Extract filename from id and delete from GCP
    const bucket = this.storage.bucket(this.bucketName);
    const [files] = await bucket.getFiles({ prefix: `uploads/${id}` });
    await Promise.all(files.map(file => file.delete()));
  }

  getUrl(id: string): string {
    return `https://storage.googleapis.com/${this.bucketName}/uploads/${id}`;
  }
}
*/

// ============================================
// EXPORT ACTIVE PROVIDER
// ============================================

// Switch this when moving to production:
// export const storage: StorageProvider = new GCPStorage();
export const storage: StorageProvider = new Base64Storage();

// ============================================
// HELPER: Prepare image for Gemini API
// ============================================
export function prepareForGemini(uploadResult: UploadResult) {
  return {
    inlineData: {
      data: uploadResult.base64,
      mimeType: uploadResult.mimeType,
    },
  };
}

// ============================================
// HELPER: Validate image before upload
// ============================================
export function validateImage(file: File): { valid: boolean; error?: string } {
  const MAX_SIZE = 2 * 1024 * 1024; // 2MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: 'Only JPEG, PNG, and WebP images are allowed' };
  }

  if (file.size > MAX_SIZE) {
    return { valid: false, error: 'Image must be less than 2MB' };
  }

  return { valid: true };
}
