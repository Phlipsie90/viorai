import type { QuoteLineItem } from "@/types";
import { createLineItem } from "@/lib/pricing/calculator";
import type {
  AiStructuredExtractionResponse,
  AiStructuredItemInput,
  AiTextGenerationRequest,
} from "./types";

export function buildAiTextPromptInput(input: AiTextGenerationRequest): Record<string, unknown> {
  return {
    customerName: input.customerName,
    projectName: input.projectName,
    projectLocation: input.projectLocation,
    styleHint: input.styleHint,
    lineItems: input.lineItems.map((item) => ({
      type: item.type,
      label: item.label,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      billingMode: item.billingMode,
      interval: item.interval,
      category: item.category,
      metadata: item.metadata,
    })),
    constraints: {
      deterministicPricingOnly: true,
      noPriceCalculationByAi: true,
    },
  };
}

export function mapAiStructuredItemsToLineItems(items: AiStructuredItemInput[]): QuoteLineItem[] {
  return items.map((item) =>
    createLineItem({
      type: item.type,
      label: item.label,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice ?? 0,
      billingMode: item.billingMode,
      interval: item.interval,
      category: item.category,
      metadata: item.metadata,
    })
  );
}

export function normalizeStructuredExtractionResponse(
  response: AiStructuredExtractionResponse
): AiStructuredExtractionResponse {
  const normalizedItems = response.items.map((item) => ({
    ...item,
    type: item.type.trim() || "custom",
    label: item.label.trim() || "Leistungsposition",
    description: item.description?.trim() || undefined,
    quantity: Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1,
    unit: item.unit?.trim() || "Stk",
    unitPrice: Number.isFinite(item.unitPrice) && (item.unitPrice ?? 0) >= 0 ? item.unitPrice : 0,
    billingMode: item.billingMode ?? "one_time",
    interval: item.interval ?? "once",
    category: item.category?.trim() || "custom",
  }));

  return {
    items: normalizedItems,
  };
}
