"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseClient, getSupabaseUserSafe } from "@/lib/supabase/client";
import { localQuoteRepository } from "@/features/quotes/repository";
import { localCustomerRepository } from "@/features/customers/repository";
import { localProjectRepository } from "@/features/projects/repository";
import { QUOTE_SERVICE_TYPE_LABELS } from "@/features/quotes/service-types";
import type { Quote, QuoteStatus } from "@/features/quotes/types";
import type { Customer, Project } from "@/types";

const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Entwurf",
  sent: "Gesendet",
  accepted: "Gewonnen",
  rejected: "Verloren",
};

const STATUS_BADGE_CLASS: Record<QuoteStatus, string> = {
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
          || userResult.user?.email
          || "Team";
        setGreetingName(fullName.split(" ")[0] || "Team");
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

  const customerById = useMemo(() => new Map(customers.map((item) => [item.id, item])), [customers]);
  const projectById = useMemo(() => new Map(projects.map((item) => [item.id, item])), [projects]);

  const kpis = useMemo(() => {
    const openOffers = quotes.filter((quote) => quote.status === "draft" || quote.status === "sent").length;
    const wonOffers = quotes.filter((quote) => quote.status === "accepted").length;
    const monthlyPotential = quotes
      .filter((quote) => quote.status !== "rejected")
      .reduce((sum, quote) => sum + quote.pricing.monthlyTotal, 0);
    const conversionRate = quotes.length > 0 ? (wonOffers / quotes.length) * 100 : 0;

    return {
      openOffers,
      wonOffers,
      monthlyPotential,
      conversionRate,
    };
  }, [quotes]);

  const latestQuotes = useMemo(() => quotes.slice(0, 6), [quotes]);

  if (isLoading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Dashboard wird geladen...</div>;
  }

  if (error) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">{error}</div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div className="space-y-4">
            <p className="text-sm font-medium text-slate-500">Dashboard</p>
            <h1 className="text-4xl font-bold leading-tight text-slate-900">
              Angebote in <span className="text-[var(--brand-accent)]">2 Minuten</span> erstellen.
            </h1>
            <p className="max-w-2xl text-sm text-slate-600">
              Hallo {greetingName}, starte direkt in den Schnellangebot-Flow. Kunde, Einsatzdaten und Leistung erfassen,
              Kalkulation und Text automatisch übernehmen, PDF sofort bereitstellen.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/planner?mode=schnellangebot&quelle=dashboard"
                className="inline-flex items-center justify-center rounded-xl bg-[var(--brand-accent)] px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_34px_rgba(249,115,22,0.28)] transition hover:brightness-95"
              >
                Neues Angebot in 2 Min erstellen
              </Link>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                Kunde {"->"} Leistung {"->"} Text {"->"} PDF
              </span>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-sm font-semibold text-slate-900">Schnellangebot-Flow</h2>
            <div className="mt-3 grid gap-2">
              {[
                { step: "1", title: "Kunde & Einsatzort", text: "Kunde direkt anlegen oder wiederverwenden" },
                { step: "2", title: "Leistung & Kalkulation", text: "Defaults laden und automatisch kalkulieren" },
                { step: "3", title: "Angebotstext", text: "Strukturierter Text automatisch erzeugen" },
                { step: "4", title: "Vorschau / PDF", text: "Angebot speichern, PDF erzeugen und öffnen" },
              ].map((item) => (
                <div key={item.step} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-accent)]">Schritt {item.step}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-1 text-xs text-slate-600">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Offene Angebote" value={kpis.openOffers.toString()} tone="amber" />
        <KpiCard label="Gewonnen" value={kpis.wonOffers.toString()} tone="emerald" />
        <KpiCard label="Monatspotenzial" value={formatEuro(kpis.monthlyPotential)} tone="blue" />
        <KpiCard label="Conversion" value={`${Math.round(kpis.conversionRate)} %`} tone="purple" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Letzte Angebote</h2>
            <Link href="/quotes" className="text-xs font-semibold text-[var(--brand-accent)] hover:underline">
              Alle Angebote
            </Link>
          </div>
          {latestQuotes.length === 0 ? (
            <p className="rounded-xl border border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
              Noch keine Angebote vorhanden.
            </p>
          ) : (
            <div className="space-y-2">
              {latestQuotes.map((quote) => {
                const customer = customerById.get(quote.customerId);
                const project = projectById.get(quote.projectId);
                return (
                  <Link
                    key={quote.id}
                    href={`/quotes/${quote.id}`}
                    className="grid grid-cols-[1.1fr_1.1fr_1fr_auto] items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{quote.number ?? quote.id.slice(0, 8)}</p>
                      <p className="truncate text-xs text-slate-500">{customer?.companyName ?? "Unbekannter Kunde"}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-800">{project?.name ?? "Projekt"}</p>
                      <p className="truncate text-xs text-slate-500">
                        {quote.serviceType ? QUOTE_SERVICE_TYPE_LABELS[quote.serviceType] : "Leistung"}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-slate-900">{formatEuro(quote.pricing.netTotal)}</p>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[quote.status]}`}>
                      {STATUS_LABELS[quote.status]}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </article>

        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Warum ViorAI?</h2>
          {[
            "Schnellangebot als Standardprozess",
            "Weniger Eingaben, mehr Automatik",
            "Echte Daten statt Demo-UI",
            "Saubere Angebots-PDF in produktiver Qualität",
          ].map((item) => (
            <div key={item} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {item}
            </div>
          ))}
          <div className="rounded-xl bg-slate-900 px-3 py-2 text-white">
            <p className="text-xs uppercase tracking-wide text-slate-300">Heute</p>
            <p className="mt-1 text-sm font-semibold">{kpis.openOffers} offene Angebote im Fokus</p>
          </div>
        </aside>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "amber" | "emerald" | "blue" | "purple";
}) {
  const toneClasses: Record<typeof tone, string> = {
    amber: "bg-amber-100 text-amber-700",
    emerald: "bg-emerald-100 text-emerald-700",
    blue: "bg-blue-100 text-blue-700",
    purple: "bg-violet-100 text-violet-700",
  };

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <span className={`h-3 w-3 rounded-full ${toneClasses[tone]}`} />
      </div>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
    </article>
  );
}

function formatEuro(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}
