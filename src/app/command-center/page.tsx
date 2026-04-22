"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient, getSupabaseSessionSafe } from "@/lib/supabase/client";
import { QUOTE_SERVICE_TYPE_OPTIONS, type QuoteServiceType } from "@/features/quotes/service-types";
import type { TariffContext } from "@/lib/tariff/engine";
import type { RuntimeMode, TariffTimeModel } from "@/features/offers/integrated-engine";

type PatrolInput = {
  controlsCount: number;
  controlMinutesPerControl: number;
  driveToMinutes: number;
  betweenObjectsMinutes: number;
  returnMinutes: number;
  weekdays: number;
  shiftLabel: string;
  objectsInTour: number;
};

interface PlannerOutputInput {
  cameras: number;
  towers: number;
  recorders: number;
  switches: number;
  obstacles: number;
}

interface CommandCenterFormState {
  companyName: string;
  contactName: string;
  street: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
  projectName: string;
  serviceAddress: string;
  serviceType: QuoteServiceType;
  state: string;
  runtimeMode: RuntimeMode;
  runtimeMonths: number;
  employeeCount: number;
  targetMarginPercent: number;
  timeModel: TariffTimeModel;
  tariffContext: TariffContext;
  serviceContext: string;
  wageGroup: string;
  dutyDurationHours: number;
  employerCostFactor: number;
  shiftStartIso: string;
  notes: string;
  includePlannerOutput: boolean;
  plannerOutput: PlannerOutputInput;
  patrolInput: PatrolInput;
}

interface EngineDraftResponse {
  draft: {
    totals: {
      monthlyTotal: number;
      oneTimeTotal: number;
      totalNet: number;
      totalGross: number;
      durationMonths: number;
    };
    tariff: {
      context: TariffContext;
      employeeCount: number;
      runtimeMode: RuntimeMode;
      runtimeLabel: string;
      monthlyHoursPerEmployee: number;
      dayHoursPerEmployee: number;
      nightHoursPerEmployee: number;
      surchargePercents: {
        night: number;
        sunday: number;
        holiday: number;
      };
      laborCostPerHourPerEmployee: number;
      employerCostPerHourPerEmployee: number;
      saleHourlyRatePerEmployee: number;
      monthlyLaborCostPerEmployee: number;
      monthlySalesValuePerEmployee: number;
      employerCostPerHourTotal: number;
      saleHourlyRateTotal: number;
      monthlyLaborCostTotal: number;
      monthlySalesValueTotal: number;
      employerCostFactor: number;
      targetMargin: number;
      resolved: {
        state: string;
        serviceType: string;
        serviceContext: string;
        wageGroup: string;
        tariffSet: {
          key: string;
          title: string;
          sourceDate: string;
        };
        appliedBaseRate: number;
        appliedSurcharges: Array<{
          surchargeType: string;
          mode: string;
          value: number;
          amountPerHour: number;
          note?: string;
        }>;
        appliedSpecialRules: Array<{
          ruleType: string;
          absoluteHourlyAdd: number;
          percentAdd: number;
          note?: string;
        }>;
      };
      breakdown: {
        base_rate: number;
        monthly_price: number;
      };
    };
    patrol?: {
      controlsCount: number;
      driveToMinutes: number;
      controlMinutesTotal: number;
      betweenObjectsMinutesTotal: number;
      returnMinutes: number;
      totalMinutes: number;
      totalHours: number;
      objectsInTour: number;
      shiftLabel: string;
    };
    techSetup: {
      cameras: number;
      towers: number;
      recorders: number;
      switches: number;
    };
    decisions: string[];
    text: {
      combined: string;
    };
  };
}

interface CreateOfferResponse {
  quoteId: string;
  quoteNumber?: string | null;
  status?: string;
  pdfPublicUrl?: string;
  customer?: {
    id: string;
    companyName: string;
    contactName?: string;
    street?: string;
    postalCode?: string;
    city?: string;
    email?: string;
    phone?: string;
  };
}

