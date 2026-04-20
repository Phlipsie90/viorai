import type { IsoDateTimeString } from "@/types";
import { getSupabaseClient } from "@/lib/supabase/client";
import { resolveTenantContext } from "@/lib/supabase/tenant-context";
import type { CompanySettings, CompanySettingsDraft } from "./types";
import { isQuoteServiceType, type QuoteServiceType } from "@/features/quotes/service-types";
import type { QuoteLineItem } from "@/types";

interface CompanySettingsRow {
  id: string;
  tenant_id: string;
  company_name: string;
  logo_url: string | null;
  letterhead: string | null;
  footer: string | null;
  address: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  payment_terms: string | null;
  standard_runtime_months: number | null;
  vat_rate: number | null;
  currency: string | null;
  intro_text: string | null;
  closing_text: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  pricing_templates: unknown;
  created_at: string;
  updated_at: string;
}
const COMPANY_SETTINGS_SELECT_COLUMNS =
  "id, tenant_id, company_name, logo_url, letterhead, footer, address, contact_person, email, phone, website, payment_terms, standard_runtime_months, vat_rate, currency, intro_text, closing_text, primary_color, secondary_color, pricing_templates, created_at, updated_at";
const COMPANY_SETTINGS_SELECT_COLUMNS_LEGACY =
  "id, tenant_id, company_name, logo_url, letterhead, footer, address, contact_person, email, phone, website, payment_terms, vat_rate, currency, intro_text, closing_text, created_at, updated_at";

function nowIsoTimestamp(): IsoDateTimeString {
  return new Date().toISOString();
}

function normalizeOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isMissingColumnError(message?: string | null): boolean {
  if (!message) {
    return false;
  }

  return message.includes("company_settings.primary_color")
    || message.includes("company_settings.secondary_color")
    || message.includes("company_settings.pricing_templates")
    || message.includes("company_settings.standard_runtime_months")
    || message.includes("Could not find the 'primary_color' column")
    || message.includes("Could not find the 'secondary_color' column")
    || message.includes("Could not find the 'pricing_templates' column")
    || message.includes("Could not find the 'standard_runtime_months' column");
}

function normalizeColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed) ? trimmed : fallback;
}

function mapPricingTemplates(input: unknown): Partial<Record<QuoteServiceType, QuoteLineItem[]>> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const result: Partial<Record<QuoteServiceType, QuoteLineItem[]>> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isQuoteServiceType(key) || !Array.isArray(value)) {
      continue;
    }

    result[key] = value as QuoteLineItem[];
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function mapServiceTextMap(input: unknown): Partial<Record<QuoteServiceType, string>> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const result: Partial<Record<QuoteServiceType, string>> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isQuoteServiceType(key) || typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      result[key] = trimmed;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function readTemplateMeta(input: unknown): {
  offerTextTemplates?: Partial<Record<QuoteServiceType, string>>;
  aiPromptHints?: Partial<Record<QuoteServiceType, string>>;
  defaultValidityDays?: number;
  legalTermsText?: string;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const row = input as Record<string, unknown>;
  return {
    offerTextTemplates: mapServiceTextMap(row.__offer_text_templates),
    aiPromptHints: mapServiceTextMap(row.__ai_prompt_hints),
    defaultValidityDays: Number.isFinite(row.__default_validity_days) ? Math.max(1, Number(row.__default_validity_days)) : undefined,
    legalTermsText: typeof row.__legal_terms_text === "string" ? row.__legal_terms_text.trim() : undefined,
  };
}

