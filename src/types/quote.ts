import type { Timestamps, IsoDateTimeString } from "./common";

// ---------------------------------------------------------------------------
// Quote line item
// ---------------------------------------------------------------------------

export type SecurityServiceType =
  | "monthly"
  | "one_time"
  | "optional"
  | "videotower"
  | "patrol"
  | "guard_hour"
  | "control_run"
  | "transport"
  | "setup"
  | "service"
  | "custom"
  | (string & {});

export type BillingMode = "one_time" | "recurring";
export type BillingInterval = "once" | "hourly" | "daily" | "weekly" | "monthly" | "custom";

export interface QuoteLineItem {
  id: string;
  type: SecurityServiceType;
  label: string;
  description?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  stundenProTag?: number;
  nachtStundenProTag?: number;
  tageProMonat?: number;
  tageSamstag?: number;
  tageSonntag?: number;
  tageFeiertag?: number;
  preisProKontrolle?: number;
  kontrollenProTagWerktag?: number;
  kontrollenProTagSamstag?: number;
  kontrollenProTagSonntag?: number;
  kontrollenProTagFeiertag?: number;
  nachtKontrollenProTag?: number;
  kontrollenProTagWochenende?: number;
  tageWerktage?: number;
  tageWochenende?: number;
  samstagZuschlagPercent?: number;
  sonntagZuschlagPercent?: number;
  feiertagZuschlagPercent?: number;
  nachtZuschlagPercent?: number;
  billingMode: BillingMode;
  interval: BillingInterval;
  category?: string;
  metadata?: Record<string, unknown>;
  totalPrice: number;
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected";

export interface Quote extends Timestamps {
  id: string;
  tenantId?: string;
  /** Sequential human-readable quote number, e.g. "AN-2026-0042" */
  quoteNumber: string;
  projectId: string;
  customerId: string;
  status: QuoteStatus;
  lineItems: QuoteLineItem[];
  /** Net total after discount */
  totalNet: number;
  /** totalNet × (1 + vatRate) */
  totalGross: number;
  /** VAT rate as a decimal fraction, e.g. 0.19 for 19 % */
  vatRate: number;
  /** Optional free-text notes printed at the bottom of the quote */
  notes?: string;
  validUntil: string;
}
