import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateOfferTextWithDeepSeek } from "@/features/ai/deepseek";
import { buildOfferDraft, type OfferMode } from "@/features/offers/build-offer-draft";
import { buildIntegratedOfferDraft, type RuntimeMode, type TariffTimeModel } from "@/features/offers/integrated-engine";
import { isQuoteServiceType, type QuoteQuickTemplateId, type QuoteServiceType } from "@/features/quotes/service-types";
import type { CompanySettings } from "@/features/company-settings/types";
import { buildQuotePdfFileName, generateQuotePdf } from "@/lib/pdf/generator";
import type { QuoteLineItem } from "@/types";
import { loadTariffDataset, type TariffContext } from "@/lib/tariff/engine";
import type { PatrolInput } from "@/lib/patrol/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface QuickCreateRequestBody {
  customer: {
    companyName: string;
    contactName?: string;
    email?: string;
    phone?: string;
    street?: string;
    postalCode?: string;
    city?: string;
  };
  project: {
    name: string;
    serviceAddress: string;
    state?: string;
    objectType?: string;
    runtimeLabel?: string;
    notes?: string;
    areaSize?: string;
    requestedUnits?: number;
  };
  offer: {
    mode?: OfferMode;
    serviceType: QuoteServiceType;
    quickTemplateId?: QuoteQuickTemplateId;
    autoGenerateText?: boolean;
    targetMargin?: number;
    runtimeMode?: RuntimeMode;
    runtimeMonths?: number;
    runtimeLabel?: string;
    employeeCount?: number;
    timeModel?: TariffTimeModel;
    tariffContext?: TariffContext;
    serviceContext?: string;
    wageGroup?: string;
    dutyDurationHours?: number;
    shiftStartIso?: string;
    shiftEndIso?: string;
    employerCostFactor?: number;
    patrolInput?: PatrolInput;
    includePlannerOutput?: boolean;
    plannerOutput?: {
      cameras?: number;
      towers?: number;
      recorders?: number;
      switches?: number;
      obstacles?: number;
    };
  };
}

interface QuickCreateContext {
  tenantId: string;
  quoteId: string;
  quoteNumber: string | null;
  validUntil: string;
  mode: OfferMode;
  serviceType: QuoteServiceType;
  generatedText: string;
  conceptText: string;
  finalText: string;
  customer: {
    id: string;
    companyName: string;
    contactName?: string;
    street?: string;
    postalCode?: string;
    city?: string;
    email?: string;
    phone?: string;
    address?: string;
    billingAddress?: string;
  };
  project: {
    id: string;
    name: string;
    location: string;
    runtimeLabel: string;
    state?: string;
    objectType?: string;
    notes?: string;
    serviceAddress?: string;
  };
  built: ReturnType<typeof buildOfferDraft>;
  settings: CompanySettings | null;
}

function normalizeText(value?: string | null): string {
  return (value ?? "").trim();
}

function isLegacyQuotesColumnError(message?: string | null): boolean {
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return message.includes("column quotes.mode does not exist")
    || message.includes("column quotes.final_text does not exist")
    || message.includes("column quotes.subtotal_net does not exist")
    || message.includes("column quotes.vat_amount does not exist")
    || message.includes("column quotes.total_gross does not exist")
    || message.includes("column quotes.pdf_storage_path does not exist")
    || message.includes("column quotes.pdf_public_url does not exist")
    || message.includes("column quotes.pdf_path does not exist")
    || message.includes("column quotes.tariff_context does not exist")
    || message.includes("column quotes.state does not exist")
    || message.includes("column quotes.wage_group does not exist")
    || message.includes("column quotes.duty_duration_hours does not exist")
    || message.includes("column quotes.employer_factor does not exist")
    || message.includes("column quotes.time_model does not exist")
    || message.includes("column quotes.planner_camera_count does not exist")
    || message.includes("column quotes.planner_tower_count does not exist")
    || message.includes("column quotes.planner_recorder_count does not exist")
    || message.includes("column quotes.planner_switch_count does not exist")
    || message.includes("column quotes.planner_obstacle_count does not exist")
    || message.includes("column quotes.calculation_snapshot does not exist")
    || message.includes("column quotes.monthly_amount does not exist")
    || message.includes("column quotes.one_time_amount does not exist")
    || message.includes("column quotes.net_total does not exist")
    || message.includes("column quotes.gross_total does not exist")
    || message.includes("column quotes.tariff_snapshot does not exist")
    || message.includes("column quotes.patrol_snapshot does not exist")
    || normalized.includes("within group is required for ordered-set aggregate mode");
}

