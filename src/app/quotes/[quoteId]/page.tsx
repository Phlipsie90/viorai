"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { localQuoteRepository } from "@/features/quotes/repository";
import { localCustomerRepository } from "@/features/customers/repository";
import { localProjectRepository } from "@/features/projects/repository";
import { QUOTE_SERVICE_TYPE_LABELS } from "@/features/quotes/service-types";
import type { Quote, QuoteStatus } from "@/features/quotes/types";
import type { Customer, Project } from "@/types";
import { getSupabaseClient, getSupabaseSessionSafe } from "@/lib/supabase/client";

const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Entwurf",
  sent: "Gesendet",
  accepted: "Gewonnen",
  rejected: "Verloren",
};

export default function QuoteDetailPage() {
  const params = useParams<{ quoteId: string }>();
  const router = useRouter();
  const quoteId = params?.quoteId;
  const [quote, setQuote] = useState<Quote | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const totalItems = quote?.positions.length ?? 0;
  const serviceLabel = quote?.serviceType ? QUOTE_SERVICE_TYPE_LABELS[quote.serviceType] : "Nicht gesetzt";

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!quoteId) {
        setError("Angebot-ID fehlt.");
        setIsLoading(false);
        return;
      }
      try {
        const loadedQuote = await localQuoteRepository.getQuoteById(quoteId);
        if (!loadedQuote) {
          throw new Error("Angebot wurde nicht gefunden.");
        }
        const [loadedCustomer, loadedProject] = await Promise.all([
          localCustomerRepository.get(loadedQuote.customerId),
          localProjectRepository.list().then((items) => items.find((item) => item.id === loadedQuote.projectId) ?? null),
        ]);
        if (!mounted) {
          return;
        }
        setQuote(loadedQuote);
        setCustomer(loadedCustomer);
        setProject(loadedProject);
        setError(null);
      } catch (loadError) {
        if (!mounted) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Angebot konnte nicht geladen werden.");
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [quoteId]);

  const summaryRows = useMemo(() => {
    if (!quote) {
      return [];
    }

    return [
      { label: "Wiederkehrend", value: formatCurrency(quote.pricing.monthlyTotal) },
      { label: "Einmalig", value: formatCurrency(quote.pricing.oneTimeTotal) },
      { label: "Netto", value: formatCurrency(quote.pricing.netTotal) },
      { label: "Brutto", value: formatCurrency(quote.pricing.grossTotal) },
    ];
  }, [quote]);

  const handleDownloadPdf = async () => {
    if (!quoteId) {
      return;
    }
    try {
      if (quote?.pdfPublicUrl) {
        const anchor = document.createElement("a");
        anchor.href = quote.pdfPublicUrl;
        anchor.target = "_blank";
        anchor.rel = "noreferrer";
        anchor.download = `${quote.number ?? quote.id}.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        return;
      }

      const supabase = getSupabaseClient();
      const { data } = await getSupabaseSessionSafe(supabase);
      const token = data.session?.access_token;
      if (!token) {
        throw new Error("Session ist abgelaufen. Bitte erneut anmelden.");
      }

      const response = await fetch(`/api/offers/${quoteId}/pdf`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "PDF konnte nicht geladen werden.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${quote?.number ?? "angebot"}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setError(null);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "PDF konnte nicht geladen werden.");
    }
  };

  const handleEdit = async () => {
    if (!quote) {
      return;
    }
    await localProjectRepository.setSelectedProjectId(quote.projectId);
    router.push(`/planner?quoteId=${quote.id}`);
  };

  if (isLoading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Angebot wird geladen...</div>;
  }

  if (error || !quote) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">{error ?? "Angebot nicht verfügbar."}</div>
        <Button variant="secondary" onClick={() => router.push("/quotes")}>Zur Angebotsliste</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Angebot {quote.number ?? quote.id.slice(0, 8)}</h1>
            <p className="mt-1 text-sm text-slate-600">
              Kunde: {customer?.companyName ?? "Unbekannt"} | Projekt: {project?.name ?? "Unbekannt"} | Status: {STATUS_LABELS[quote.status]}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Ansprechpartner: {customer?.contactName ?? "—"} | Adresse: {[customer?.street, customer?.postalCode, customer?.city].filter((part) => !!part).join(", ") || customer?.address || "—"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleEdit}>Bearbeiten</Button>
            <Button onClick={handleDownloadPdf}>PDF herunterladen</Button>
            <Button variant="ghost" onClick={() => router.push("/quotes")}>Zurück</Button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Angebotstext</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {quote.finalText ?? quote.generatedText ?? "Kein Angebotstext vorhanden."}
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Zusammenfassung</h2>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <p>Leistung: <span className="font-semibold text-slate-900">{serviceLabel}</span></p>
            <p>Positionen: <span className="font-semibold text-slate-900">{totalItems}</span></p>
            <p>Laufzeit: <span className="font-semibold text-slate-900">{project?.runtimeLabel ?? "Bis auf Widerruf"}</span></p>
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5">
            {summaryRows.map((row) => (
              <p key={row.label} className="flex justify-between text-sm">
                <span className="text-slate-600">{row.label}</span>
                <span className="font-semibold text-slate-900">{row.value}</span>
              </p>
            ))}
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Positionen</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">Leistung</th>
                <th className="px-2 py-2 text-right">Menge</th>
                <th className="px-2 py-2">Einheit</th>
                <th className="px-2 py-2 text-right">Einzelpreis</th>
                <th className="px-2 py-2 text-right">Gesamt</th>
              </tr>
            </thead>
            <tbody>
              {quote.positions.map((item) => (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="px-2 py-2 text-slate-800">{item.label}</td>
                  <td className="px-2 py-2 text-right text-slate-700">{item.quantity}</td>
                  <td className="px-2 py-2 text-slate-700">{item.unit}</td>
                  <td className="px-2 py-2 text-right text-slate-700">{formatCurrency(item.unitPrice)}</td>
                  <td className="px-2 py-2 text-right font-semibold text-slate-900">{formatCurrency(item.totalPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}
