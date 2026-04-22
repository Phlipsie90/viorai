import { createLineItem, calculateQuoteTotals } from "@/lib/pricing/calculator";
import type { QuoteLineItem } from "@/types";
import type { QuoteServiceType } from "@/features/quotes/service-types";
import type { CompanySettings } from "@/features/company-settings/types";
import {
  calculateLaborCost,
  calculateSalesPrice,
  resolveTariff,
  resolveTariffContext,
  type ResolvedTariff,
  type TariffContext,
  type TariffDataset,
} from "@/lib/tariff/engine";
import { calculatePatrolService, type PatrolCalculationResult, type PatrolInput } from "@/lib/patrol/engine";

export type TariffTimeModel = "day" | "night" | "twentyfourseven" | "patrol";

export interface PlannerOutputInput {
  cameras?: number;
  towers?: number;
  recorders?: number;
  switches?: number;
  obstacles?: number;
}

export interface IntegratedOfferInput {
  serviceType: QuoteServiceType;
  state: string;
  runtimeMonths: number;
  targetMargin: number;
  timeModel: TariffTimeModel;
  serviceAddress: string;
  customerName: string;
  projectName: string;
  notes?: string;
  settings: CompanySettings | null;
  plannerOutput?: PlannerOutputInput;
  discountAmount?: number;
  tariffDataset: TariffDataset;
  tariffContext?: TariffContext;
  serviceContext?: string;
  wageGroup?: string;
  dutyDurationHours?: number;
  shiftStartIso?: string;
  shiftEndIso?: string;
  patrolInput?: PatrolInput;
  employerCostFactor?: number;
}

export interface TechSetup {
  cameras: number;
  towers: number;
  recorders: number;
  switches: number;
}

export interface OfferTextSections {
  introduction: string;
  serviceDescription: string;
  details: string;
  pricingBlock: string;
  closing: string;
  combined: string;
}

export interface TariffCalculationResult {
  context: TariffContext;
  resolved: ResolvedTariff;
  monthlyHours: number;
  laborCostPerHour: number;
  employerCostPerHour: number;
  saleHourlyRate: number;
  employerCostFactor: number;
  targetMargin: number;
  monthlyLaborCost: number;
  monthlySalesValue: number;
}

export interface TariffSnapshot {
  tariffContext: TariffContext;
  tariffSet: string;
  tariffVersionDate: string;
  state: string;
  serviceType: string;
  serviceContext: string;
  wageGroup: string;
  matchedServiceType: string;
  matchedServiceContext: string;
  matchedWageGroup: string;
  fallbackApplied: boolean;
  fallbackReason?: string;
  dutyDurationHours?: number;
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
  employerCostFactor: number;
  targetMargin: number;
  calculationBasisPerHour: number;
  saleHourlyRate: number;
}

export interface IntegratedOfferDraft {
  lineItems: QuoteLineItem[];
  totals: {
    monthlyTotal: number;
    oneTimeTotal: number;
    subtotal: number;
    totalNet: number;
    totalGross: number;
    discountAmount: number;
    vatRate: number;
    durationMonths: number;
  };
  tariff: TariffCalculationResult;
  techSetup: TechSetup;
  decisions: string[];
  text: OfferTextSections;
  tariffSnapshot: TariffSnapshot;
  patrol?: PatrolCalculationResult;
}

function clampInt(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(Number(value)));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function getDefaultServiceContext(serviceType: QuoteServiceType): string {
  switch (serviceType) {
    case "objektschutz":
      return "objektschutz";
    case "revierdienst":
      return "revier";
    case "leitstelle":
      return "nsl";
    case "werkschutz":
      return "werkschutz";
    case "sonderdienste":
      return "werkschutz";
    case "empfangsdienst":
      return "objektschutz";
    case "baustellenueberwachung":
      return "objektschutz";
    default:
      return "objektschutz";
  }
}

function getTariffServiceType(input: IntegratedOfferInput, context: TariffContext): string {
  if (context === "military") {
    return "bundeswehr";
  }
  if (context === "kta") {
    return "kerntechnik";
  }

  switch (input.serviceType) {
    case "objektschutz":
      return "separatwachdienst";
    case "leitstelle":
      return "nrz_nsl";
    case "revierdienst":
      return "revierwachdienst";
    case "werkschutz":
      return "gssk";
    case "empfangsdienst":
      return "separatwachdienst";
    case "sonderdienste":
      return "fachkraft_schutz_sicherheit";
    case "baustellenueberwachung":
      return "separatwachdienst";
    default:
      return input.serviceType;
  }
}