function parseAddress(input: QuickCreateRequestBody["customer"]): string {
  const street = normalizeText(input.street);
  const postalCode = normalizeText(input.postalCode);
  const city = normalizeText(input.city);
  return [street, postalCode, city].filter((part) => part.length > 0).join(", ");
}

function composeAddress(input: { street?: string | null; postalCode?: string | null; city?: string | null }): string {
  return [normalizeText(input.street), normalizeText(input.postalCode), normalizeText(input.city)]
    .filter((part) => part.length > 0)
    .join(", ");
}

function parseRuntimeMonths(runtimeLabel?: string): number {
  const match = runtimeLabel?.match(/\d+/);
  if (!match?.[0]) {
    return 1;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.round(parsed)) : 1;
}

function parseTargetMargin(targetMargin: unknown): number {
  const parsed = Number(targetMargin);
  if (!Number.isFinite(parsed)) {
    return 0.22;
  }
  return Math.min(0.6, Math.max(0.05, parsed));
}

function parseTimeModel(timeModel: unknown): TariffTimeModel {
  if (
    timeModel === "day"
    || timeModel === "night"
    || timeModel === "twentyfourseven"
    || timeModel === "patrol"
  ) {
    return timeModel;
  }

  return "day";
}

function parseRuntimeMode(value: unknown): RuntimeMode {
  return value === "fixed" ? "fixed" : "until_revocation";
}

function buildFallbackText(input: {
  customerName: string;
  projectName: string;
  location: string;
  serviceTypeLabel: string;
  runtimeLabel: string;
}): string {
  return `Guten Tag ${input.customerName},\n\nwir bedanken uns für Ihre Anfrage und unterbreiten Ihnen hiermit unser Angebot für ${input.projectName} in ${input.location} (${input.serviceTypeLabel}). Die Leistung wird gemäß Positionsübersicht transparent kalkuliert. Die Abrechnung erfolgt auf monatlicher Basis${input.runtimeLabel ? `, Laufzeit: ${input.runtimeLabel}` : ""}.\n\nMit freundlichen Grüßen`;
}

function getSupabaseServerClient(authHeader: string | null): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase-Umgebung ist unvollständig konfiguriert.");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function resolveTenantId(supabase: SupabaseClient): Promise<string> {
  const rpcResult = await supabase.rpc("resolve_localhost_tenant_context");
  if (!rpcResult.error && typeof rpcResult.data === "string" && rpcResult.data.length > 0) {
    return rpcResult.data;
  }

  const userResult = await supabase.auth.getUser();
  const userId = userResult.data.user?.id;
  if (!userId) {
    throw new Error("Authentifizierung fehlgeschlagen.");
  }

  const tenantResult = await supabase
    .from("tenant_users")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (tenantResult.error || !tenantResult.data?.tenant_id) {
    throw new Error(tenantResult.error?.message ?? "Kein Tenant-Kontext gefunden.");
  }

  return tenantResult.data.tenant_id as string;
}

