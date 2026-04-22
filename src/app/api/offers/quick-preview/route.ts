import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildIntegratedOfferDraft, type RuntimeMode, type TariffTimeModel } from "@/features/offers/integrated-engine";
import type { CompanySettings } from "@/features/company-settings/types";
import { isQuoteServiceType, type QuoteServiceType } from "@/features/quotes/service-types";
import { loadTariffDataset, type TariffContext } from "@/lib/tariff/engine";
import { listPatrolProfiles, type PatrolInput } from "@/lib/patrol/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface QuickPreviewRequestBody {
  customerName: string;
  projectName: string;
  serviceAddress: string;
  state: string;
  serviceType: QuoteServiceType;
  runtimeMonths?: number;
  runtimeMode?: RuntimeMode;
  runtimeLabel?: string;
  employeeCount?: number;
  targetMargin: number;
  timeModel: TariffTimeModel;
  notes?: string;
  tariffContext?: TariffContext;
  serviceContext?: string;
  wageGroup?: string;
  dutyDurationHours?: number;
  shiftStartIso?: string;
  shiftEndIso?: string;
  employerCostFactor?: number;
  includePlannerOutput?: boolean;
  plannerOutput?: {
    cameras?: number;
    towers?: number;
    recorders?: number;
    switches?: number;
    obstacles?: number;
  };
  patrolInput?: PatrolInput;
}

function normalizeText(value?: string | null): string {
  return (value ?? "").trim();
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

async function resolveTenantId(supabase: SupabaseClient): Promise<string | null> {
  const rpcResult = await supabase.rpc("resolve_localhost_tenant_context");
  if (!rpcResult.error && typeof rpcResult.data === "string" && rpcResult.data.length > 0) {
    return rpcResult.data;
  }

  const userResult = await supabase.auth.getUser();
  const userId = userResult.data.user?.id;
  if (!userId) {
    return null;
  }

  const tenantResult = await supabase
    .from("tenant_users")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return tenantResult.data?.tenant_id ?? null;
}

async function loadCompanySettings(supabase: SupabaseClient, tenantId: string | null): Promise<CompanySettings | null> {
  if (!tenantId) {
    return null;
  }

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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as QuickPreviewRequestBody;

    if (!isQuoteServiceType(body.serviceType)) {
      return Response.json({ error: "Leistungsart ist ungültig." }, { status: 400 });
    }

    const authHeader = request.headers.get("authorization");
    const supabase = getSupabaseServerClient(authHeader);
    const tenantId = await resolveTenantId(supabase);

    const [settings, tariffDataset] = await Promise.all([
      loadCompanySettings(supabase, tenantId),
      loadTariffDataset(supabase),
    ]);

    const draft = buildIntegratedOfferDraft({
      serviceType: body.serviceType,
      state: normalizeText(body.state) || "Nordrhein-Westfalen",
      runtimeMode: body.runtimeMode === "fixed" ? "fixed" : "until_revocation",
      runtimeMonths: Number.isFinite(body.runtimeMonths) ? Math.max(1, Math.round(Number(body.runtimeMonths))) : undefined,
      runtimeLabel: normalizeText(body.runtimeLabel) || undefined,
      employeeCount: Number.isFinite(body.employeeCount) ? Math.max(1, Math.round(Number(body.employeeCount))) : 1,
      targetMargin: Number.isFinite(body.targetMargin) ? body.targetMargin : 0.22,
      timeModel: body.timeModel,
      serviceAddress: normalizeText(body.serviceAddress) || "Einsatzort",
      customerName: normalizeText(body.customerName) || "Kunde",
      projectName: normalizeText(body.projectName) || "Sicherheitsprojekt",
      notes: body.notes,
      settings,
      includePlannerOutput: body.includePlannerOutput === true,
      plannerOutput: body.includePlannerOutput === true ? body.plannerOutput : undefined,
      discountAmount: 0,
      tariffDataset,
      tariffContext: body.tariffContext,
      serviceContext: body.serviceContext,
      wageGroup: body.wageGroup,
      dutyDurationHours: Number.isFinite(body.dutyDurationHours) ? Number(body.dutyDurationHours) : undefined,
      shiftStartIso: body.shiftStartIso,
      shiftEndIso: body.shiftEndIso,
      employerCostFactor: Number.isFinite(body.employerCostFactor) ? Number(body.employerCostFactor) : undefined,
      patrolInput: body.patrolInput,
    });

    const tariffStates = Array.from(new Set(
      tariffDataset.entries
        .map((entry) => entry.state)
        .filter((state) => state !== "all")
    )).sort();

    return Response.json({
      draft,
      tariffStates,
      patrolProfiles: listPatrolProfiles(),
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Vorschau konnte nicht berechnet werden.",
      },
      { status: 500 }
    );
  }
}