function getDefaultWageGroup(input: IntegratedOfferInput, context: TariffContext): string {
  if (input.wageGroup?.trim()) {
    return input.wageGroup.trim();
  }

  if (context === "military") {
    return "BW-A";
  }

  if (context === "kta") {
    return "Gruppe C";
  }

  if (input.serviceType === "leitstelle") {
    return "NSL-FK";
  }

  if (input.serviceType === "revierdienst") {
    return "REV1";
  }

  return "EG2";
}

function getDefaultTimeModelHours(model: TariffTimeModel): number {
  switch (model) {
    case "night":
      return 180;
    case "twentyfourseven":
      return 720;
    case "patrol":
      return 90;
    default:
      return 200;
  }
}

function deriveTechSetup(plannerOutput: PlannerOutputInput | undefined, decisions: string[]): TechSetup {
  const cameras = clampInt(plannerOutput?.cameras);
  const towers = Math.max(clampInt(plannerOutput?.towers), cameras > 0 ? 1 : 0);
  const requestedRecorders = clampInt(plannerOutput?.recorders);
  const requestedSwitches = clampInt(plannerOutput?.switches);

  const inferredRecorders = cameras > 0 ? Math.max(1, Math.ceil(cameras / 16)) : 0;
  const recorders = Math.max(requestedRecorders, inferredRecorders);

  if (cameras > 0 && requestedRecorders < inferredRecorders) {
    decisions.push(`Recorder automatisch ergänzt (${inferredRecorders}), da ${cameras} Kameras erkannt wurden.`);
  }

  const networkDevices = cameras + recorders + towers;
  const inferredSwitches = networkDevices > 0 ? Math.max(1, Math.ceil(networkDevices / 12)) : 0;
  const switches = Math.max(requestedSwitches, inferredSwitches);

  if (networkDevices > 0 && requestedSwitches < inferredSwitches) {
    decisions.push(`Switches automatisch ergänzt (${inferredSwitches}), damit ${networkDevices} Geräte angebunden werden.`);
  }

  if (clampInt(plannerOutput?.obstacles) > 0) {
    decisions.push(`Hindernisse im Plan berücksichtigt: ${clampInt(plannerOutput?.obstacles)}.`);
  }

  return {
    cameras,
    towers,
    recorders,
    switches,
  };
}

function buildTariffResult(input: IntegratedOfferInput, decisions: string[], patrol: PatrolCalculationResult | undefined): TariffCalculationResult {
  const context = resolveTariffContext({
    tariffContext: input.tariffContext,
    serviceContext: input.serviceContext,
    serviceType: input.serviceType,
    wageGroup: input.wageGroup,
  });
  const serviceContext = input.serviceContext?.trim() || getDefaultServiceContext(input.serviceType);
  const wageGroup = getDefaultWageGroup(input, context);

  const resolved = resolveTariff({
    dataset: input.tariffDataset,
    tariffContext: context,
    state: input.state,
    serviceContext,
    serviceType: getTariffServiceType(input, context),
    wageGroup,
    dutyDurationHours: input.dutyDurationHours,
    shiftStartIso: input.shiftStartIso,
    shiftEndIso: input.shiftEndIso,
  });

  const monthlyHours = patrol
    ? Math.max(1, roundMoney(patrol.totalHours * Math.max(1, input.patrolInput?.weekdays ?? 30)))
    : getDefaultTimeModelHours(input.timeModel);

  const labor = calculateLaborCost({
    tariffBasisPerHour: resolved.calculationBasisPerHour,
    employerCostFactor: Number.isFinite(input.employerCostFactor) ? Number(input.employerCostFactor) : 1.34,
  });

  const sales = calculateSalesPrice({
    employerCostPerHour: labor.employerCostPerHour,
    targetMargin: input.targetMargin,
  });

  decisions.push(`Tarifkontext '${context}' auf Basis ${resolved.tariffSet.title} (${resolved.tariffSet.sourceDate}) angewendet.`);
  if (resolved.fallbackApplied) {
    decisions.push(
      `Tarif-Fallback aktiv: ${resolved.fallbackReason ?? "fehlender Tarifeintrag, Ersatzsatz verwendet."}`
    );
  }

  return {
    context,
    resolved,
    monthlyHours,
    laborCostPerHour: labor.laborCostPerHour,
    employerCostPerHour: labor.employerCostPerHour,
    saleHourlyRate: sales.salesPricePerHour,
    employerCostFactor: labor.employerCostFactor,
    targetMargin: sales.targetMargin,
    monthlyLaborCost: roundMoney(labor.employerCostPerHour * monthlyHours),
    monthlySalesValue: roundMoney(sales.salesPricePerHour * monthlyHours),
  };
}