async function loadCompanySettings(supabase: SupabaseClient, tenantId: string): Promise<CompanySettings | null> {
  const result = await supabase
    .from("company_settings")
    .select("id, tenant_id, company_name, payment_terms, vat_rate, currency, intro_text, closing_text, standard_runtime_months, pricing_templates")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (result.error || !result.data) {
    return null;
  }

  const row = result.data as Record<string, unknown>;
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    companyName: String(row.company_name ?? ""),
    paymentTerms: typeof row.payment_terms === "string" ? row.payment_terms : undefined,
    vatRate: Number(row.vat_rate ?? 0.19),
    currency: typeof row.currency === "string" ? row.currency : "EUR",
    introText: typeof row.intro_text === "string" ? row.intro_text : undefined,
    closingText: typeof row.closing_text === "string" ? row.closing_text : undefined,
    standardRuntimeMonths: Number(row.standard_runtime_months ?? 1),
    pricingTemplates: (row.pricing_templates as CompanySettings["pricingTemplates"]) ?? undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function upsertCustomer(
  supabase: SupabaseClient,
  tenantId: string,
  body: QuickCreateRequestBody["customer"]
): Promise<{
  id: string;
  companyName: string;
  contactName?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  email?: string;
  phone?: string;
  address?: string;
  billingAddress?: string;
}> {
  const companyName = normalizeText(body.companyName);
  const email = normalizeText(body.email).toLowerCase();
  if (!companyName) {
    throw new Error("Firmenname ist erforderlich.");
  }

  const companyMatches = await supabase
    .from("customers")
    .select("id, company_name, contact_name, street, postal_code, city, email, phone, address, billing_address")
    .eq("tenant_id", tenantId)
    .ilike("company_name", companyName)
    .limit(20);
  if (companyMatches.error) {
    throw new Error(companyMatches.error.message);
  }

  const matches = (companyMatches.data ?? []) as Array<Record<string, unknown>>;
  const selectedMatch = email
    ? matches.find((entry) => normalizeText(entry.email as string).toLowerCase() === email) ?? matches[0]
    : matches.find((entry) => normalizeText(entry.company_name as string).toLowerCase() === companyName.toLowerCase()) ?? matches[0];

  if (selectedMatch?.id) {
    const nextStreet = normalizeText(body.street);
    const nextPostalCode = normalizeText(body.postalCode);
    const nextCity = normalizeText(body.city);
    const nextAddress = parseAddress(body);
    const patch = {
      contact_name: normalizeText(body.contactName) || normalizeText(selectedMatch.contact_name as string) || null,
      street: nextStreet || normalizeText(selectedMatch.street as string) || null,
      postal_code: nextPostalCode || normalizeText(selectedMatch.postal_code as string) || null,
      city: nextCity || normalizeText(selectedMatch.city as string) || null,
      email: email || normalizeText(selectedMatch.email as string) || null,
      phone: normalizeText(body.phone) || normalizeText(selectedMatch.phone as string) || null,
      address: nextAddress || normalizeText(selectedMatch.address as string) || null,
      billing_address: nextAddress || normalizeText(selectedMatch.billing_address as string) || null,
      updated_at: new Date().toISOString(),
    };
    await supabase
      .from("customers")
      .update(patch)
      .eq("id", String(selectedMatch.id))
      .eq("tenant_id", tenantId);

    const normalizedAddress = patch.address ?? (composeAddress({ street: patch.street, postalCode: patch.postal_code, city: patch.city }) || undefined);

    return {
      id: String(selectedMatch.id),
      companyName: String(selectedMatch.company_name ?? companyName),
      contactName: patch.contact_name ?? undefined,
      street: patch.street ?? undefined,
      postalCode: patch.postal_code ?? undefined,
      city: patch.city ?? undefined,
      email: patch.email ?? undefined,
      phone: patch.phone ?? undefined,
      address: normalizedAddress,
      billingAddress: patch.billing_address ?? normalizedAddress,
    };
  }

  const street = normalizeText(body.street) || null;
  const postalCode = normalizeText(body.postalCode) || null;
  const city = normalizeText(body.city) || null;
  const address = parseAddress(body);
  const insertResult = await supabase
    .from("customers")
    .insert({
      tenant_id: tenantId,
      company_name: companyName,
      contact_name: normalizeText(body.contactName) || null,
      street,
      postal_code: postalCode,
      city,
      email: email || null,
      phone: normalizeText(body.phone) || null,
      address: address || null,
      billing_address: address || null,
      notes: null,
    })
    .select("id, company_name, contact_name, street, postal_code, city, email, phone, address, billing_address")
    .single();

  if (insertResult.error || !insertResult.data?.id) {
    throw new Error(insertResult.error?.message ?? "Kunde konnte nicht angelegt werden.");
  }

  return {
    id: String(insertResult.data.id),
    companyName: String(insertResult.data.company_name ?? companyName),
    contactName: normalizeText(insertResult.data.contact_name as string) || undefined,
    street: normalizeText(insertResult.data.street as string) || undefined,
    postalCode: normalizeText(insertResult.data.postal_code as string) || undefined,
    city: normalizeText(insertResult.data.city as string) || undefined,
    email: normalizeText(insertResult.data.email as string) || undefined,
    phone: normalizeText(insertResult.data.phone as string) || undefined,
    address: normalizeText(insertResult.data.address as string) || undefined,
    billingAddress: normalizeText(insertResult.data.billing_address as string) || undefined,
  };
}

async function createProject(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
  project: QuickCreateRequestBody["project"]
): Promise<{ id: string; name: string; location: string; runtimeLabel: string; state?: string; objectType?: string; notes?: string; serviceAddress?: string }> {
  const runtimeLabel = normalizeText(project.runtimeLabel) || "Bis auf Widerruf";
  const payload = {
    tenant_id: tenantId,
    customer_id: customerId,
    name: normalizeText(project.name),
    location: normalizeText(project.serviceAddress) || normalizeText(project.name),
    site_address: normalizeText(project.serviceAddress) || null,
    state: normalizeText(project.state) || null,
    object_type: normalizeText(project.objectType) || null,
    area_size: normalizeText(project.areaSize) || null,
    requested_units: Number.isFinite(project.requestedUnits) ? Math.max(0, Number(project.requestedUnits)) : null,
    description: normalizeText(project.notes) || null,
    runtime_label: runtimeLabel,
    start_date: null,
    end_date: null,
  };

  let created = await supabase
    .from("projects")
    .insert(payload)
    .select("id, name, location, runtime_label")
    .single();

  if (created.error && (created.error.message.includes("object_type") || created.error.message.includes("requested_units") || created.error.message.includes("area_size") || created.error.message.includes("state"))) {
    const fallback = await supabase
      .from("projects")
      .insert({
        tenant_id: payload.tenant_id,
        customer_id: payload.customer_id,
        name: payload.name,
        location: payload.location,
        site_address: payload.site_address,
        description: payload.description,
        runtime_label: payload.runtime_label,
        start_date: payload.start_date,
        end_date: payload.end_date,
      })
      .select("id, name, location, runtime_label")
      .single();
    created = fallback;
  }

  if (created.error || !created.data?.id) {
    throw new Error(created.error?.message ?? "Projekt konnte nicht angelegt werden.");
  }

  return {
    id: String(created.data.id),
    name: String(created.data.name ?? payload.name),
    location: String(created.data.location ?? payload.location),
    runtimeLabel: normalizeText(created.data.runtime_label as string) || runtimeLabel,
    state: payload.state ?? undefined,
    objectType: payload.object_type ?? undefined,
    notes: payload.description ?? undefined,
    serviceAddress: payload.site_address ?? undefined,
  };
}

async function createOffer(params: {
  supabase: SupabaseClient;
  tenantId: string;
  customerId: string;
  projectId: string;
  mode: OfferMode;
  serviceType: QuoteServiceType;
  generatedText: string;
  conceptText: string;
  finalText: string;
  aiInputSummary?: string;
  marginTarget?: number;
  tariffContext?: TariffContext;
  state?: string;
  wageGroup?: string;
  dutyDurationHours?: number;
  employerFactor?: number;
  timeModel?: TariffTimeModel;
  plannerOutput?: {
    cameras?: number;
    towers?: number;
    recorders?: number;
    switches?: number;
    obstacles?: number;
  };
  calculationSnapshot?: Record<string, unknown>;
  tariffSnapshot?: Record<string, unknown>;
  patrolSnapshot?: Record<string, unknown>;
  validUntil: string;
  built: ReturnType<typeof buildOfferDraft>;
}): Promise<{ id: string; number: string | null }> {
  const { supabase, tenantId, built } = params;
  const quoteNumberResult = await supabase.rpc("next_quote_number", { p_tenant_id: tenantId });
  const quoteNumber =
    !quoteNumberResult.error && typeof quoteNumberResult.data === "string"
      ? quoteNumberResult.data
      : null;

  const quotePayload = {
    tenant_id: tenantId,
    number: quoteNumber,
    customer_id: params.customerId,
    project_id: params.projectId,
    mode: params.mode,
    service_type: params.serviceType,
    tariff_context: params.tariffContext ?? null,
    state: normalizeText(params.state) || null,
    wage_group: normalizeText(params.wageGroup) || null,
    duty_duration_hours: Number.isFinite(params.dutyDurationHours) ? Number(params.dutyDurationHours) : null,
    employer_factor: Number.isFinite(params.employerFactor) ? Number(params.employerFactor) : null,
    time_model: params.timeModel ?? null,
    planner_camera_count: Number.isFinite(params.plannerOutput?.cameras) ? Number(params.plannerOutput?.cameras) : 0,
    planner_tower_count: Number.isFinite(params.plannerOutput?.towers) ? Number(params.plannerOutput?.towers) : 0,
    planner_recorder_count: Number.isFinite(params.plannerOutput?.recorders) ? Number(params.plannerOutput?.recorders) : 0,
    planner_switch_count: Number.isFinite(params.plannerOutput?.switches) ? Number(params.plannerOutput?.switches) : 0,
    planner_obstacle_count: Number.isFinite(params.plannerOutput?.obstacles) ? Number(params.plannerOutput?.obstacles) : 0,
    calculation_snapshot: params.calculationSnapshot ?? null,
    monthly_amount: built.totals.monthlyTotal,
    one_time_amount: built.totals.oneTimeTotal,
    net_total: built.totals.totalNet,
    gross_total: built.totals.totalGross,
    status: "draft",
    positions: built.lineItems,
    pricing: {
      monthlyTotal: built.totals.monthlyTotal,
      oneTimeTotal: built.totals.oneTimeTotal,
      subtotal: built.totals.subtotal,
      netTotal: built.totals.totalNet,
      grossTotal: built.totals.totalGross,
      discountAmount: built.totals.discountAmount,
      vatRate: built.totals.vatRate,
    },
    generated_text: params.generatedText,
    concept_text: params.conceptText,
    final_text: params.finalText,
    valid_until: params.validUntil,
    margin_target: Number.isFinite(params.marginTarget) ? Number(params.marginTarget) : null,
    subtotal_net: built.totals.totalNet,
    vat_amount: Number((built.totals.totalGross - built.totals.totalNet).toFixed(2)),
    total_gross: built.totals.totalGross,
    pdf_storage_path: null,
    pdf_public_url: null,
    pdf_path: null,
    tariff_snapshot: params.tariffSnapshot ?? null,
    patrol_snapshot: params.patrolSnapshot ?? null,
    ai_input_summary: params.aiInputSummary ?? null,
  };

  let created = await supabase
    .from("quotes")
    .insert(quotePayload)
    .select("id, number")
    .single();

  if (created.error && isLegacyQuotesColumnError(created.error.message)) {
    const fallback = await supabase
      .from("quotes")
      .insert({
        ...quotePayload,
        mode: undefined,
        final_text: undefined,
        margin_target: undefined,
        subtotal_net: undefined,
        vat_amount: undefined,
        total_gross: undefined,
        pdf_storage_path: undefined,
        pdf_public_url: undefined,
        tariff_context: undefined,
        state: undefined,
        wage_group: undefined,
        duty_duration_hours: undefined,
        employer_factor: undefined,
        time_model: undefined,
        planner_camera_count: undefined,
        planner_tower_count: undefined,
        planner_recorder_count: undefined,
        planner_switch_count: undefined,
        planner_obstacle_count: undefined,
        calculation_snapshot: undefined,
        monthly_amount: undefined,
        one_time_amount: undefined,
        net_total: undefined,
        gross_total: undefined,
        pdf_path: undefined,
        tariff_snapshot: undefined,
        patrol_snapshot: undefined,
      })
      .select("id, number")
      .single();
    created = fallback;
  }

  if (created.error || !created.data?.id) {
    throw new Error(created.error?.message ?? "Angebot konnte nicht gespeichert werden.");
  }

  return {
    id: String(created.data.id),
    number: typeof created.data.number === "string" ? created.data.number : quoteNumber,
  };
}

function buildFinalOfferText(input: {
  contactName?: string;
  generatedText: string;
  closingText: string;
}): string {
  const salutation = normalizeText(input.contactName)
    ? `Guten Tag ${normalizeText(input.contactName)},`
    : "Sehr geehrte Damen und Herren,";
  const body = normalizeText(input.generatedText);
  const closing = normalizeText(input.closingText) || "Mit freundlichen Grüßen";
  return [salutation, "", body, "", closing].filter((line) => line.length > 0).join("\n");
}

async function saveOfferItems(
  supabase: SupabaseClient,
  tenantId: string,
  quoteId: string,
  lineItems: QuoteLineItem[]
): Promise<void> {
  const items = lineItems.map((item, index) => ({
    tenant_id: tenantId,
    quote_id: quoteId,
    position: index + 1,
    title: normalizeText(item.label) || `Position ${index + 1}`,
    description: normalizeText(item.description) || null,
    unit: normalizeText(item.unit) || "Stk",
    quantity: Number.isFinite(item.quantity) ? Number(item.quantity) : 0,
    unit_price_net: Number.isFinite(item.unitPrice) ? Number(item.unitPrice) : 0,
    total_price_net: Number.isFinite(item.totalPrice) ? Number(item.totalPrice) : 0,
    metadata: item.metadata ?? {},
  }));

  if (items.length === 0) {
    return;
  }

  const { error } = await supabase.from("offer_items").insert(items);
  if (
    error
    && !error.message.includes("relation \"offer_items\" does not exist")
    && !error.message.includes("Could not find the table")
  ) {
    throw new Error(error.message);
  }
}

async function resolveSignerName(
  supabase: SupabaseClient,
  tenantId: string,
  settings: CompanySettings | null
): Promise<string> {
  const userResult = await supabase.auth.getUser();
  const authUser = userResult.data.user;
  const userId = authUser?.id;

  if (userId) {
    const tenantUserResult = await supabase
      .from("tenant_users")
      .select("full_name")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!tenantUserResult.error && typeof tenantUserResult.data?.full_name === "string" && tenantUserResult.data.full_name.trim()) {
      return tenantUserResult.data.full_name.trim();
    }
  }

  const metadata = authUser?.user_metadata as Record<string, unknown> | undefined;
  const metadataName = typeof metadata?.full_name === "string" && metadata.full_name.trim()
    ? metadata.full_name.trim()
    : typeof metadata?.name === "string" && metadata.name.trim()
      ? metadata.name.trim()
      : "";
  if (metadataName) {
    return metadataName;
  }

  if (settings?.contactPerson?.trim()) {
    return settings.contactPerson.trim();
  }

  if (settings?.companyName?.trim()) {
    return settings.companyName.trim();
  }

  return "ViorAI";
}

