import type { QuoteLineItem } from "@/types/quote";
import type { QuoteServiceType } from "./service-types";

export type IsoDateString = string;

export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected";

export interface QuotePricing {
  monthlyTotal: number;
  oneTimeTotal: number;
  subtotal: number;
  netTotal: number;
  grossTotal: number;
  discountAmount: number;
  vatRate: number;
}

export interface Quote {
  id: string;
  tenantId?: string;
  number?: string;
  customerId: string;
  projectId: string;
  serviceType?: QuoteServiceType;
  positions: QuoteLineItem[];
  pricing: QuotePricing;
  status: QuoteStatus;
  generatedText?: string;
  conceptText?: string;
  aiInputSummary?: string;
  validUntil?: IsoDateString;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteStatusHistoryEntry {
  id: string;
  quoteId: string;
  tenantId?: string;
  oldStatus?: QuoteStatus;
  newStatus: QuoteStatus;
  changedBy?: string;
  changedAt: string;
}