function buildLineItems(
  input: IntegratedOfferInput,
  tech: TechSetup,
  tariff: TariffCalculationResult,
  decisions: string[],
  patrol: PatrolCalculationResult | undefined
): QuoteLineItem[] {
  const items: QuoteLineItem[] = [];

  if (input.serviceType === "revierdienst") {
    const patrolHours = patrol ? Math.max(1, roundMoney(patrol.totalHours * Math.max(1, input.patrolInput?.weekdays ?? 30))) : tariff.monthlyHours;
    items.push(
      createLineItem({
        type: "control_run",
        label: "Revierdienst (zeitbasiert kalkuliert)",
        quantity: patrolHours,
        unit: "Std/Monat",
        unitPrice: tariff.saleHourlyRate,
        billingMode: "recurring",
        interval: "monthly",
        category: "personell",
      })
    );
    decisions.push(`Revierkalkulation zeitbasiert: ${patrolHours} Std./Monat.`);
  } else {
    items.push(
      createLineItem({
        type: "guard_hour",
        label: `Tarifleistung ${input.state} (${input.timeModel})`,
        quantity: tariff.monthlyHours,
        unit: "Std/Monat",
        unitPrice: tariff.saleHourlyRate,
        billingMode: "recurring",
        interval: "monthly",
        category: "personell",
      })
    );
  }

  const monthlyCatalog = {
    camera: 59,
    tower: 1890,
    recorder: 149,
    switch: 69,
  };

  if (tech.cameras > 0) {
    items.push(
      createLineItem({
        type: "service",
        label: "Kamera-Miete inkl. Basis-Monitoring",
        quantity: tech.cameras,
        unit: "Stk/Monat",
        unitPrice: monthlyCatalog.camera,
        billingMode: "recurring",
        interval: "monthly",
        category: "equipment",
      })
    );
  }

  if (tech.towers > 0) {
    items.push(
      createLineItem({
        type: "videotower",
        label: "Sicherheitsturm (inkl. Mast/Träger)",
        quantity: tech.towers,
        unit: "Stk/Monat",
        unitPrice: monthlyCatalog.tower,
        billingMode: "recurring",
        interval: "monthly",
        category: "operations",
      })
    );
  }

  if (tech.recorders > 0) {
    items.push(
      createLineItem({
        type: "service",
        label: "NVR-Aufzeichnungseinheit",
        quantity: tech.recorders,
        unit: "Stk/Monat",
        unitPrice: monthlyCatalog.recorder,
        billingMode: "recurring",
        interval: "monthly",
        category: "equipment",
      })
    );
  }

  if (tech.switches > 0) {
    items.push(
      createLineItem({
        type: "service",
        label: "PoE-Switch/Netzwerkverteilung",
        quantity: tech.switches,
        unit: "Stk/Monat",
        unitPrice: monthlyCatalog.switch,
        billingMode: "recurring",
        interval: "monthly",
        category: "connectivity",
      })
    );
  }

  if (tech.cameras + tech.towers + tech.recorders + tech.switches > 0) {
    items.push(
      createLineItem({
        type: "setup",
        label: "Inbetriebnahme, Parametrierung und Abnahme",
        quantity: 1,
        unit: "Paket",
        unitPrice: 890,
        billingMode: "one_time",
        interval: "once",
        category: "deployment",
      })
    );
  }

  return items;
}