async function generateOfferPdf(
  supabase: SupabaseClient,
  input: QuickCreateContext
): Promise<{ pdfBytes: Uint8Array; fileName: string }> {
  const quoteNumber = input.quoteNumber ?? `AN-${new Date().getFullYear()}-${input.quoteId.slice(0, 6).toUpperCase()}`;
  const signerName = await resolveSignerName(supabase, input.tenantId, input.settings);
  const pdfBytes = await generateQuotePdf({
    quoteNumber,
    issueDate: new Date().toISOString().slice(0, 10),
    validUntil: input.validUntil,
    notes: input.project.notes,
    customer: {
      customerId: input.customer.id,
      name: input.customer.companyName,
      contactPerson: input.customer.contactName,
      address: input.customer.billingAddress ?? input.customer.address,
      email: input.customer.email,
      phone: input.customer.phone,
    },
    project: {
      name: input.project.name,
      location: input.project.serviceAddress ?? input.project.location,
      durationMonths: input.built.totals.durationMonths,
    },
    towers: [],
    lineItems: input.built.lineItems,
    monthlyTotal: input.built.totals.monthlyTotal,
    oneTimeTotal: input.built.totals.oneTimeTotal,
    subtotal: input.built.totals.subtotal,
    discountAmount: input.built.totals.discountAmount,
    totalNet: input.built.totals.totalNet,
    totalGross: input.built.totals.totalGross,
    vatRate: input.built.totals.vatRate,
    generatedText: input.generatedText,
    conceptText: input.conceptText,
    signerName,
  });

  const fileName = buildQuotePdfFileName({
    quoteNumber,
    customerName: input.customer.companyName,
    projectName: input.project.name,
  });

  return { pdfBytes, fileName };
}