function buildPricingTemplatePayload(
  pricingTemplates: CompanySettingsDraft["pricingTemplates"],
  offerTextTemplates: CompanySettingsDraft["offerTextTemplates"],
  aiPromptHints: CompanySettingsDraft["aiPromptHints"],
  defaultValidityDays: CompanySettingsDraft["defaultValidityDays"],
  legalTermsText: CompanySettingsDraft["legalTermsText"]
) {
  const payload: Record<string, unknown> = {};

  for (const [serviceType, items] of Object.entries(pricingTemplates ?? {})) {
    if (!isQuoteServiceType(serviceType) || !Array.isArray(items)) {
      continue;
    }
    payload[serviceType] = items;
  }

  const offerTextPayload: Record<string, string> = {};
  for (const [serviceType, value] of Object.entries(offerTextTemplates ?? {})) {
    if (!isQuoteServiceType(serviceType) || typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      offerTextPayload[serviceType] = trimmed;
    }
  }

  const aiHintPayload: Record<string, string> = {};
  for (const [serviceType, value] of Object.entries(aiPromptHints ?? {})) {
    if (!isQuoteServiceType(serviceType) || typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      aiHintPayload[serviceType] = trimmed;
    }
  }

  payload.__offer_text_templates = offerTextPayload;
  payload.__ai_prompt_hints = aiHintPayload;
  payload.__default_validity_days = Number.isFinite(defaultValidityDays) ? Math.max(1, Number(defaultValidityDays)) : 14;
  payload.__legal_terms_text = legalTermsText.trim();
  return payload;
}

