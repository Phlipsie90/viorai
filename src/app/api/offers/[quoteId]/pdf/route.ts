import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildQuotePdfFileName, generateQuotePdf } from "@/lib/pdf/generator";
import type { QuoteLineItem } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

function normalizeText(value?: string | null): string {
  return (value ?? "").trim();
}

function normalizeLineItems(input: unknown): QuoteLineItem[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const row = entry as Partial<QuoteLineItem>;
      return {
        id: typeof row.id === "string" ? row.id : crypto.randomUUID(),
        type: (row.type as QuoteLineItem["type"]) ?? "custom",
        label: typeof row.label === "string" ? row.label : "Position",
        description: typeof row.description === "string" ? row.description : undefined,
        quantity: Number.isFinite(row.quantity) ? Number(row.quantity) : 0,
        unit: typeof row.unit === "string" ? row.unit : "Stk",
        unitPrice: Number.isFinite(row.unitPrice) ? Number(row.unitPrice) : 0,
        totalPrice: Number.isFinite(row.totalPrice)
          ? Number(row.totalPrice)
          : Number((Number(row.quantity ?? 0) * Number(row.unitPrice ?? 0)).toFixed(2)),
        billingMode: row.billingMode === "recurring" ? "recurring" : "one_time",
        interval: (row.interval as QuoteLineItem["interval"]) ?? "once",
        category: typeof row.category === "string" ? row.category : "custom",
        metadata: row.metadata,
        stundenProTag: Number.isFinite(row.stundenProTag) ? Number(row.stundenProTag) : undefined,
        nachtStundenProTag: Number.isFinite(row.nachtStundenProTag) ? Number(row.nachtStundenProTag) : undefined,
        tageProMonat: Number.isFinite(row.tageProMonat) ? Number(row.tageProMonat) : undefined,
        tageSamstag: Number.isFinite(row.tageSamstag) ? Number(row.tageSamstag) : undefined,
        tageSonntag: Number.isFinite(row.tageSonntag) ? Number(row.tageSonntag) : undefined,
        tageFeiertag: Number.isFinite(row.tageFeiertag) ? Number(row.tageFeiertag) : undefined,
        preisProKontrolle: Number.isFinite(row.preisProKontrolle) ? Number(row.preisProKontrolle) : undefined,
        kontrollenProTagWerktag: Number.isFinite(row.kontrollenProTagWerktag) ? Number(row.kontrollenProTagWerktag) : undefined,
        kontrollenProTagSamstag: Number.isFinite(row.kontrollenProTagSamstag) ? Number(row.kontrollenProTagSamstag) : undefined,
        kontrollenProTagSonntag: Number.isFinite(row.kontrollenProTagSonntag) ? Number(row.kontrollenProTagSonntag) : undefined,
        kontrollenProTagFeiertag: Number.isFinite(row.kontrollenProTagFeiertag) ? Number(row.kontrollenProTagFeiertag) : undefined,
        nachtKontrollenProTag: Number.isFinite(row.nachtKontrollenProTag) ? Number(row.nachtKontrollenProTag) : undefined,
        kontrollenProTagWochenende: Number.isFinite(row.kontrollenProTagWochenende) ? Number(row.kontrollenProTagWochenende) : undefined,
        tageWerktage: Number.isFinite(row.tageWerktage) ? Number(row.tageWerktage) : undefined,
        tageWochenende: Number.isFinite(row.tageWochenende) ? Number(row.tageWochenende) : undefined,
        samstagZuschlagPercent: Number.isFinite(row.samstagZuschlagPercent) ? Number(row.samstagZuschlagPercent) : undefined,
        sonntagZuschlagPercent: Number.isFinite(row.sonntagZuschlagPercent) ? Number(row.sonntagZuschlagPercent) : undefined,
        feiertagZuschlagPercent: Number.isFinite(row.feiertagZuschlagPercent) ? Number(row.feiertagZuschlagPercent) : undefined,
        nachtZuschlagPercent: Number.isFinite(row.nachtZuschlagPercent) ? Number(row.nachtZuschlagPercent) : undefined,
      };
    });
}

