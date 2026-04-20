import type { IsoDateTimeString, QuoteLineItem } from "@/types";
import { getSupabaseClient } from "@/lib/supabase/client";
import { resolveTenantContext } from "@/lib/supabase/tenant-context";
import type { Quote, QuoteStatus, QuoteStatusHistoryEntry } from "./types";
import { isQuoteServiceType } from "./service-types";

const LEGACY_STATUS_MAP: Record<string, QuoteStatus> = {
  draft: "draft",
  sent: "sent",
  accepted: "accepted",
  declined: "rejected",
  rejected: "rejected",
};

interface QuoteRow {
  id: string;
  tenant_id: string;
  number: string | null;
  customer_id: string;
  project_id: string;
  service_type: string | null;
  positions: unknown;
  pricing: unknown;
  status: string;
  generated_text: string | null;
  concept_text: string | null;
  ai_input_summary: string | null;
  valid_until: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

interface QuoteStatusHistoryRow {
  id: string;
  quote_id: string;
  tenant_id: string;
  old_status: string | null;
  new_status: string;
  changed_by: string | null;
  changed_at: string;
}

const QUOTE_SELECT_COLUMNS =
  "id, tenant_id, number, customer_id, project_id, service_type, positions, pricing, status, generated_text, concept_text, ai_input_summary, valid_until, sent_at, created_at, updated_at";
const QUOTE_SELECT_COLUMNS_LEGACY =
  "id, tenant_id, customer_id, project_id, positions, pricing, status, generated_text, concept_text, ai_input_summary, valid_until, created_at, updated_at";

function isMissingColumnError(message?: string | null): boolean {
  if (!message) {
    return false;
  }

  return message.includes("column quotes.number does not exist")
    || message.includes("column quotes.service_type does not exist")
    || message.includes("column quotes.sent_at does not exist")
    || message.includes("Could not find the 'number' column")
    || message.includes("Could not find the 'service_type' column")
    || message.includes("Could not find the 'sent_at' column");
}

async function selectQuoteRowsWithFallback<T>(
  primaryQuery: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  fallbackQueryFactory: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const primaryResult = await primaryQuery;
  if (!primaryResult.error || !isMissingColumnError(primaryResult.error.message)) {
    return primaryResult;
  }

  return fallbackQueryFactory();
}

async function selectSingleQuoteRowWithFallback<T>(
  primaryQuery: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  fallbackQueryFactory: () => PromiseLike<{ data: T | null; error: { message: string } | null }>
): Promise<{ data: T | null; error: { message: string } | null }> {
  const primaryResult = await primaryQuery;
  if (!primaryResult.error || !isMissingColumnError(primaryResult.error.message)) {
    return primaryResult;
  }

  return fallbackQueryFactory();
}

function nowIsoTimestamp(): IsoDateTimeString {
  return new Date().toISOString();
}

function sortQuotes(quotes: Quote[]): Quote[] {
  return [...quotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function normalizeStatus(status: string): QuoteStatus {
  return LEGACY_STATUS_MAP[status] ?? "draft";
}

function normalizeDateOnly(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const match = trimmed.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0];
}

function normalizeLineItemCategory(value: string): string {
  return value === "personnel" ? "personell" : value;
}

function normalizeLineItem(entry: unknown): QuoteLineItem | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const row = entry as Partial<QuoteLineItem>;
  if (typeof row.id !== "string" || typeof row.label !== "string") {
    return null;
  }

  const quantity = Number.isFinite(row.quantity) ? Number(row.quantity) : 0;
  const unitPrice = Number.isFinite(row.unitPrice) ? Number(row.unitPrice) : 0;
  const stundenProTag = Number.isFinite(row.stundenProTag) ? Number(row.stundenProTag) : undefined;
  const nachtStundenProTag = Number.isFinite(row.nachtStundenProTag)
    ? Number(row.nachtStundenProTag)
    : undefined;
  const tageProMonat = Number.isFinite(row.tageProMonat) ? Number(row.tageProMonat) : undefined;
  const tageSamstag = Number.isFinite(row.tageSamstag) ? Number(row.tageSamstag) : undefined;
  const tageSonntag = Number.isFinite(row.tageSonntag) ? Number(row.tageSonntag) : undefined;
  const tageFeiertag = Number.isFinite(row.tageFeiertag) ? Number(row.tageFeiertag) : undefined;
  const preisProKontrolle = Number.isFinite(row.preisProKontrolle) ? Number(row.preisProKontrolle) : undefined;
  const kontrollenProTagWerktag = Number.isFinite(row.kontrollenProTagWerktag)
    ? Number(row.kontrollenProTagWerktag)
    : undefined;
  const kontrollenProTagSamstag = Number.isFinite(row.kontrollenProTagSamstag)
    ? Number(row.kontrollenProTagSamstag)
    : undefined;
  const kontrollenProTagSonntag = Number.isFinite(row.kontrollenProTagSonntag)
    ? Number(row.kontrollenProTagSonntag)
    : undefined;
  const kontrollenProTagFeiertag = Number.isFinite(row.kontrollenProTagFeiertag)
    ? Number(row.kontrollenProTagFeiertag)
    : undefined;
  const nachtKontrollenProTag = Number.isFinite(row.nachtKontrollenProTag)
    ? Number(row.nachtKontrollenProTag)
    : undefined;
  const kontrollenProTagWochenende = Number.isFinite(row.kontrollenProTagWochenende)
    ? Number(row.kontrollenProTagWochenende)
    : undefined;
  const tageWerktage = Number.isFinite(row.tageWerktage) ? Number(row.tageWerktage) : undefined;
  const tageWochenende = Number.isFinite(row.tageWochenende) ? Number(row.tageWochenende) : undefined;
  const samstagZuschlagPercent = Number.isFinite(row.samstagZuschlagPercent)
    ? Number(row.samstagZuschlagPercent)
    : undefined;
  const sonntagZuschlagPercent = Number.isFinite(row.sonntagZuschlagPercent)
    ? Number(row.sonntagZuschlagPercent)
    : undefined;
  const feiertagZuschlagPercent = Number.isFinite(row.feiertagZuschlagPercent)
    ? Number(row.feiertagZuschlagPercent)
    : undefined;
  const nachtZuschlagPercent = Number.isFinite(row.nachtZuschlagPercent)
    ? Number(row.nachtZuschlagPercent)
    : undefined;
  const totalPrice = Number.isFinite(row.totalPrice) ? Number(row.totalPrice) : quantity * unitPrice;

  return {
    ...row,
    id: row.id,
    type: (row.type as QuoteLineItem["type"]) ?? "custom",
    label: row.label,
    quantity,
    unit: row.unit?.toString().trim() ? row.unit.toString() : "Stk",
    unitPrice,
    stundenProTag,
    nachtStundenProTag,
    tageProMonat,
    tageSamstag,
    tageSonntag,
    tageFeiertag,
    preisProKontrolle,
    kontrollenProTagWerktag,
    kontrollenProTagSamstag,
    kontrollenProTagSonntag,
    kontrollenProTagFeiertag,
    nachtKontrollenProTag,
    kontrollenProTagWochenende,
    tageWerktage,
    tageWochenende,
    samstagZuschlagPercent,
    sonntagZuschlagPercent,
    feiertagZuschlagPercent,
    nachtZuschlagPercent,
    billingMode: (row.billingMode as QuoteLineItem["billingMode"]) ?? "one_time",
    interval: (row.interval as QuoteLineItem["interval"]) ?? "once",
    category: normalizeLineItemCategory(row.category?.toString() || "custom"),
    description: row.description?.toString().trim() || undefined,
    metadata: row.metadata,
    totalPrice,
  };
}

function mapRowToQuote(row: QuoteRow): Quote {
  const parsedPositions = Array.isArray(row.positions)
    ? row.positions.map((entry) => normalizeLineItem(entry)).filter((entry): entry is QuoteLineItem => !!entry)
    : [];

  const pricingInput = (row.pricing ?? {}) as Partial<Quote["pricing"]>;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    number: row.number ?? undefined,
    customerId: row.customer_id,
    projectId: row.project_id,
    serviceType: isQuoteServiceType(row.service_type) ? row.service_type : undefined,
    positions: parsedPositions,
    pricing: {
      monthlyTotal: Number(pricingInput.monthlyTotal ?? 0),
      oneTimeTotal: Number(pricingInput.oneTimeTotal ?? 0),
      subtotal: Number(pricingInput.subtotal ?? 0),
      netTotal: Number(pricingInput.netTotal ?? 0),
      grossTotal: Number(pricingInput.grossTotal ?? 0),
      discountAmount: Number(pricingInput.discountAmount ?? 0),
      vatRate: Number(pricingInput.vatRate ?? 0.19),
    },
    status: normalizeStatus(row.status),
    generatedText: row.generated_text ?? undefined,
    conceptText: row.concept_text ?? undefined,
    aiInputSummary: row.ai_input_summary ?? undefined,
    validUntil: normalizeDateOnly(row.valid_until),
    sentAt: row.sent_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapHistoryRow(row: QuoteStatusHistoryRow): QuoteStatusHistoryEntry {
  return {
    id: row.id,
    quoteId: row.quote_id,
    tenantId: row.tenant_id,
    oldStatus: row.old_status ? normalizeStatus(row.old_status) : undefined,
    newStatus: normalizeStatus(row.new_status),
    changedBy: row.changed_by ?? undefined,
    changedAt: row.changed_at,
  };
}

function toDbPayload(quote: Quote, tenantId: string, createdAt?: string) {
  const customerId = quote.customerId.trim();
  const projectId = quote.projectId.trim();

  if (customerId.length === 0) {
    throw new Error("customerId is required");
  }

  if (projectId.length === 0) {
    throw new Error("projectId is required");
  }

  return {
    id: quote.id,
    tenant_id: tenantId,
    number: quote.number ?? null,
    customer_id: customerId,
    project_id: projectId,
    service_type: quote.serviceType ?? null,
    positions: quote.positions,
    pricing: quote.pricing,
    status: normalizeStatus(quote.status),
    generated_text: quote.generatedText ?? null,
    concept_text: quote.conceptText ?? null,
    ai_input_summary: quote.aiInputSummary ?? null,
    valid_until: normalizeDateOnly(quote.validUntil) ?? null,
    sent_at: quote.sentAt ?? null,
    created_at: createdAt ?? quote.createdAt,
    updated_at: nowIsoTimestamp(),
  };
}

async function getNextQuoteNumber(tenantId: string): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("next_quote_number", {
    p_tenant_id: tenantId,
  });

  if (error || typeof data !== "string" || data.trim().length === 0) {
    throw new Error(error?.message ?? "Angebotsnummer konnte nicht erzeugt werden.");
  }

  return data;
}

export const localQuoteRepository = {
  async getAllQuotes(): Promise<Quote[]> {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const { data, error } = await selectQuoteRowsWithFallback(
      supabase
        .from("quotes")
        .select(QUOTE_SELECT_COLUMNS)
        .eq("tenant_id", tenant.tenantId),
      () =>
        supabase
          .from("quotes")
          .select(QUOTE_SELECT_COLUMNS_LEGACY)
          .eq("tenant_id", tenant.tenantId)
    );

    if (error) {
      throw new Error(error.message);
    }

    return sortQuotes((data ?? []).map((entry) => mapRowToQuote(entry as QuoteRow)));
  },

  async getQuoteById(id: string): Promise<Quote | null> {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const { data, error } = await selectSingleQuoteRowWithFallback(
      supabase
        .from("quotes")
        .select(QUOTE_SELECT_COLUMNS)
        .eq("id", id)
        .eq("tenant_id", tenant.tenantId)
        .maybeSingle(),
      () =>
        supabase
          .from("quotes")
          .select(QUOTE_SELECT_COLUMNS_LEGACY)
          .eq("id", id)
          .eq("tenant_id", tenant.tenantId)
          .maybeSingle()
    );

    if (error) {
      throw new Error(error.message);
    }

    return data ? mapRowToQuote(data as QuoteRow) : null;
  },

  async saveQuote(quote: Quote): Promise<Quote> {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const persistedId = quote.id || crypto.randomUUID();
    const createdAt = quote.createdAt || nowIsoTimestamp();
    const number = quote.number ?? (await getNextQuoteNumber(tenant.tenantId));
    const payload = toDbPayload(
      {
        ...quote,
        id: persistedId,
        number,
      },
      tenant.tenantId,
      createdAt
    );

    const { data, error } = await supabase
      .from("quotes")
      .insert(payload)
      .select(QUOTE_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Quote could not be created.");
    }

    return mapRowToQuote(data as QuoteRow);
  },

  async updateQuote(quote: Quote): Promise<Quote> {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const current = await this.getQuoteById(quote.id);

    if (!current) {
      throw new Error("Quote not found.");
    }

    const payload = toDbPayload(
      {
        ...quote,
        number: quote.number ?? current.number,
      },
      tenant.tenantId,
      current.createdAt
    );
    const { data, error } = await supabase
      .from("quotes")
      .update(payload)
      .eq("id", quote.id)
      .eq("tenant_id", tenant.tenantId)
      .select(QUOTE_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Quote not found.");
    }

    return mapRowToQuote(data as QuoteRow);
  },

  async updateQuoteStatus(id: string, status: QuoteStatus): Promise<Quote> {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const nextStatus = normalizeStatus(status);
    const { data, error } = await supabase
      .from("quotes")
      .update({
        status: nextStatus,
        sent_at: nextStatus === "sent" ? nowIsoTimestamp() : null,
        updated_at: nowIsoTimestamp(),
      })
      .eq("id", id)
      .eq("tenant_id", tenant.tenantId)
      .select(QUOTE_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Quote not found.");
    }

    return mapRowToQuote(data as QuoteRow);
  },

  async markQuoteSent(id: string): Promise<Quote> {
    return this.updateQuoteStatus(id, "sent");
  },

  async duplicateQuote(id: string): Promise<Quote> {
    const original = await this.getQuoteById(id);
    if (!original) {
      throw new Error("Quote not found.");
    }

    const now = nowIsoTimestamp();
    return this.saveQuote({
      ...original,
      id: crypto.randomUUID(),
      number: undefined,
      status: "draft",
      sentAt: undefined,
      createdAt: now,
      updatedAt: now,
    });
  },

  async getQuoteStatusHistory(quoteId: string): Promise<QuoteStatusHistoryEntry[]> {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const { data, error } = await supabase
      .from("quote_status_history")
      .select("id, quote_id, tenant_id, old_status, new_status, changed_by, changed_at")
      .eq("tenant_id", tenant.tenantId)
      .eq("quote_id", quoteId)
      .order("changed_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((entry) => mapHistoryRow(entry as QuoteStatusHistoryRow));
  },

  async deleteQuote(id: string): Promise<void> {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const { error } = await supabase.from("quotes").delete().eq("id", id).eq("tenant_id", tenant.tenantId);

    if (error) {
      throw new Error(error.message);
    }
  },
};