function mapRowToSettings(row: CompanySettingsRow): CompanySettings {
  const templateMeta = readTemplateMeta(row.pricing_templates);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    companyName: row.company_name,
    logoUrl: row.logo_url ?? undefined,
    letterhead: row.letterhead ?? undefined,
    footer: row.footer ?? undefined,
    address: row.address ?? undefined,
    contactPerson: row.contact_person ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    website: row.website ?? undefined,
    paymentTerms: row.payment_terms ?? undefined,
    defaultValidityDays: templateMeta.defaultValidityDays ?? 14,
    legalTermsText: templateMeta.legalTermsText ?? undefined,
    standardRuntimeMonths: Number(row.standard_runtime_months ?? 3),
    vatRate: Number(row.vat_rate ?? 0.19),
    currency: row.currency ?? "EUR",
    introText: row.intro_text ?? undefined,
    closingText: row.closing_text ?? undefined,
    offerTextTemplates: templateMeta.offerTextTemplates,
    aiPromptHints: templateMeta.aiPromptHints,
    primaryColor: row.primary_color ?? "#2563eb",
    secondaryColor: row.secondary_color ?? "#0f172a",
    pricingTemplates: mapPricingTemplates(row.pricing_templates),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPayload(draft: CompanySettingsDraft) {
  const companyName = draft.companyName.trim();
  if (companyName.length === 0) {
    throw new Error("Firmenname ist erforderlich.");
  }

  return {
    company_name: companyName,
    logo_url: normalizeOptional(draft.logoUrl),
    letterhead: normalizeOptional(draft.letterhead),
    footer: normalizeOptional(draft.footer),
    address: normalizeOptional(draft.address),
    contact_person: normalizeOptional(draft.contactPerson),
    email: normalizeOptional(draft.email),
    phone: normalizeOptional(draft.phone),
    website: normalizeOptional(draft.website),
    payment_terms: normalizeOptional(draft.paymentTerms),
    standard_runtime_months: Number.isFinite(draft.standardRuntimeMonths)
      ? Math.max(1, Number(draft.standardRuntimeMonths))
      : 3,
    vat_rate: Number.isFinite(draft.vatRate) ? Math.max(0, draft.vatRate) : 0.19,
    currency: normalizeOptional(draft.currency) ?? "EUR",
    intro_text: normalizeOptional(draft.introText),
    closing_text: normalizeOptional(draft.closingText),
    primary_color: normalizeColor(draft.primaryColor, "#2563eb"),
    secondary_color: normalizeColor(draft.secondaryColor, "#0f172a"),
    pricing_templates: buildPricingTemplatePayload(
      draft.pricingTemplates,
      draft.offerTextTemplates,
      draft.aiPromptHints,
      draft.defaultValidityDays,
      draft.legalTermsText
    ),
  };
}

function toLegacyPayload(draft: CompanySettingsDraft) {
  const payload = toPayload(draft);

  return {
    company_name: payload.company_name,
    logo_url: payload.logo_url,
    letterhead: payload.letterhead,
    footer: payload.footer,
    address: payload.address,
    contact_person: payload.contact_person,
    email: payload.email,
    phone: payload.phone,
    website: payload.website,
    payment_terms: payload.payment_terms,
    vat_rate: payload.vat_rate,
    currency: payload.currency,
    intro_text: payload.intro_text,
    closing_text: payload.closing_text,
  };
}

export const companySettingsRepository = {
  async get(): Promise<CompanySettings | null> {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    let data: unknown = null;
    let error: { message: string } | null = null;

    const primaryResult = await supabase
      .from("company_settings")
      .select(COMPANY_SETTINGS_SELECT_COLUMNS)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle();
    data = primaryResult.data;
    error = primaryResult.error;

    if (error && isMissingColumnError(error.message)) {
      const legacyResult = await supabase
        .from("company_settings")
        .select(COMPANY_SETTINGS_SELECT_COLUMNS_LEGACY)
        .eq("tenant_id", tenant.tenantId)
        .maybeSingle();
      data = legacyResult.data;
      error = legacyResult.error;
    }

    if (error) {
      throw new Error(error.message);
    }

    return data ? mapRowToSettings(data as CompanySettingsRow) : null;
  },

  async save(draft: CompanySettingsDraft): Promise<CompanySettings> {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const payload = toPayload(draft);

    let data: unknown = null;
    let error: { message: string } | null = null;

    const primaryResult = await supabase
      .from("company_settings")
      .upsert({
        tenant_id: tenant.tenantId,
        ...payload,
        updated_at: nowIsoTimestamp(),
      }, {
        onConflict: "tenant_id",
      })
      .select(COMPANY_SETTINGS_SELECT_COLUMNS)
      .single();
    data = primaryResult.data;
    error = primaryResult.error;

    if (error && isMissingColumnError(error.message)) {
      const legacyPayload = toLegacyPayload(draft);
      const legacyResult = await supabase
        .from("company_settings")
        .upsert({
          tenant_id: tenant.tenantId,
          ...legacyPayload,
          updated_at: nowIsoTimestamp(),
        }, {
          onConflict: "tenant_id",
        })
        .select(COMPANY_SETTINGS_SELECT_COLUMNS_LEGACY)
        .single();
      data = legacyResult.data;
      error = legacyResult.error;
    }

    if (error || !data) {
      throw new Error(error?.message ?? "Firmeneinstellungen konnten nicht gespeichert werden.");
    }

    return mapRowToSettings(data as CompanySettingsRow);
  },

  async update(draft: CompanySettingsDraft): Promise<CompanySettings> {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const payload = toPayload(draft);

    let data: unknown = null;
    let error: { message: string } | null = null;

    const primaryResult = await supabase
      .from("company_settings")
      .update({
        ...payload,
        updated_at: nowIsoTimestamp(),
      })
      .eq("tenant_id", tenant.tenantId)
      .select(COMPANY_SETTINGS_SELECT_COLUMNS)
      .single();
    data = primaryResult.data;
    error = primaryResult.error;

    if (error && isMissingColumnError(error.message)) {
      const legacyPayload = toLegacyPayload(draft);
      const legacyResult = await supabase
        .from("company_settings")
        .update({
          ...legacyPayload,
          updated_at: nowIsoTimestamp(),
        })
        .eq("tenant_id", tenant.tenantId)
        .select(COMPANY_SETTINGS_SELECT_COLUMNS_LEGACY)
        .single();
      data = legacyResult.data;
      error = legacyResult.error;
    }

    if (error || !data) {
      return this.save(draft);
    }

    return mapRowToSettings(data as CompanySettingsRow);
  },
};