async function storeOfferPdf(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    quoteId: string;
    fileName: string;
    pdfBytes: Uint8Array;
  }
): Promise<{ storagePath?: string; publicUrl?: string }> {
  const storagePath = `${input.tenantId}/${input.quoteId}/${input.fileName}`;
  const uploadResult = await supabase.storage
    .from("quote-pdfs")
    .upload(storagePath, input.pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadResult.error) {
    if (
      uploadResult.error.message.includes("Bucket not found")
      || uploadResult.error.message.includes("row-level security")
    ) {
      return {};
    }
    throw new Error(uploadResult.error.message);
  }

  const publicResult = supabase.storage.from("quote-pdfs").getPublicUrl(storagePath);
  const publicUrl = publicResult.data?.publicUrl;
  return {
    storagePath,
    publicUrl: typeof publicUrl === "string" && publicUrl.length > 0 ? publicUrl : undefined,
  };
}

async function attachPdfToOffer(
  supabase: SupabaseClient,
  input: { quoteId: string; tenantId: string; storagePath?: string; publicUrl?: string }
): Promise<void> {
  const { error } = await supabase
    .from("quotes")
    .update({
      pdf_storage_path: input.storagePath ?? null,
      pdf_public_url: input.publicUrl ?? null,
      pdf_path: input.storagePath ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.quoteId)
    .eq("tenant_id", input.tenantId);

  if (
    error
    && !error.message.includes("column quotes.pdf_storage_path does not exist")
    && !error.message.includes("column quotes.pdf_public_url does not exist")
    && !error.message.includes("column quotes.pdf_path does not exist")
  ) {
    throw new Error(error.message);
  }
}

async function updateOfferPipelineData(
  supabase: SupabaseClient,
  input: QuickCreateContext,
  marginTarget: number | undefined
): Promise<void> {
  const payload = {
    final_text: input.finalText,
    subtotal_net: input.built.totals.totalNet,
    vat_amount: Number((input.built.totals.totalGross - input.built.totals.totalNet).toFixed(2)),
    total_gross: input.built.totals.totalGross,
    margin_target: Number.isFinite(marginTarget) ? marginTarget : input.mode === "quick" ? 0.2 : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("quotes")
    .update(payload)
    .eq("id", input.quoteId)
    .eq("tenant_id", input.tenantId);

  if (
    error
    && !error.message.includes("column quotes.final_text does not exist")
    && !error.message.includes("column quotes.subtotal_net does not exist")
    && !error.message.includes("column quotes.vat_amount does not exist")
    && !error.message.includes("column quotes.total_gross does not exist")
    && !error.message.includes("column quotes.margin_target does not exist")
  ) {
    throw new Error(error.message);
  }
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const supabase = getSupabaseServerClient(authHeader);
    const body = (await request.json()) as QuickCreateRequestBody;

    if (!isQuoteServiceType(body.offer?.serviceType)) {
      return Response.json({ error: "Leistungsart ist ungültig." }, { status: 400 });
    }

    const tenantId = await resolveTenantId(supabase);
    const customer = await upsertCustomer(supabase, tenantId, body.customer);
    const project = await createProject(supabase, tenantId, customer.id, body.project);
    const [settings, tariffDataset] = await Promise.all([
      loadCompanySettings(supabase, tenantId),
      loadTariffDataset(supabase),
    ]);
    const mode: OfferMode =
      body.offer.mode === "standard" || body.offer.mode === "manual" ? body.offer.mode : "quick";
    const projectRuntimeMonths = parseRuntimeMonths(project.runtimeLabel);
    const targetMargin = parseTargetMargin(body.offer.targetMargin);
    const timeModel = parseTimeModel(body.offer.timeModel);
    const runtimeMode = parseRuntimeMode(body.offer.runtimeMode);
    const runtimeMonths = runtimeMode === "fixed"
      ? (Number.isFinite(body.offer.runtimeMonths) ? Math.max(1, Math.round(Number(body.offer.runtimeMonths))) : projectRuntimeMonths)
      : 1;
    const runtimeLabel = normalizeText(body.offer.runtimeLabel)
      || (runtimeMode === "fixed" ? `${runtimeMonths} Monate` : "Bis auf Widerruf");
    const shouldUseIntegratedEngine =
      mode === "quick"
      && (
        normalizeText(project.state).length > 0
        || body.offer.targetMargin !== undefined
        || body.offer.timeModel !== undefined
        || body.offer.employeeCount !== undefined
        || body.offer.runtimeMode !== undefined
        || body.offer.plannerOutput !== undefined
      );

    const integratedDraft = shouldUseIntegratedEngine
      ? buildIntegratedOfferDraft({
          serviceType: body.offer.serviceType,
          state: normalizeText(project.state) || "Nordrhein-Westfalen",
          runtimeMode,
          runtimeMonths,
          runtimeLabel,
          employeeCount: Number.isFinite(body.offer.employeeCount) ? Number(body.offer.employeeCount) : 1,
          targetMargin,
          timeModel,
          serviceAddress: project.serviceAddress ?? project.location,
          customerName: customer.companyName,
          projectName: project.name,
          notes: project.notes,
          settings,
          includePlannerOutput: body.offer.includePlannerOutput === true,
          plannerOutput: body.offer.includePlannerOutput === true ? body.offer.plannerOutput : undefined,
          discountAmount: 0,
          tariffDataset,
          tariffContext: body.offer.tariffContext,
          serviceContext: body.offer.serviceContext,
          wageGroup: body.offer.wageGroup,
          dutyDurationHours: Number.isFinite(body.offer.dutyDurationHours) ? Number(body.offer.dutyDurationHours) : undefined,
          shiftStartIso: body.offer.shiftStartIso,
          shiftEndIso: body.offer.shiftEndIso,
          employerCostFactor: Number.isFinite(body.offer.employerCostFactor) ? Number(body.offer.employerCostFactor) : undefined,
          patrolInput: body.offer.patrolInput,
        })
      : null;

    const built = integratedDraft
      ? {
          mode,
          serviceType: body.offer.serviceType,
          lineItems: integratedDraft.lineItems,
          totals: integratedDraft.totals,
        }
      : buildOfferDraft({
          mode,
          serviceType: body.offer.serviceType,
          quickTemplateId: body.offer.quickTemplateId,
          settings,
          durationMonths: runtimeMonths,
          discountAmount: 0,
        });

    const durationLabel = project.runtimeLabel || "Bis auf Widerruf";
    const serviceTypeLabel = body.offer.serviceType;
    let generatedText = integratedDraft?.text.combined ?? buildFallbackText({
      customerName: customer.companyName,
      projectName: project.name,
      location: project.location,
      serviceTypeLabel,
      runtimeLabel: durationLabel,
    });

    if (body.offer.autoGenerateText !== false) {
      try {
        generatedText = await generateOfferTextWithDeepSeek({
          customerName: customer.companyName,
          projectName: project.name,
          location: project.location,
          serviceType: serviceTypeLabel,
          duration: durationLabel,
          positions: built.lineItems,
          additionalNotes: normalizeText(body.project.notes),
          companyName: settings?.companyName,
          paymentTerms: settings?.paymentTerms,
          companyIntroText: settings?.introText,
          companyClosingText: settings?.closingText,
        });
      } catch {
        // Fallback-Text wird bereits gesetzt.
      }
    }

    const conceptText = settings?.closingText?.trim() || "Mit freundlichen Grüßen";
    const finalText = buildFinalOfferText({
      contactName: customer.contactName,
      generatedText,
      closingText: conceptText,
    });
    const aiInputSummary = integratedDraft
      ? JSON.stringify({
          engine: "integrated",
          decisions: integratedDraft.decisions,
          tariff: integratedDraft.tariff,
          techSetup: integratedDraft.techSetup,
        })
      : null;
    const validityDays = Number(settings?.defaultValidityDays ?? 14);
    const validUntil = new Date(
      Date.now() + Math.max(1, Number.isFinite(validityDays) ? validityDays : 14) * 24 * 60 * 60 * 1000
    ).toISOString().slice(0, 10);
    const quote = await createOffer({
      supabase,
      tenantId,
      customerId: customer.id,
      projectId: project.id,
      mode,
      serviceType: body.offer.serviceType,
      generatedText,
      conceptText,
      finalText,
      aiInputSummary: aiInputSummary ?? undefined,
      marginTarget: shouldUseIntegratedEngine ? targetMargin : undefined,
      tariffContext: body.offer.tariffContext,
      state: normalizeText(project.state),
      wageGroup: body.offer.wageGroup,
      dutyDurationHours: body.offer.dutyDurationHours,
      employerFactor: body.offer.employerCostFactor,
      timeModel,
      plannerOutput: body.offer.includePlannerOutput === true ? body.offer.plannerOutput : undefined,
      calculationSnapshot: integratedDraft
        ? {
            totals: integratedDraft.totals,
            tariff: integratedDraft.tariff,
            techSetup: integratedDraft.techSetup,
            decisions: integratedDraft.decisions,
            patrol: integratedDraft.patrol,
          }
        : {
            totals: built.totals,
          },
      tariffSnapshot: integratedDraft?.tariffSnapshot as Record<string, unknown> | undefined,
      patrolSnapshot: integratedDraft?.patrol as unknown as Record<string, unknown> | undefined,
      validUntil,
      built,
    });

    await saveOfferItems(supabase, tenantId, quote.id, built.lineItems);
    const quickCreateContext: QuickCreateContext = {
      tenantId,
      quoteId: quote.id,
      quoteNumber: quote.number,
      validUntil,
      mode,
      serviceType: body.offer.serviceType,
      generatedText,
      conceptText,
      finalText,
      customer,
      project,
      built,
      settings,
    };

    const pdfData = await generateOfferPdf(supabase, quickCreateContext);
    const pdf = await storeOfferPdf(supabase, {
      tenantId,
      quoteId: quote.id,
      fileName: pdfData.fileName,
      pdfBytes: pdfData.pdfBytes,
    });

    await attachPdfToOffer(supabase, {
      quoteId: quote.id,
      tenantId,
      storagePath: pdf.storagePath,
      publicUrl: pdf.publicUrl,
    });

    await updateOfferPipelineData(
      supabase,
      quickCreateContext,
      shouldUseIntegratedEngine ? targetMargin : undefined
    );

    return Response.json({
      quoteId: quote.id,
      quoteNumber: quote.number,
      customerId: customer.id,
      customer,
      projectId: project.id,
      project,
      status: "draft",
      totals: built.totals,
      generatedText,
      finalText,
      engine: integratedDraft
        ? {
            tariff: integratedDraft.tariff,
            techSetup: integratedDraft.techSetup,
            decisions: integratedDraft.decisions,
            text: integratedDraft.text,
            patrol: integratedDraft.patrol,
            tariffSnapshot: integratedDraft.tariffSnapshot,
          }
        : null,
      pdfPublicUrl: pdf.publicUrl,
      pdfStoragePath: pdf.storagePath,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Schnell-Angebot konnte nicht erstellt werden.",
      },
      { status: 500 }
    );
  }
}
