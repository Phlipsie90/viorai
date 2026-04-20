"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { localCustomerRepository } from "@/features/customers/repository";
import { localProjectRepository } from "@/features/projects/repository";
import { localQuoteRepository } from "@/features/quotes/repository";
import type { Quote, QuoteStatus, QuoteStatusHistoryEntry } from "@/features/quotes/types";
import { QUOTE_SERVICE_TYPE_LABELS } from "@/features/quotes/service-types";
import type { Customer, Project } from "@/types";

const statusLabels: Record<QuoteStatus, string> = {
  draft: "Entwurf",
  sent: "Gesendet",
  accepted: "Angenommen",
  rejected: "Abgelehnt",
};

const statusColors: Record<QuoteStatus, string> = {
  draft: "bg-slate-100 text-slate-600",
  sent: "bg-blue-100 text-blue-700",
  accepted: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export default function QuotesPage() {
  const router = useRouter();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [historiesByQuoteId, setHistoriesByQuoteId] = useState<Record<string, QuoteStatusHistoryEntry[]>>({});
  const [activeTimelineQuoteId, setActiveTimelineQuoteId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async (timelineQuoteId?: string | null) => {
    const [savedQuotes, savedCustomers, savedProjects] = await Promise.all([
      localQuoteRepository.getAllQuotes(),
      localCustomerRepository.list(),
      localProjectRepository.list(),
    ]);

    setQuotes(savedQuotes);
    setCustomers(savedCustomers);
    setProjects(savedProjects);

    const quoteIdToLoad = timelineQuoteId ?? activeTimelineQuoteId;
    if (quoteIdToLoad) {
      const history = await localQuoteRepository.getQuoteStatusHistory(quoteIdToLoad);
      setHistoriesByQuoteId((prev) => ({ ...prev, [quoteIdToLoad]: history }));
    }
  };

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      try {
        await loadData();
        if (!isMounted) {
          return;
        }
        setError(null);
      } catch (loadError) {
        if (!isMounted) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Angebote konnten nicht geladen werden.");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void run();

    return () => {
      isMounted = false;
    };
  }, []);

  const customerNameById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer.companyName])),
    [customers]
  );
  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  );

  const handleOpenInPlanner = async (quote: Quote) => {
    await localProjectRepository.setSelectedProjectId(quote.projectId);
    router.push(`/planner?quoteId=${quote.id}`);
  };

  const handleStatusChange = async (quoteId: string, status: QuoteStatus) => {
    await localQuoteRepository.updateQuoteStatus(quoteId, status);
    await loadData(quoteId);
  };

  const handleDuplicateQuote = async (quoteId: string) => {
    await localQuoteRepository.duplicateQuote(quoteId);
    await loadData();
  };

  const handleToggleTimeline = async (quoteId: string) => {
    if (activeTimelineQuoteId === quoteId) {
      setActiveTimelineQuoteId(null);
      return;
    }

    const history = await localQuoteRepository.getQuoteStatusHistory(quoteId);
    setHistoriesByQuoteId((prev) => ({ ...prev, [quoteId]: history }));
    setActiveTimelineQuoteId(quoteId);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Angebote"
        description="Gespeicherte Angebote mit Statusverwaltung, Timeline und Duplizieren."
        action={<Button onClick={() => router.push("/planner")}>Neues Angebot erstellen</Button>}
      />

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 grid grid-cols-6 gap-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
          <span>Nummer</span>
          <span>Kunde</span>
          <span>Projekt</span>
          <span>Summe</span>
          <span>Status</span>
          <span>Aktion</span>
        </div>

        {isLoading ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400">Lade Angebote...</div>
        ) : error ? (
          <div className="px-5 py-10 text-center text-sm text-red-600">{error}</div>
        ) : quotes.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400">Noch keine Angebote gespeichert.</div>
        ) : (
          <ul>
            {quotes.map((quote) => {
              const timeline = historiesByQuoteId[quote.id] ?? [];

              return (
                <li key={quote.id} className="border-b border-slate-100 last:border-b-0">
                  <div className="px-5 py-3 grid grid-cols-6 gap-3 items-center">
                    <div className="text-sm text-slate-700">
                      <div className="font-medium text-slate-800">{quote.number ?? "-"}</div>
                      <div className="text-xs text-slate-500">
                        {quote.serviceType ? QUOTE_SERVICE_TYPE_LABELS[quote.serviceType] : "Ohne Leistungsart"}
                      </div>
                    </div>
                    <span className="text-sm text-slate-700">{customerNameById.get(quote.customerId) ?? "Unbekannt"}</span>
                    <span className="text-sm text-slate-700">{projectNameById.get(quote.projectId) ?? "Unbekannt"}</span>
                    <span className="text-sm font-medium text-slate-800">{quote.pricing.netTotal.toFixed(2)} EUR</span>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusColors[quote.status]}`}>
                        {statusLabels[quote.status]}
                      </span>
                      <select
                        value={quote.status}
                        onChange={(event) => void handleStatusChange(quote.id, event.target.value as QuoteStatus)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        <option value="draft">Entwurf</option>
                        <option value="sent">Gesendet</option>
                        <option value="accepted">Angenommen</option>
                        <option value="rejected">Abgelehnt</option>
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => void handleOpenInPlanner(quote)}>
                        Angebot bearbeiten
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void handleDuplicateQuote(quote.id)}>
                        Duplizieren
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void handleToggleTimeline(quote.id)}>
                        Timeline
                      </Button>
                    </div>
                  </div>

                  {activeTimelineQuoteId === quote.id && (
                    <div className="px-5 pb-4">
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 space-y-2">
                        <h4 className="text-sm font-semibold text-slate-800">Timeline</h4>
                        {timeline.length === 0 ? (
                          <p className="text-sm text-slate-500">Noch keine Statushistorie vorhanden.</p>
                        ) : (
                          <ul className="space-y-2">
                            {timeline.map((entry) => (
                              <li key={entry.id} className="text-sm text-slate-700">
                                {formatDateTime(entry.changedAt)} | {entry.oldStatus ? `${statusLabels[entry.oldStatus]} -> ` : ""}
                                {statusLabels[entry.newStatus]}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}