function getFileNameForDownload(input: { quoteNumber: string; customerName: string; projectName: string }) {
  return buildQuotePdfFileName({
    quoteNumber: input.quoteNumber,
    customerName: input.customerName,
    projectName: input.projectName,
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ quoteId: string }> }
) {
  try {
    const { quoteId } = await context.params;
    if (!quoteId) {
      return Response.json({ error: "Angebot-ID fehlt." }, { status: 400 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return Response.json({ error: "Authentifizierung fehlt." }, { status: 401 });
    }

    const supabase = getSupabaseServerClient(authHeader);
    const tenantId = await resolveTenantId(supabase);
    const quoteResult = await supabase
      .from("quotes")
      .select("id, tenant_id, number, customer_id, project_id, positions, pricing, generated_text, concept_text, final_text, valid_until, pdf_storage_path, pdf_public_url")
      .eq("id", quoteId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (quoteResult.error || !quoteResult.data) {
      return Response.json({ error: quoteResult.error?.message ?? "Angebot nicht gefunden." }, { status: 404 });
    }

    const quote = quoteResult.data as Record<string, unknown>;
    const [customerResult, projectResult, companyResult] = await Promise.all([
      supabase.from("customers").select("id, company_name, contact_name, email, phone, address, billing_address").eq("id", String(quote.customer_id)).eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("projects").select("id, name, location, site_address, runtime_label").eq("id", String(quote.project_id)).eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("company_settings").select("company_name").eq("tenant_id", tenantId).maybeSingle(),
    ]);

    if (customerResult.error || !customerResult.data) {
      return Response.json({ error: customerResult.error?.message ?? "Kundendaten fehlen." }, { status: 400 });
    }
    if (projectResult.error || !projectResult.data) {
      return Response.json({ error: projectResult.error?.message ?? "Projektdaten fehlen." }, { status: 400 });
    }

    const quoteNumber = normalizeText(quote.number as string) || `AN-${new Date().getFullYear()}-${String(quote.id).slice(0, 6).toUpperCase()}`;
    const customer = customerResult.data as Record<string, unknown>;
    const project = projectResult.data as Record<string, unknown>;
    const fileName = getFileNameForDownload({
      quoteNumber,
      customerName: normalizeText(customer.company_name as string),
      projectName: normalizeText(project.name as string),
    });

    const storedPdfPath = normalizeText(quote.pdf_storage_path as string);
    if (storedPdfPath) {
      const stored = await supabase.storage.from("quote-pdfs").download(storedPdfPath);
      if (!stored.error && stored.data) {
        const bytes = new Uint8Array(await stored.data.arrayBuffer());
        return new Response(Buffer.from(bytes), {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename=\"${fileName}\"`,
          },
        });
      }
    }

    const lineItems = normalizeLineItems(quote.positions);
    if (lineItems.length === 0) {
      return Response.json({ error: "Keine Positionen für PDF vorhanden." }, { status: 400 });
    }

    const pricing = (quote.pricing ?? {}) as Record<string, unknown>;
    const issueDate = new Date().toISOString().slice(0, 10);
    const company = companyResult.data as Record<string, unknown> | null;
    const pdfBytes = await generateQuotePdf({
      quoteNumber,
      issueDate,
      validUntil: normalizeText(quote.valid_until as string) || undefined,
      notes: undefined,
      customer: {
        customerId: String(customer.id),
        name: normalizeText(customer.company_name as string),
        contactPerson: normalizeText(customer.contact_name as string) || undefined,
        address: normalizeText((customer.billing_address as string) || (customer.address as string)) || undefined,
        email: normalizeText(customer.email as string) || undefined,
        phone: normalizeText(customer.phone as string) || undefined,
      },
      project: {
        name: normalizeText(project.name as string),
        location: normalizeText((project.site_address as string) || (project.location as string)),
        durationMonths: 1,
      },
      towers: [],
      lineItems,
      monthlyTotal: Number(pricing.monthlyTotal ?? 0),
      oneTimeTotal: Number(pricing.oneTimeTotal ?? 0),
      subtotal: Number(pricing.subtotal ?? 0),
      discountAmount: Number(pricing.discountAmount ?? 0),
      totalNet: Number(pricing.netTotal ?? 0),
      totalGross: Number(pricing.grossTotal ?? 0),
      vatRate: Number(pricing.vatRate ?? 0.19),
      generatedText: normalizeText((quote.final_text as string) || (quote.generated_text as string)),
      conceptText: normalizeText(quote.concept_text as string) || "Mit freundlichen Grüßen",
      signerName: normalizeText(company?.company_name as string) || "ViorAI",
    });

    const storagePath = `${tenantId}/${quoteId}/${fileName}`;
    await supabase.storage.from("quote-pdfs").upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    const publicResult = supabase.storage.from("quote-pdfs").getPublicUrl(storagePath);

    await supabase
      .from("quotes")
      .update({
        pdf_storage_path: storagePath,
        pdf_public_url: publicResult.data?.publicUrl ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", quoteId)
      .eq("tenant_id", tenantId);

    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename=\"${fileName}\"`,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "PDF konnte nicht erstellt werden." },
      { status: 500 }
    );
  }
}
