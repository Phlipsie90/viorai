import type { QuoteLineItem } from "@/types";
import { calculateQuoteTotals } from "@/lib/pricing/calculator";
import {
  getDefaultLineItemsForServiceType,
  getQuickTemplateById,
  type QuoteQuickTemplateId,
  type QuoteServiceType,
} from "@/features/quotes/service-types";
import type { CompanySettings } from "@/features/company-settings/types";

export type OfferMode = "quick" | "standard" | "manual";

export interface BuildOfferDraftInput {
  mode: OfferMode;
  serviceType: QuoteServiceType;
  quickTemplateId?: QuoteQuickTemplateId;
  settings: CompanySettings | null;
  durationMonths?: number;
  discountAmount?: number;
}

export interface BuiltOfferDraft {
  mode: OfferMode;
  serviceType: QuoteServiceType;
  lineItems: QuoteLineItem[];
  totals: {
    monthlyTotal: number;
    oneTimeTotal: number;
    subtotal: number;
    totalNet: number;
    totalGross: number;
    discountAmount: number;
    vatRate: number;
    durationMonths: number;
  };
}

function normalizeDurationMonths(input: BuildOfferDraftInput): number {
  const fromInput = Number(input.durationMonths);
  if (Number.isFinite(fromInput) && fromInput > 0) {
    return Math.max(1, Math.round(fromInput));
  }

  const fromSettings = Number(input.settings?.standardRuntimeMonths ?? 1);
  if (Number.isFinite(fromSettings) && fromSettings > 0) {
    return Math.max(1, Math.round(fromSettings));
  }

  const template = input.quickTemplateId ? getQuickTemplateById(input.quickTemplateId) : null;
  if (template?.defaultDurationMonths) {
    return Math.max(1, Math.round(template.defaultDurationMonths));
  }

  return 1;
}

export function buildOfferDraft(input: BuildOfferDraftInput): BuiltOfferDraft {
  const pricingTemplates = input.settings?.pricingTemplates;
  const durationMonths = normalizeDurationMonths(input);
  const discountAmount = Number.isFinite(input.discountAmount) ? Math.max(0, Number(input.discountAmount)) : 0;
  const vatRate = Number.isFinite(input.settings?.vatRate) ? Math.max(0, Number(input.settings?.vatRate)) : 0.19;

  const lineItems = getDefaultLineItemsForServiceType(input.serviceType, pricingTemplates);
  const totals = calculateQuoteTotals({
    lineItems,
    durationMonths,
    discountAmount,
    vatRate,
  });

  return {
    mode: input.mode,
    serviceType: input.serviceType,
    lineItems: totals.lineItems,
    totals: {
      monthlyTotal: totals.monthlyTotal,
      oneTimeTotal: totals.oneTimeTotal,
      subtotal: totals.subtotal,
      totalNet: totals.totalNet,
      totalGross: totals.totalGross,
      discountAmount: totals.discountAmount,
      vatRate: totals.vatRate,
      durationMonths: totals.durationMonths,
    },
  };
}