function buildText(
  input: IntegratedOfferInput,
  tech: TechSetup,
  draftTotals: IntegratedOfferDraft["totals"],
  tariff: TariffCalculationResult,
  patrol: PatrolCalculationResult | undefined
): OfferTextSections {
  const introduction = `Vielen Dank für Ihre Anfrage. Für ${input.projectName} am Standort ${input.serviceAddress} haben wir die Leistung als integriertes Sicherheitskonzept kalkuliert.`;

  const serviceDescription = `Die Leistung basiert auf dem Tarifkontext ${tariff.context} (${tariff.resolved.tariffSet.title}) und berücksichtigt Zuschläge, Sonderregeln sowie Arbeitgeberkosten.`;

  const patrolInfo = patrol
    ? ` Revierlogik: ${patrol.controlsCount} Kontrollen, Fahrzeit ${patrol.driveToMinutes} min, Kontrollzeit gesamt ${patrol.controlMinutesTotal} min, Gesamtzeit ${patrol.totalHours} Std./Tour.`
    : "";

  const details = `Technik-Setup: ${tech.cameras} Kameras, ${tech.towers} Türme, ${tech.recorders} Recorder, ${tech.switches} Switches. Laufzeit: ${input.runtimeMonths} Monat(e).${patrolInfo}`;

  const pricingBlock = `Monatlich: ${formatCurrency(draftTotals.monthlyTotal)} | Einmalig: ${formatCurrency(draftTotals.oneTimeTotal)} | Netto gesamt: ${formatCurrency(draftTotals.totalNet)} | Brutto: ${formatCurrency(draftTotals.totalGross)}.`;

  const closing = input.notes?.trim()
    ? `Hinweise: ${input.notes.trim()}\n\n${input.settings?.closingText ?? "Mit freundlichen Gruessen"}`
    : input.settings?.closingText ?? "Mit freundlichen Gruessen";

  const combined = [
    introduction,
    "",
    serviceDescription,
    "",
    details,
    "",
    pricingBlock,
    "",
    closing,
  ].join("\n");

  return {
    introduction,
    serviceDescription,
    details,
    pricingBlock,
    closing,
    combined,
  };
}

function buildTariffSnapshot(tariff: TariffCalculationResult): TariffSnapshot {
  return {
    tariffContext: tariff.context,
    tariffSet: tariff.resolved.tariffSet.key,
    tariffVersionDate: tariff.resolved.tariffSet.sourceDate,
    state: tariff.resolved.state,
    serviceType: tariff.resolved.serviceType,
    serviceContext: tariff.resolved.serviceContext,
    wageGroup: tariff.resolved.wageGroup,
    matchedServiceType: tariff.resolved.matchedServiceType,
    matchedServiceContext: tariff.resolved.matchedServiceContext,
    matchedWageGroup: tariff.resolved.matchedWageGroup,
    fallbackApplied: tariff.resolved.fallbackApplied,
    fallbackReason: tariff.resolved.fallbackReason,
    dutyDurationHours: tariff.resolved.dutyDurationHours,
    appliedBaseRate: tariff.resolved.appliedBaseRate,
    appliedSurcharges: tariff.resolved.appliedSurcharges,
    appliedSpecialRules: tariff.resolved.appliedSpecialRules,
    employerCostFactor: tariff.employerCostFactor,
    targetMargin: tariff.targetMargin,
    calculationBasisPerHour: tariff.resolved.calculationBasisPerHour,
    saleHourlyRate: tariff.saleHourlyRate,
  };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function buildIntegratedOfferDraft(input: IntegratedOfferInput): IntegratedOfferDraft {
  const runtimeMonths = Number.isFinite(input.runtimeMonths) ? Math.max(1, Math.round(input.runtimeMonths)) : 1;
  const decisions: string[] = [];

  const techSetup = deriveTechSetup(input.plannerOutput, decisions);
  const patrol = input.serviceType === "revierdienst" && input.patrolInput
    ? calculatePatrolService(input.patrolInput)
    : undefined;
  const tariff = buildTariffResult(input, decisions, patrol);

  const lineItems = buildLineItems(input, techSetup, tariff, decisions, patrol);

  const totals = calculateQuoteTotals({
    lineItems,
    durationMonths: runtimeMonths,
    discountAmount: Number.isFinite(input.discountAmount) ? Math.max(0, Number(input.discountAmount)) : 0,
    vatRate: Number.isFinite(input.settings?.vatRate) ? Math.max(0, Number(input.settings?.vatRate)) : 0.19,
  });

  const mappedTotals: IntegratedOfferDraft["totals"] = {
    monthlyTotal: totals.monthlyTotal,
    oneTimeTotal: totals.oneTimeTotal,
    subtotal: totals.subtotal,
    totalNet: totals.totalNet,
    totalGross: totals.totalGross,
    discountAmount: totals.discountAmount,
    vatRate: totals.vatRate,
    durationMonths: totals.durationMonths,
  };

  const text = buildText(input, techSetup, mappedTotals, tariff, patrol);

  return {
    lineItems: totals.lineItems,
    totals: mappedTotals,
    tariff,
    techSetup,
    decisions,
    text,
    tariffSnapshot: buildTariffSnapshot(tariff),
    patrol,
  };
}
