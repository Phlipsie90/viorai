"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { localCustomerRepository } from "@/features/customers/repository";
import { localProjectRepository } from "@/features/projects/repository";
import { QUOTE_SERVICE_TYPE_LABELS, type QuoteServiceType } from "@/features/quotes/service-types";
import { localQuoteRepository } from "@/features/quotes/repository";
import type { Customer, Project } from "@/types";
import type { Quote, QuoteStatus } from "@/features/quotes/types";
import { getSupabaseClient, getSupabaseUserSafe } from "@/lib/supabase/client";

const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Entwurf",
  sent: "Offen",
  accepted: "Gewonnen",
  rejected: "Abgelehnt",
};

const STATUS_CLASSNAMES: Record<QuoteStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-amber-100 text-amber-700",
  accepted: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
};

export default function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [greetingName, setGreetingName] = useState("Team");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedServiceType, setSelectedServiceType] = useState<QuoteServiceType | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const supabase = getSupabaseClient();
        const [{ data: userResult }, loadedQuotes, loadedCustomers, loadedProjects] = await Promise.all([
          getSupabaseUserSafe(supabase),
          localQuoteRepository.getAllQuotes(),
          localCustomerRepository.list(),
          localProjectRepository.list(),
        ]);

        if (!mounted) {
          return;
        }

        const metadata = userResult.user?.user_metadata as Record<string, unknown> | undefined;
        const fullName =
          (typeof metadata?.full_name === "string" && metadata.full_name.trim())
          || (typeof metadata?.name === "string" && metadata.name.trim())
          || (typeof metadata?.display_name === "string" && metadata.display_name.trim())
          || "";
        const emailName = userResult.user?.email?.split("@")[0] ?? "";
        const resolvedName = (fullName || emailName).split(" ")[0]?.trim();

        setGreetingName(resolvedName || "Team");
        setQuotes(loadedQuotes);
        setCustomers(loadedCustomers);
        setProjects(loadedProjects);
        setError(null);
      } catch (loadError) {
        if (!mounted) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "Dashboard konnte nicht geladen werden.");
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
  }, []);

  const customerNameById = useMemo(() => new Map(customers.map((item) => [item.id, item.companyName])), [customers]);
  const projectById = useMemo(() => new Map(projects.map((item) => [item.id, item])), [projects]);

  const serviceTypesWithQuotes = useMemo(() => {
    const unique = new Set<QuoteServiceType>();
    for (const quote of quotes) {
      if (quote.serviceType) {
        unique.add(quote.serviceType);
      }
    }

    return Array.from(unique);
  }, [quotes]);

  useEffect(() => {
    if (serviceTypesWithQuotes.length === 0) {
      setSelectedServiceType(null);
      return;
    }

    if (!selectedServiceType || !serviceTypesWithQuotes.includes(selectedServiceType)) {
      setSelectedServiceType(serviceTypesWithQuotes[0]);
    }
  }, [selectedServiceType, serviceTypesWithQuotes]);

  const filteredQuotes = useMemo(() => {
    if (!selectedServiceType) {
      return quotes;
    }

    return quotes.filter((quote) => quote.serviceType === selectedServiceType);
  }, [quotes, selectedServiceType]);

  const highlightedQuote = filteredQuotes[0] ?? quotes[0] ?? null;

  const openQuotesCount = useMemo(
    () => quotes.filter((quote) => quote.status === "draft" || quote.status === "sent").length,
    [quotes]
  );

  const acceptedThisMonth = useMemo(() => {
    const now = new Date();
    return quotes.filter((quote) => {
      if (quote.status !== "accepted") {
        return false;
      }

      const date = new Date(quote.updatedAt);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }).length;
  }, [quotes]);

  const revenueForecast = useMemo(
    () => quotes.filter((quote) => quote.status !== "rejected").reduce((sum, quote) => sum + quote.pricing.netTotal, 0),
    [quotes]
  );

  const latestQuotes = useMemo(() => quotes.slice(0, 5), [quotes]);

  if (isLoading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Dashboard wird geladen...</div>;
  }

  if (error) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">{error}</div>;
  }

  return (
    <div className="max-w-6xl space-y-5">
      <section className="rounded-2xl border border-[#eadfce] bg-[#f8f4ea] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-[34px] font-bold leading-tight text-[#172033]">Hallo {greetingName},</h2>
            <p className="text-[34px] font-bold leading-tight text-[#172033]">lass uns Angebote schreiben.</p>
          </div>
          <Link
            href="/planner?mode=schnellangebot&quelle=dashboard"
            className="inline-flex w-full items-center justify-center rounded-2xl bg-[var(--brand-accent)] px-6 py-4 text-base font-semibold text-white shadow-[0_18px_40px_rgba(249,115,22,0.28)] transition-transform hover:-translate-y-0.5 hover:bg-[var(--brand-accent-hover)] lg:w-auto"
          >
            Angebot in 2 Min erstellen
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate-600">Kunde wählen, Leistung auswählen, Angebot starten.</p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard
          label="Offene Angebote"
          value={openQuotesCount.toString()}
          dotClass="bg-amber-400"
          lineClass="stroke-amber-300"
          points="6,46 40,44 76,36 114,38 154,22"
        />
        <MetricCard
          label={`Gewonnen (${new Intl.DateTimeFormat("de-DE", { month: "long" }).format(new Date())})`}
          value={`${acceptedThisMonth}`}
          dotClass="bg-emerald-500"
          lineClass="stroke-emerald-500"
          points="6,46 34,40 66,40 92,24 118,27 152,12"
        />
        <MetricCard
          label="Umsatz-Prognose"
          value={formatEuro(revenueForecast)}
          dotClass="bg-blue-500"
          lineClass="stroke-blue-500"
          points="6,44 36,40 64,42 90,30 120,24 152,16"
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          {[
            { step: "1", title: "Kunde & Einsatzort", text: "Alle Pflichtdaten in einem Block" },
            { step: "2", title: "Leistung & Kalkulation", text: "Defaults laden und Preis automatisch berechnen" },
            { step: "3", title: "Angebot erstellen", text: "Text + PDF automatisch erzeugen" },
            { step: "4", title: "Fertig", text: "Speichern, bearbeiten, versenden" },
          ].map((item) => (
            <div key={item.step} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-accent)]">Schritt {item.step}</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{item.title}</p>
              <p className="mt-1 text-xs text-slate-600">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.7fr_1fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-xl font-semibold text-[#172033]">Aktuelle Angebote</h3>
          {latestQuotes.length === 0 ? (
            <p className="rounded-xl border border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
              Noch keine Angebote vorhanden.
            </p>
          ) : (
            <div className="space-y-2">
              {latestQuotes.map((quote) => {
                const project = projectById.get(quote.projectId);
                const serviceLabel = quote.serviceType ? QUOTE_SERVICE_TYPE_LABELS[quote.serviceType] : "Leistung";
                return (
                  <OfferRow
                    key={quote.id}
                    quoteId={quote.id}
                    number={quote.number ?? `Offer ${quote.id.slice(0, 6)}`}
                    title={`${project?.name ?? customerNameById.get(quote.customerId) ?? "Projekt"} (${serviceLabel})`}
                    price={formatEuro(quote.pricing.netTotal)}
                    badge={STATUS_LABELS[quote.status]}
                    badgeClass={STATUS_CLASSNAMES[quote.status]}
                    time={formatRelativeTime(quote.updatedAt)}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="mb-3 text-lg font-semibold text-[#172033]">Dienstleistung wählen</h4>
            {serviceTypesWithQuotes.length === 0 ? (
              <p className="text-sm text-slate-500">Noch keine Leistungen aus Angeboten vorhanden.</p>
            ) : (
              <div className="space-y-2">
                {serviceTypesWithQuotes.map((serviceType) => (
                  <ServiceButton
                    key={serviceType}
                    active={selectedServiceType === serviceType}
                    label={QUOTE_SERVICE_TYPE_LABELS[serviceType]}
                    onClick={() => setSelectedServiceType(serviceType)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="text-[32px] font-bold leading-none text-[#172033]">ViorAI</h4>
            {!highlightedQuote ? (
              <p className="mt-6 text-sm text-slate-500">Noch kein Angebot für die Detailansicht vorhanden.</p>
            ) : (
              <>
                <p className="mt-3 text-sm text-slate-500">Kunde</p>
                <p className="font-semibold text-[#172033]">
                  {customerNameById.get(highlightedQuote.customerId) ?? "Unbekannter Kunde"}
                </p>
                <p className="mt-2 text-sm text-slate-500">Service</p>
                <p className="font-semibold text-[#172033]">
                  {highlightedQuote.serviceType
                    ? QUOTE_SERVICE_TYPE_LABELS[highlightedQuote.serviceType]
                    : "Leistungsart nicht gesetzt"}
                </p>
                <div className="mt-4 h-2 rounded-full bg-slate-200">
                  <div className="h-2 rounded-full bg-[#e9ddcc]" style={{ width: `${Math.min(100, Math.max(20, (highlightedQuote.pricing.netTotal / Math.max(revenueForecast, 1)) * 100))}%` }} />
                </div>
                <p className="mt-4 text-sm text-slate-500">
                  Dauer: <span className="font-semibold text-[#172033]">{resolveDurationLabel(projectById.get(highlightedQuote.projectId)?.runtimeLabel)}</span>
                </p>
                <p className="text-sm text-slate-500">
                  Positionen: <span className="font-semibold text-[#172033]">{highlightedQuote.positions.length}</span>
                </p>
                <p className="text-sm text-slate-500">
                  Preis: <span className="font-semibold text-[#172033]">{formatEuro(highlightedQuote.pricing.netTotal)}</span>
                </p>
              </>
            )}
          </div>
        </div>

        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <h4 className="text-lg font-semibold text-[#172033]">Warum ViorAI?</h4>
          {[
            "Blitzschnelle Angebotserstellung in unter 2 Minuten",
            "Kalkulation mit Standardwerten pro Leistungsart",
            "Strukturierte Angebotstexte ohne KI-Floskeln",
            "Professioneller PDF-Output für echte Kundentermine",
            "Alles zentral: Kunde, Projekt, Angebot und Dokument",
          ].map((item, index) => (
            <div key={item} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-semibold text-[var(--brand-accent)]">#{index + 1}</p>
              <p className="mt-1 text-sm text-slate-700">{item}</p>
            </div>
          ))}
          <div className="rounded-xl bg-slate-900 px-3 py-2 text-white">
            <p className="text-xs uppercase tracking-wide text-slate-300">Heute</p>
            <p className="mt-1 text-sm font-semibold">{openQuotesCount} offene Angebote im Fokus</p>
          </div>
        </aside>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  dotClass,
  lineClass,
  points,
}: {
  label: string;
  value: string;
  dotClass: string;
  lineClass: string;
  points: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[#172033]">{label}</h3>
        <span className={`h-3.5 w-3.5 rounded-full ${dotClass}`} />
      </div>
      <p className="mt-1 text-5xl font-bold leading-none text-[#172033]">{value}</p>
      <svg viewBox="0 0 160 52" className="mt-4 h-10 w-full">
        <polyline fill="none" strokeWidth="3" strokeLinecap="round" className={lineClass} points={points} />
      </svg>
    </article>
  );
}

function OfferRow({
  quoteId,
  number,
  title,
  price,
  badge,
  badgeClass,
  time,
}: {
  quoteId: string;
  number: string;
  title: string;
  price: string;
  badge: string;
  badgeClass: string;
  time: string;
}) {
  return (
    <Link href={`/quotes/${quoteId}`} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 hover:bg-slate-50">
      <div className="h-10 w-10 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 flex items-center justify-center">
        PDF
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[#172033]">{number}</p>
        <p className="truncate text-sm text-slate-500">{title}</p>
      </div>
      <p className="text-sm font-semibold text-[#172033]">{price}</p>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass}`}>{badge}</span>
      <p className="text-xs text-slate-500">{time}</p>
    </Link>
  );
}

function ServiceButton({
  label,
  active = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
        active
          ? "border-[var(--brand-accent)] bg-orange-50 text-[var(--brand-accent)]"
          : "border-slate-200 bg-white text-[#172033] hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );
}

function formatEuro(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const minutes = Math.max(1, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) {
    return `vor ${minutes} Min.`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `vor ${hours} Std.`;
  }

  const days = Math.floor(hours / 24);
  if (days === 1) {
    return "gestern";
  }

  return `vor ${days} Tagen`;
}

function resolveDurationLabel(runtimeLabel?: string): string {
  if (!runtimeLabel || runtimeLabel.trim().length === 0) {
    return "nicht gesetzt";
  }

  return runtimeLabel;
}
