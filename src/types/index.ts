export interface Template {
  id: string;
  name: string;
  description: string;
  duration: string;
  orientation: "vertical" | "horizontal";
  thumbnail: string;
  category: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
}

export type GenerationState = "idle" | "generating" | "complete" | "error";

export interface AdvancedOptions {
  captionTone: string;
  mood: string;
}

export interface GenerationRequest {
  productImage: File;
  referenceImage: File;
  templateId: string;
  options: AdvancedOptions;
}

export interface GenerationResponse {
  videoUrl: string;
  thumbnailUrl: string;
  duration: number;
}