const INITIAL_FORM: CommandCenterFormState = {
  companyName: "",
  contactName: "",
  street: "",
  postalCode: "",
  city: "",
  email: "",
  phone: "",
  projectName: "Sicherungsprojekt",
  serviceAddress: "",
  serviceType: "objektschutz",
  state: "nordrhein-westfalen",
  runtimeMonths: 3,
  runtimeMode: "until_revocation",
  employeeCount: 1,
  targetMarginPercent: 22,
  timeModel: "day",
  tariffContext: "standard",
  serviceContext: "objektschutz",
  wageGroup: "EG-OBJ",
  dutyDurationHours: 8,
  employerCostFactor: 1.34,
  shiftStartIso: new Date().toISOString().slice(0, 16),
  notes: "",
  includePlannerOutput: false,
  plannerOutput: {
    cameras: 6,
    towers: 2,
    recorders: 0,
    switches: 0,
    obstacles: 0,
  },
  patrolInput: {
    controlsCount: 2,
    controlMinutesPerControl: 12,
    driveToMinutes: 14,
    betweenObjectsMinutes: 10,
    returnMinutes: 12,
    weekdays: 30,
    shiftLabel: "Nacht",
    objectsInTour: 1,
  },
};

export default function CommandCenterPage() {
  const router = useRouter();
  const [form, setForm] = useState<CommandCenterFormState>(INITIAL_FORM);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [preview, setPreview] = useState<EngineDraftResponse["draft"] | null>(null);
  const [createdOffer, setCreatedOffer] = useState<CreateOfferResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const topFieldsValid = useMemo(() => {
    return form.companyName.trim().length > 0
      && form.contactName.trim().length > 0
      && form.street.trim().length > 0
      && form.postalCode.trim().length > 0
      && form.city.trim().length > 0
      && form.serviceAddress.trim().length > 0
      && (form.runtimeMode === "until_revocation" || form.runtimeMonths > 0)
      && form.employeeCount > 0
      && form.targetMarginPercent > 0;
  }, [form]);

  const updatePlanner = (key: keyof PlannerOutputInput, value: number) => {
    setForm((prev) => ({
      ...prev,
      plannerOutput: {
        ...prev.plannerOutput,
        [key]: Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0,
      },
    }));
  };

  const updatePatrol = (key: keyof PatrolInput, value: string | number) => {
    setForm((prev) => ({
      ...prev,
      patrolInput: {
        ...prev.patrolInput,
        [key]: typeof value === "number" ? Math.max(0, value) : value,
      },
    }));
  };

  const withToken = async (): Promise<string> => {
    const supabase = getSupabaseClient();
    const { data } = await getSupabaseSessionSafe(supabase);
    const token = data.session?.access_token;
    if (!token) {
      throw new Error("Session ist abgelaufen. Bitte erneut anmelden.");
    }
    return token;
  };

  const payloadForEngine = () => ({
    customerName: form.companyName,
    projectName: form.projectName,
    serviceAddress: form.serviceAddress,
    state: form.state,
    serviceType: form.serviceType,
    runtimeMode: form.runtimeMode,
    runtimeMonths: form.runtimeMode === "fixed" ? form.runtimeMonths : undefined,
    runtimeLabel: form.runtimeMode === "fixed" ? `${form.runtimeMonths} Monate` : "Bis auf Widerruf",
    employeeCount: form.employeeCount,
    targetMargin: form.targetMarginPercent / 100,
    timeModel: form.timeModel,
    notes: form.notes,
    tariffContext: form.tariffContext,
    serviceContext: form.serviceContext,
    wageGroup: form.wageGroup,
    dutyDurationHours: form.dutyDurationHours,
    shiftStartIso: new Date(form.shiftStartIso).toISOString(),
    employerCostFactor: form.employerCostFactor,
    includePlannerOutput: form.includePlannerOutput,
    plannerOutput: form.includePlannerOutput ? form.plannerOutput : undefined,
    patrolInput: form.serviceType === "revierdienst" ? form.patrolInput : undefined,
  });

  const runPreview = async () => {
    if (!topFieldsValid) {
      setError("Bitte Kunde, Einsatzort, Mitarbeiteranzahl und Zielmarge ausfüllen. Bei fester Laufzeit zusätzlich Monate setzen.");
      return;
    }

    try {
      setIsPreviewLoading(true);
      setError(null);
      const token = await withToken();
      const response = await fetch("/api/offers/quick-preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payloadForEngine()),
      });

      const payload = (await response.json()) as { error?: string } & EngineDraftResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Vorschau konnte nicht berechnet werden.");
      }

      setPreview(payload.draft);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Vorschau konnte nicht berechnet werden.");
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const createOffer = async () => {
    if (!topFieldsValid) {
      setError("Bitte Kunde, Einsatzort, Mitarbeiteranzahl und Zielmarge ausfüllen. Bei fester Laufzeit zusätzlich Monate setzen.");
      return;
    }

    try {
      setIsCreating(true);
      setError(null);
      setCreatedOffer(null);
      const token = await withToken();
      const response = await fetch("/api/offers/quick-create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          customer: {
            companyName: form.companyName,
            contactName: form.contactName,
            street: form.street,
            postalCode: form.postalCode,
            city: form.city,
            email: form.email,
            phone: form.phone,
          },
          project: {
            name: form.projectName,
            serviceAddress: form.serviceAddress,
            state: form.state,
            runtimeLabel: form.runtimeMode === "fixed" ? `${form.runtimeMonths} Monate` : "Bis auf Widerruf",
            notes: form.notes,
          },
          offer: {
            mode: "quick",
            serviceType: form.serviceType,
            runtimeMode: form.runtimeMode,
            runtimeMonths: form.runtimeMode === "fixed" ? form.runtimeMonths : undefined,
            runtimeLabel: form.runtimeMode === "fixed" ? `${form.runtimeMonths} Monate` : "Bis auf Widerruf",
            employeeCount: form.employeeCount,
            targetMargin: form.targetMarginPercent / 100,
            timeModel: form.timeModel,
            tariffContext: form.tariffContext,
            serviceContext: form.serviceContext,
            wageGroup: form.wageGroup,
            dutyDurationHours: form.dutyDurationHours,
            shiftStartIso: new Date(form.shiftStartIso).toISOString(),
            employerCostFactor: form.employerCostFactor,
            patrolInput: form.serviceType === "revierdienst" ? form.patrolInput : undefined,
            includePlannerOutput: form.includePlannerOutput,
            plannerOutput: form.includePlannerOutput ? form.plannerOutput : undefined,
            autoGenerateText: true,
          },
        }),
      });

      const payload = (await response.json()) as { error?: string } & CreateOfferResponse;
      if (!response.ok || !payload.quoteId) {
        throw new Error(payload.error ?? "Angebot konnte nicht erstellt werden.");
      }

      setCreatedOffer(payload);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Angebot konnte nicht erstellt werden.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1450px] space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Firmenname" className="min-w-[220px] flex-1">
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.companyName} onChange={(event) => setForm((prev) => ({ ...prev, companyName: event.target.value }))} />
          </Field>
          <Field label="Einsatzort" className="min-w-[220px] flex-1">
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.serviceAddress} onChange={(event) => setForm((prev) => ({ ...prev, serviceAddress: event.target.value }))} />
          </Field>
          <Field label="Ansprechpartner" className="min-w-[220px] flex-1">
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.contactName} onChange={(event) => setForm((prev) => ({ ...prev, contactName: event.target.value }))} />
          </Field>
          <Field label="Straße" className="min-w-[220px] flex-1">
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.street} onChange={(event) => setForm((prev) => ({ ...prev, street: event.target.value }))} />
          </Field>
          <Field label="PLZ" className="min-w-[120px]">
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.postalCode} onChange={(event) => setForm((prev) => ({ ...prev, postalCode: event.target.value }))} />
          </Field>
          <Field label="Ort" className="min-w-[180px]">
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.city} onChange={(event) => setForm((prev) => ({ ...prev, city: event.target.value }))} />
          </Field>
          <Field label="E-Mail" className="min-w-[220px] flex-1">
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
          </Field>
          <Field label="Telefon" className="min-w-[180px]">
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} />
          </Field>
          <Field label="Leistungsart" className="min-w-[180px]">
            <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" value={form.serviceType} onChange={(event) => setForm((prev) => ({ ...prev, serviceType: event.target.value as QuoteServiceType }))}>
              {QUOTE_SERVICE_TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Bundesland" className="min-w-[180px]">
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.state} onChange={(event) => setForm((prev) => ({ ...prev, state: event.target.value }))} />
          </Field>
          <Field label="Laufzeitmodus" className="min-w-[180px]">
            <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" value={form.runtimeMode} onChange={(event) => setForm((prev) => ({ ...prev, runtimeMode: event.target.value as RuntimeMode }))}>
              <option value="until_revocation">Bis auf Widerruf</option>
              <option value="fixed">Feste Laufzeit</option>
            </select>
          </Field>
          {form.runtimeMode === "fixed" && (
            <Field label="Laufzeit (Monate)" className="min-w-[140px]">
              <input type="number" min={1} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.runtimeMonths} onChange={(event) => setForm((prev) => ({ ...prev, runtimeMonths: Math.max(1, Number(event.target.value) || 1) }))} />
            </Field>
          )}
          <Field label="Anzahl Mitarbeiter" className="min-w-[160px]">
            <input type="number" min={1} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.employeeCount} onChange={(event) => setForm((prev) => ({ ...prev, employeeCount: Math.max(1, Number(event.target.value) || 1) }))} />
          </Field>
          <Field label="Zielmarge (%)" className="min-w-[140px]">
            <input type="number" min={5} max={60} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.targetMarginPercent} onChange={(event) => setForm((prev) => ({ ...prev, targetMarginPercent: Math.max(5, Math.min(60, Number(event.target.value) || 5)) }))} />
          </Field>
          <div className="flex gap-2">
            <button type="button" onClick={() => void runPreview()} disabled={isPreviewLoading} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {isPreviewLoading ? "Berechne..." : "Live Engine"}
            </button>
            <button type="button" onClick={() => void createOffer()} disabled={isCreating} className="rounded-lg bg-[var(--brand-accent)] px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50">
              {isCreating ? "Erstelle..." : "Angebot in 60s erzeugen"}
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_1fr_1.15fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Links: Eingaben</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tarifkontext">
              <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" value={form.tariffContext} onChange={(event) => setForm((prev) => ({ ...prev, tariffContext: event.target.value as TariffContext }))}>
                <option value="standard">Standard</option>
                <option value="military">Militär</option>
                <option value="kta">KTA</option>
              </select>
            </Field>
            <Field label="Service-Kontext">
              <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.serviceContext} onChange={(event) => setForm((prev) => ({ ...prev, serviceContext: event.target.value }))} />
            </Field>
            <Field label="Wage Group">
              <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.wageGroup} onChange={(event) => setForm((prev) => ({ ...prev, wageGroup: event.target.value }))} />
            </Field>
            <Field label="Dienstdauer (Std.)">
              <input type="number" min={1} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.dutyDurationHours} onChange={(event) => setForm((prev) => ({ ...prev, dutyDurationHours: Math.max(1, Number(event.target.value) || 1) }))} />
            </Field>
            <Field label="Arbeitgeberfaktor">
              <input type="number" min={1} step="0.01" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.employerCostFactor} onChange={(event) => setForm((prev) => ({ ...prev, employerCostFactor: Math.max(1, Number(event.target.value) || 1) }))} />
            </Field>
            <Field label="Schichtstart">
              <input type="datetime-local" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.shiftStartIso} onChange={(event) => setForm((prev) => ({ ...prev, shiftStartIso: event.target.value }))} />
            </Field>
          </div>
          <Field label="Zeitmodell">
            <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" value={form.timeModel} onChange={(event) => setForm((prev) => ({ ...prev, timeModel: event.target.value as TariffTimeModel }))}>
              <option value="day">Tagdienst</option>
              <option value="night">Nachtdienst</option>
              <option value="twentyfourseven">24/7</option>
              <option value="patrol">Reviermodell</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.includePlannerOutput} onChange={(event) => setForm((prev) => ({ ...prev, includePlannerOutput: event.target.checked }))} />
            Planer-Output in Kalkulation einbeziehen
          </label>
          <Field label="Planer-Output (optional)">
            <div className="grid grid-cols-2 gap-2">
              <NumberInput disabled={!form.includePlannerOutput} label="Kameras" value={form.plannerOutput.cameras} onChange={(value) => updatePlanner("cameras", value)} />
              <NumberInput disabled={!form.includePlannerOutput} label="Türme" value={form.plannerOutput.towers} onChange={(value) => updatePlanner("towers", value)} />
              <NumberInput disabled={!form.includePlannerOutput} label="Recorder" value={form.plannerOutput.recorders} onChange={(value) => updatePlanner("recorders", value)} />
              <NumberInput disabled={!form.includePlannerOutput} label="Switches" value={form.plannerOutput.switches} onChange={(value) => updatePlanner("switches", value)} />
              <NumberInput disabled={!form.includePlannerOutput} label="Hindernisse" value={form.plannerOutput.obstacles} onChange={(value) => updatePlanner("obstacles", value)} />
            </div>
          </Field>
          {form.serviceType === "revierdienst" && (
            <Field label="Revierparameter">
              <div className="grid grid-cols-2 gap-2">
                <NumberInput label="Kontrollen" value={form.patrolInput.controlsCount} onChange={(value) => updatePatrol("controlsCount", value)} />
                <NumberInput label="Kontrollzeit (min)" value={form.patrolInput.controlMinutesPerControl} onChange={(value) => updatePatrol("controlMinutesPerControl", value)} />
                <NumberInput label="Anfahrt (min)" value={form.patrolInput.driveToMinutes} onChange={(value) => updatePatrol("driveToMinutes", value)} />
                <NumberInput label="Weiterfahrt (min)" value={form.patrolInput.betweenObjectsMinutes} onChange={(value) => updatePatrol("betweenObjectsMinutes", value)} />
                <NumberInput label="Rückfahrt (min)" value={form.patrolInput.returnMinutes} onChange={(value) => updatePatrol("returnMinutes", value)} />
                <NumberInput label="Wochentage/Monat" value={form.patrolInput.weekdays} onChange={(value) => updatePatrol("weekdays", value)} />
              </div>
            </Field>
          )}
          <Field label="Hinweise">
            <textarea className="w-full min-h-24 rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
          </Field>
          <Link href="/planner" className="inline-flex text-sm font-medium text-[var(--brand-accent)] hover:underline">Planer öffnen (Fullscreen)</Link>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Mitte: Live Engine</h2>
          {!preview ? (
            <p className="text-sm text-slate-500">Noch keine Live-Berechnung. Klick auf "Live Engine".</p>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm space-y-1">
                <p className="font-semibold text-slate-700">Tarifbasis</p>
                <p>Tarifkontext: <span className="font-semibold">{toGermanTariffContext(preview.tariff.context)}</span></p>
                <p>Tarifset: <span className="font-semibold">{preview.tariff.resolved.tariffSet.title}</span></p>
                <p>Bundesland: <span className="font-semibold">{preview.tariff.resolved.state}</span></p>
                <p>Leistungsart: <span className="font-semibold">{preview.tariff.resolved.serviceType}</span></p>
                <p>Lohngruppe: <span className="font-semibold">{preview.tariff.resolved.wageGroup}</span></p>
                <p>Tariflicher Stundenlohn: <span className="font-semibold">{formatCurrency(preview.tariff.resolved.appliedBaseRate)}/h</span></p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3 text-sm space-y-1">
                <p className="font-semibold text-slate-700">Zuschläge</p>
                <p>Nachtzuschlag: <span className="font-semibold">{(preview.tariff.surchargePercents.night * 100).toFixed(2)}%</span></p>
                <p>Sonntagszuschlag: <span className="font-semibold">{(preview.tariff.surchargePercents.sunday * 100).toFixed(2)}%</span></p>
                <p>Feiertagszuschlag: <span className="font-semibold">{(preview.tariff.surchargePercents.holiday * 100).toFixed(2)}%</span></p>
                <p className="text-slate-500">Hinweis: Zuschläge werden auf den tariflichen Lohn angewendet und sind keine eigenständige Gewinnkomponente.</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3 text-sm space-y-1">
                <p className="font-semibold text-slate-700">Kosten 1 MA</p>
                <p>Arbeitgeberkosten/h: <span className="font-semibold">{formatCurrency(preview.tariff.employerCostPerHourPerEmployee)}</span></p>
                <p>Verkaufspreis/h: <span className="font-semibold">{formatCurrency(preview.tariff.saleHourlyRatePerEmployee)}</span></p>
                <p>Arbeitgeberkosten/Monat: <span className="font-semibold">{formatCurrency(preview.tariff.monthlyLaborCostPerEmployee)}</span></p>
                <p>Verkaufspreis/Monat: <span className="font-semibold">{formatCurrency(preview.tariff.monthlySalesValuePerEmployee)}</span></p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3 text-sm space-y-1">
                <p className="font-semibold text-slate-700">Kosten gesamt</p>
                <p>Anzahl Mitarbeiter: <span className="font-semibold">{preview.tariff.employeeCount}</span></p>
                <p>Arbeitgeberkosten/h gesamt: <span className="font-semibold">{formatCurrency(preview.tariff.employerCostPerHourTotal)}</span></p>
                <p>Verkaufspreis/h gesamt: <span className="font-semibold">{formatCurrency(preview.tariff.saleHourlyRateTotal)}</span></p>
                <p>Arbeitgeberkosten/Monat gesamt: <span className="font-semibold">{formatCurrency(preview.tariff.monthlyLaborCostTotal)}</span></p>
                <p>Verkaufspreis/Monat gesamt: <span className="font-semibold">{formatCurrency(preview.tariff.monthlySalesValueTotal)}</span></p>
              </div>
              {preview.patrol && (
                <div className="rounded-xl border border-slate-200 p-3 text-sm space-y-1">
                  <p className="font-semibold text-slate-700">Revierlogik</p>
                  <p>Kontrollen: {preview.patrol.controlsCount}</p>
                  <p>Fahrzeit: {preview.patrol.driveToMinutes} min + {preview.patrol.betweenObjectsMinutesTotal} min + {preview.patrol.returnMinutes} min</p>
                  <p>Kontrollzeit: {preview.patrol.controlMinutesTotal} min</p>
                  <p>Gesamtzeit: {preview.patrol.totalMinutes} min ({preview.patrol.totalHours} h)</p>
                </div>
              )}
              <div className="rounded-xl border border-slate-200 p-3 text-sm space-y-2">
                <p className="font-semibold text-slate-700">Automatisierungs-Entscheidungen</p>
                <p className="text-slate-600">- Planer aktiv: {form.includePlannerOutput ? "ja" : "nein"}</p>
                <p className="text-slate-600">- Laufzeitmodus: {form.runtimeMode === "fixed" ? `Feste Laufzeit (${form.runtimeMonths} Monate)` : "Bis auf Widerruf"}</p>
                {(preview.decisions.length === 0 ? ["Keine Zusatzentscheidungen erforderlich."] : preview.decisions).map((decision) => (
                  <p key={decision} className="text-slate-600">- {decision}</p>
                ))}
              </div>
            </>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Rechts: Angebotsvorschau</h2>
          <div className="rounded-xl border border-slate-200 p-3 text-sm space-y-1">
            <p className="font-semibold text-slate-700">Kunde</p>
            <p>{createdOffer?.customer?.companyName ?? (form.companyName || "—")}</p>
            <p>{createdOffer?.customer?.contactName ?? (form.contactName || "—")}</p>
            <p>
              {[
                createdOffer?.customer?.street ?? form.street,
                createdOffer?.customer?.postalCode ?? form.postalCode,
                createdOffer?.customer?.city ?? form.city,
              ].filter((part) => !!part).join(", ") || "—"}
            </p>
          </div>
          {!preview ? (
            <p className="text-sm text-slate-500">Vorschau wird nach Live-Berechnung angezeigt.</p>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm space-y-1">
                <p>Monatlich: <span className="font-semibold">{formatCurrency(preview.totals.monthlyTotal)}</span></p>
                <p>Einmalig: <span className="font-semibold">{formatCurrency(preview.totals.oneTimeTotal)}</span></p>
                <p>Netto: <span className="font-semibold">{formatCurrency(preview.totals.totalNet)}</span></p>
                <p>Brutto: <span className="font-semibold">{formatCurrency(preview.totals.totalGross)}</span></p>
              </div>
              <textarea readOnly className="w-full min-h-[320px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm leading-6" value={preview.text.combined} />
            </>
          )}
          {createdOffer && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm space-y-2">
              <p className="font-semibold text-emerald-800">Angebot gespeichert ({createdOffer.status ?? "draft"})</p>
              <p className="text-emerald-700">Angebotsnummer: {createdOffer.quoteNumber ?? createdOffer.quoteId}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-lg border border-emerald-300 px-3 py-1.5 text-emerald-800 hover:bg-emerald-100" onClick={() => router.push(`/quotes/${createdOffer.quoteId}?source=command-center`)}>
                  Angebotsansicht öffnen
                </button>
                {createdOffer.pdfPublicUrl ? (
                  <a className="rounded-lg border border-emerald-300 px-3 py-1.5 text-emerald-800 hover:bg-emerald-100" href={createdOffer.pdfPublicUrl} target="_blank" rel="noreferrer" download>
                    PDF herunterladen
                  </a>
                ) : (
                  <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-500">PDF noch nicht verfügbar</span>
                )}
              </div>
            </div>
          )}
        </article>
      </section>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        onChange={(event) => onChange(Number(event.target.value) || 0)}
      />
    </label>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

function toGermanTariffContext(context: TariffContext): string {
  if (context === "standard") {
    return "Standard";
  }
  if (context === "military") {
    return "Militär";
  }
  return "KTA";
}
