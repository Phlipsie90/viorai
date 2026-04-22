import type { SupabaseClient } from "@supabase/supabase-js";

export type TariffContext = "standard" | "military" | "kta";

export interface TariffSetRow {
  id: string;
  key: string;
  title: string;
  category: TariffContext;
  source_name: string;
  source_date: string;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
  notes: string | null;
}

export interface TariffEntryRow {
  id: string;
  tariff_set_id: string;
  state: string;
  service_context: string;
  service_type: string;
  wage_group: string;
  duration_from_hours: number | null;
  duration_to_hours: number | null;
  hourly_rate: number;
  note: string | null;
  sort_order: number;
}

export interface TariffSurchargeRow {
  id: string;
  tariff_set_id: string;
  state: string;
  surcharge_type: "night" | "sunday" | "holiday";
  mode: "percent" | "absolute";
  value: number;
  time_from: string | null;
  time_to: string | null;
  applies_to_service_type: string | null;
  note: string | null;
}

export interface TariffSpecialRuleRow {
  id: string;
  tariff_set_id: string;
  state: string;
  rule_type: string;
  condition_json: Record<string, unknown>;
  result_json: Record<string, unknown>;
  note: string | null;
}

export interface HolidayRow {
  id: string;
  state: string;
  date: string;
  name: string;
}

export interface TariffDataset {
  sets: TariffSetRow[];
  entries: TariffEntryRow[];
  surcharges: TariffSurchargeRow[];
  specialRules: TariffSpecialRuleRow[];
  holidays: HolidayRow[];
}

export interface ResolveTariffContextInput {
  tariffContext?: TariffContext | null;
  serviceContext?: string;
  serviceType?: string;
  wageGroup?: string;
}

export interface ResolveTariffInput {
  dataset: TariffDataset;
  tariffContext?: TariffContext | null;
  state: string;
  serviceContext: string;
  serviceType: string;
  wageGroup: string;
  dutyDurationHours?: number;
  shiftStartIso?: string;
  shiftEndIso?: string;
}

export interface AppliedSurcharge {
  surchargeType: "night" | "sunday" | "holiday";
  mode: "percent" | "absolute";
  value: number;
  amountPerHour: number;
  note?: string;
}

export interface AppliedSpecialRule {
  ruleType: string;
  note?: string;
  absoluteHourlyAdd: number;
  percentAdd: number;
}

export interface ResolvedTariff {
  tariffContext: TariffContext;
  tariffSet: {
    id: string;
    key: string;
    title: string;
    sourceDate: string;
    sourceName: string;
  };
  state: string;
  serviceContext: string;
  serviceType: string;
  wageGroup: string;
  matchedServiceContext: string;
  matchedServiceType: string;
  matchedWageGroup: string;
  dutyDurationHours?: number;
  appliedBaseRate: number;
  adjustedBaseRate: number;
  appliedSurcharges: AppliedSurcharge[];
  appliedSpecialRules: AppliedSpecialRule[];
  calculationBasisPerHour: number;
}

export interface LaborCostResult {
  laborCostPerHour: number;
  employerCostPerHour: number;
  employerCostFactor: number;
}

export interface SalesPriceResult {
  salesPricePerHour: number;
  targetMargin: number;
}

