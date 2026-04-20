import type { QuoteLineItem } from "@/types";

export interface AiTextGenerationRequest {
  customerName: string;
  projectName: string;
  projectLocation?: string;
  styleHint?: string;
  lineItems: QuoteLineItem[];
}

export interface AiTextGenerationResponse {
  offerText: string;
  conceptText: string;
  aiInputSummary?: string;
}

export interface AiStructuredItemInput {
  type: string;
  label: string;
  description?: string;
  quantity: number;
  unit?: string;
  unitPrice?: number;
  billingMode?: "one_time" | "recurring";
  interval?: "once" | "hourly" | "daily" | "weekly" | "monthly" | "custom";
  category?: string;
  metadata?: Record<string, unknown>;
}

export interface AiStructuredExtractionRequest {
  freeText: string;
}

export interface AiStructuredExtractionResponse {
  items: AiStructuredItemInput[];
}