export interface ResolvedSurchargePercents {
  night: number;
  sunday: number;
  holiday: number;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeState(state: string): string {
  const key = normalizeKey(state);
  if (!key) {
    return "all";
  }

  const map: Record<string, string> = {
    "baden-württemberg": "baden-wuerttemberg",
    "baden württemberg": "baden-wuerttemberg",
    "baden-wuerttemberg": "baden-wuerttemberg",
    thüringen: "thueringen",
    thuringen: "thueringen",
    nrw: "nordrhein-westfalen",
    "nordrhein westfalen": "nordrhein-westfalen",
    "rheinland pfalz": "rheinland-pfalz",
    "rheinland-pfalz-/": "rheinland-pfalz",
    "mecklenburg vorpommern": "mecklenburg-vorpommern",
    "mecklenburg-": "mecklenburg-vorpommern",
    "sachsen anhalt": "sachsen-anhalt",
    "schleswig holstein": "schleswig-holstein",
  };

  return map[key] ?? key;
}

function parseIsoDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function inValidity(set: TariffSetRow, onDate: Date): boolean {
  const from = parseIsoDate(set.valid_from);
  const to = parseIsoDate(set.valid_to);

  if (!from) {
    return false;
  }

  if (onDate < from) {
    return false;
  }

  if (to && onDate > to) {
    return false;
  }

  return true;
}

function resolveShiftDate(input: ResolveTariffInput): Date {
  const fromIso = input.shiftStartIso ? new Date(input.shiftStartIso) : null;
  if (fromIso && !Number.isNaN(fromIso.getTime())) {
    return fromIso;
  }

  return new Date();
}

export function resolveTariffContext(input: ResolveTariffContextInput): TariffContext {
  if (input.tariffContext) {
    return input.tariffContext;
  }

  const serviceContext = normalizeKey(input.serviceContext ?? "");
  const serviceType = normalizeKey(input.serviceType ?? "");
  const wageGroup = normalizeKey(input.wageGroup ?? "");

  if (serviceContext.includes("milit") || serviceType.includes("bundeswehr")) {
    return "military";
  }

  if (serviceContext.includes("kta") || serviceType.includes("kern") || wageGroup.includes("ok ") || wageGroup.includes("gruppe c")) {
    return "kta";
  }

  return "standard";
}

export function resolveTariffEntry(input: ResolveTariffInput): {
  tariffContext: TariffContext;
  set: TariffSetRow;
  entry: TariffEntryRow;
} {
  const tariffContext = resolveTariffContext(input);
  const state = normalizeState(input.state);
  const now = resolveShiftDate(input);
  const requestedWageGroup = input.wageGroup?.trim();

  if (!requestedWageGroup) {
    throw new Error("wage_group ist erforderlich und darf nicht leer sein.");
  }

  const activeSets = input.dataset.sets
    .filter((set) => set.is_active && set.category === tariffContext && inValidity(set, now))
    .sort((a, b) => b.source_date.localeCompare(a.source_date));

  if (activeSets.length === 0) {
    throw new Error(`Kein aktives Tarifset für Kontext '${tariffContext}' gefunden.`);
  }

  const selectedSet = activeSets[0];
  const duration = Number.isFinite(input.dutyDurationHours) ? Number(input.dutyDurationHours) : null;
  const requestedServiceContext = normalizeKey(input.serviceContext);
  const requestedServiceType = normalizeKey(input.serviceType);
  const normalizedRequestedWageGroup = normalizeKey(requestedWageGroup);

  const bySet = input.dataset.entries.filter((entry) => entry.tariff_set_id === selectedSet.id);
  const stateCandidates = bySet.filter((entry) => entry.state === state || entry.state === "all");

  const isDurationMatch = (entry: TariffEntryRow): boolean => {
    if (duration === null) {
      return entry.duration_from_hours === null && entry.duration_to_hours === null;
    }

    const min = entry.duration_from_hours ?? Number.NEGATIVE_INFINITY;
    const max = entry.duration_to_hours ?? Number.POSITIVE_INFINITY;
    return duration >= min && duration < max;
  };

  const exactCandidates = stateCandidates.filter((entry) =>
    normalizeKey(entry.service_context) === requestedServiceContext
    && normalizeKey(entry.service_type) === requestedServiceType
    && normalizeKey(entry.wage_group) === normalizedRequestedWageGroup
  );
  const matchingDuration = exactCandidates.filter(isDurationMatch);
  const finalCandidates = matchingDuration.length > 0 ? matchingDuration : exactCandidates;

  const selectedEntry = [...finalCandidates].sort((a, b) => {
    const stateRankA = a.state === state ? 0 : 1;
    const stateRankB = b.state === state ? 0 : 1;
    if (stateRankA !== stateRankB) {
      return stateRankA - stateRankB;
    }
    return a.sort_order - b.sort_order;
  })[0];

  if (!selectedEntry) {
    throw new Error(
      `Kein Tarifeintrag gefunden (Kontext=${tariffContext}, Bundesland=${state}, Service=${input.serviceType}, Gruppe=${requestedWageGroup}).`
    );
  }

  return {
    tariffContext,
    set: selectedSet,
    entry: selectedEntry,
  };
}

function isSunday(date: Date): boolean {
  return date.getDay() === 0;
}

function isHoliday(dataset: TariffDataset, state: string, date: Date): boolean {
  const key = date.toISOString().slice(0, 10);
  return dataset.holidays.some((holiday) =>
    holiday.date === key && (holiday.state === state || holiday.state === "all")
  );
}

function parseTimeToMinutes(timeValue: string): number {
  const [h, m] = timeValue.split(":").map((entry) => Number(entry));
  const safeH = Number.isFinite(h) ? h : 0;
  const safeM = Number.isFinite(m) ? m : 0;
  return safeH * 60 + safeM;
}

function isInsideTimeWindow(shiftDate: Date, timeFrom: string | null, timeTo: string | null): boolean {
  if (!timeFrom || !timeTo) {
    return true;
  }

  const current = shiftDate.getHours() * 60 + shiftDate.getMinutes();
  const from = parseTimeToMinutes(timeFrom);
  const to = parseTimeToMinutes(timeTo);

  if (from <= to) {
    return current >= from && current < to;
  }

  return current >= from || current < to;
}

export function resolveApplicableSurcharges(input: {
  dataset: TariffDataset;
  selectedSet: TariffSetRow;
  state: string;
  serviceType: string;
  shiftDate: Date;
  baseRate: number;
}): AppliedSurcharge[] {
  const normalizedState = normalizeState(input.state);
  const isShiftSunday = isSunday(input.shiftDate);
  const isShiftHoliday = isHoliday(input.dataset, normalizedState, input.shiftDate);

  return input.dataset.surcharges
    .filter((surcharge) => surcharge.tariff_set_id === input.selectedSet.id)
    .filter((surcharge) => surcharge.state === normalizedState || surcharge.state === "all")
    .filter((surcharge) => !surcharge.applies_to_service_type || normalizeKey(surcharge.applies_to_service_type) === normalizeKey(input.serviceType))
    .filter((surcharge) => isInsideTimeWindow(input.shiftDate, surcharge.time_from, surcharge.time_to))
    .filter((surcharge) => {
      if (surcharge.surcharge_type === "sunday") {
        return isShiftSunday;
      }
      if (surcharge.surcharge_type === "holiday") {
        return isShiftHoliday;
      }
      return true;
    })
    .map((surcharge) => {
      const amountPerHour = surcharge.mode === "percent"
        ? (input.baseRate * surcharge.value) / 100
        : surcharge.value;

      return {
        surchargeType: surcharge.surcharge_type,
        mode: surcharge.mode,
        value: surcharge.value,
        amountPerHour: roundMoney(amountPerHour),
        note: surcharge.note ?? undefined,
      };
    });
}

function specialRuleMatches(rule: TariffSpecialRuleRow, input: ResolveTariffInput, state: string): boolean {
  if (!(rule.state === state || rule.state === "all")) {
    return false;
  }

  const expectedServiceType = typeof rule.condition_json.service_type === "string"
    ? normalizeKey(rule.condition_json.service_type)
    : null;
  const expectedServiceContext = typeof rule.condition_json.service_context === "string"
    ? normalizeKey(rule.condition_json.service_context)
    : null;
  const expectedWageGroup = typeof rule.condition_json.wage_group === "string"
    ? normalizeKey(rule.condition_json.wage_group)
    : null;

  if (expectedServiceType && expectedServiceType !== normalizeKey(input.serviceType)) {
    return false;
  }

  if (expectedServiceContext && expectedServiceContext !== normalizeKey(input.serviceContext)) {
    return false;
  }

  if (expectedWageGroup && expectedWageGroup !== normalizeKey(input.wageGroup)) {
    return false;
  }

  return true;
}

export function applySpecialRules(input: {
  dataset: TariffDataset;
  selectedSet: TariffSetRow;
  state: string;
  request: ResolveTariffInput;
}): AppliedSpecialRule[] {
  const normalizedState = normalizeState(input.state);

  return input.dataset.specialRules
    .filter((rule) => rule.tariff_set_id === input.selectedSet.id)
    .filter((rule) => specialRuleMatches(rule, input.request, normalizedState))
    .map((rule) => ({
      ruleType: rule.rule_type,
      note: rule.note ?? undefined,
      absoluteHourlyAdd: Number.isFinite(rule.result_json.absolute_hourly_add as number)
        ? Number(rule.result_json.absolute_hourly_add as number)
        : 0,
      percentAdd: Number.isFinite(rule.result_json.percent_add as number)
        ? Number(rule.result_json.percent_add as number)
        : 0,
    }));
}

export function calculateTariffBase(input: {
  baseRate: number;
  surcharges: AppliedSurcharge[];
  specialRules: AppliedSpecialRule[];
}): number {
  const surchargeTotal = input.surcharges.reduce((sum, surcharge) => sum + surcharge.amountPerHour, 0);
  const specialAbsolute = input.specialRules.reduce((sum, rule) => sum + rule.absoluteHourlyAdd, 0);
  const specialPercent = input.specialRules.reduce((sum, rule) => sum + rule.percentAdd, 0);

  const interim = input.baseRate + surchargeTotal + specialAbsolute;
  return roundMoney(interim * (1 + specialPercent / 100));
}

export function calculateLaborCost(input: {
  tariffBasisPerHour: number;
  employerCostFactor: number;
}): LaborCostResult {
  const factor = Number.isFinite(input.employerCostFactor) ? Math.max(1, input.employerCostFactor) : 1.34;
  const employerCostPerHour = roundMoney(input.tariffBasisPerHour * factor);

  return {
    laborCostPerHour: roundMoney(input.tariffBasisPerHour),
    employerCostPerHour,
    employerCostFactor: factor,
  };
}

export function calculateSalesPrice(input: {
  employerCostPerHour: number;
  targetMargin: number;
}): SalesPriceResult {
  const margin = Number.isFinite(input.targetMargin) ? Math.min(0.65, Math.max(0.05, input.targetMargin)) : 0.22;
  const salesPricePerHour = roundMoney(input.employerCostPerHour * (1 + margin));

  return {
    salesPricePerHour,
    targetMargin: margin,
  };
}

export function resolveTariff(input: ResolveTariffInput): ResolvedTariff {
  const selected = resolveTariffEntry(input);
  const surcharges: AppliedSurcharge[] = [];
  const rules: AppliedSpecialRule[] = [];
  const basis = roundMoney(selected.entry.hourly_rate);

  return {
    tariffContext: selected.tariffContext,
    tariffSet: {
      id: selected.set.id,
      key: selected.set.key,
      title: selected.set.title,
      sourceDate: selected.set.source_date,
      sourceName: selected.set.source_name,
    },
    state: normalizeState(input.state),
    serviceContext: input.serviceContext,
    serviceType: input.serviceType,
    wageGroup: input.wageGroup,
    matchedServiceContext: selected.entry.service_context,
    matchedServiceType: selected.entry.service_type,
    matchedWageGroup: selected.entry.wage_group,
    dutyDurationHours: Number.isFinite(input.dutyDurationHours) ? Number(input.dutyDurationHours) : undefined,
    appliedBaseRate: roundMoney(selected.entry.hourly_rate),
    adjustedBaseRate: basis,
    appliedSurcharges: surcharges,
    appliedSpecialRules: rules,
    calculationBasisPerHour: basis,
  };
}

export function resolveNightSurchargePercent(input: {
  dataset: TariffDataset;
  tariffSetId: string;
  state: string;
  serviceType: string;
  baseRate: number;
}): number {
  const normalizedState = normalizeState(input.state);
  const normalizedServiceType = normalizeKey(input.serviceType);

  const candidates = input.dataset.surcharges
    .filter((entry) => entry.tariff_set_id === input.tariffSetId)
    .filter((entry) => entry.surcharge_type === "night")
    .filter((entry) => entry.state === normalizedState || entry.state === "all")
    .filter((entry) => !entry.applies_to_service_type || normalizeKey(entry.applies_to_service_type) === normalizedServiceType);

  if (candidates.length === 0) {
    return 0;
  }

  const normalizedPercents = candidates.map((entry) => {
    if (entry.mode === "percent") {
      return entry.value / 100;
    }
    if (input.baseRate <= 0) {
      return 0;
    }
    return entry.value / input.baseRate;
  });

  const maxPercent = Math.max(...normalizedPercents, 0);
  return Number.isFinite(maxPercent) ? maxPercent : 0;
}

function resolveSurchargePercent(input: {
  dataset: TariffDataset;
  tariffSetId: string;
  state: string;
  serviceType: string;
  baseRate: number;
  surchargeType: "night" | "sunday" | "holiday";
}): number {
  const normalizedState = normalizeState(input.state);
  const normalizedServiceType = normalizeKey(input.serviceType);

  const candidates = input.dataset.surcharges
    .filter((entry) => entry.tariff_set_id === input.tariffSetId)
    .filter((entry) => entry.surcharge_type === input.surchargeType)
    .filter((entry) => entry.state === normalizedState || entry.state === "all")
    .filter((entry) => !entry.applies_to_service_type || normalizeKey(entry.applies_to_service_type) === normalizedServiceType);

  if (candidates.length === 0) {
    return 0;
  }

  const normalizedPercents = candidates.map((entry) => {
    if (entry.mode === "percent") {
      return entry.value / 100;
    }
    if (input.baseRate <= 0) {
      return 0;
    }
    return entry.value / input.baseRate;
  });

  const maxPercent = Math.max(...normalizedPercents, 0);
  return Number.isFinite(maxPercent) ? maxPercent : 0;
}

export function resolveSurchargePercents(input: {
  dataset: TariffDataset;
  tariffSetId: string;
  state: string;
  serviceType: string;
  baseRate: number;
}): ResolvedSurchargePercents {
  return {
    night: resolveSurchargePercent({ ...input, surchargeType: "night" }),
    sunday: resolveSurchargePercent({ ...input, surchargeType: "sunday" }),
    holiday: resolveSurchargePercent({ ...input, surchargeType: "holiday" }),
  };
}

export async function loadTariffDataset(supabase: SupabaseClient): Promise<TariffDataset> {
  const [setsResult, entriesResult, surchargesResult, rulesResult, holidaysResult] = await Promise.all([
    supabase.from("tariff_sets").select("id,key,title,category,source_name,source_date,valid_from,valid_to,is_active,notes"),
    supabase.from("tariff_entries").select("id,tariff_set_id,state,service_context,service_type,wage_group,duration_from_hours,duration_to_hours,hourly_rate,note,sort_order"),
    supabase.from("tariff_surcharges").select("id,tariff_set_id,state,surcharge_type,mode,value,time_from,time_to,applies_to_service_type,note"),
    supabase.from("tariff_special_rules").select("id,tariff_set_id,state,rule_type,condition_json,result_json,note"),
    supabase.from("holidays").select("id,state,date,name"),
  ]);

  const errors = [setsResult.error, entriesResult.error, surchargesResult.error, rulesResult.error, holidaysResult.error].filter(Boolean);
  if (errors.length > 0) {
    throw new Error(errors[0]?.message ?? "Tarifdaten konnten nicht geladen werden.");
  }

  return {
    sets: (setsResult.data ?? []) as TariffSetRow[],
    entries: (entriesResult.data ?? []) as TariffEntryRow[],
    surcharges: (surchargesResult.data ?? []) as TariffSurchargeRow[],
    specialRules: (rulesResult.data ?? []) as TariffSpecialRuleRow[],
    holidays: (holidaysResult.data ?? []) as HolidayRow[],
  };
}
