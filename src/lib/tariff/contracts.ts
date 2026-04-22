export type GermanFederalState =
  | "baden-wuerttemberg"
  | "bayern"
  | "berlin"
  | "brandenburg"
  | "bremen"
  | "hamburg"
  | "hessen"
  | "mecklenburg-vorpommern"
  | "niedersachsen"
  | "nordrhein-westfalen"
  | "rheinland-pfalz"
  | "saarland"
  | "sachsen"
  | "sachsen-anhalt"
  | "schleswig-holstein"
  | "thueringen";

export type TariffTimeModel = "day" | "night" | "twentyfourseven" | "patrol";

export interface TariffContract {
  state: GermanFederalState;
  hourlyWageEur: number;
  saturdaySurchargePercent: number;
  sundaySurchargePercent: number;
  holidaySurchargePercent: number;
  nightSurchargePercent: number;
  employerCostFactor: number;
}

export interface TariffCalculationInput {
  state: string;
  timeModel: TariffTimeModel;
  targetMargin: number;
  runtimeMonths: number;
  weekdayHoursPerMonth?: number;
  saturdayHoursPerMonth?: number;
  sundayHoursPerMonth?: number;
  holidayHoursPerMonth?: number;
  nightHoursPerMonth?: number;
}

export interface TariffCalculationResult {
  contract: TariffContract;
  weightedHourlyWageEur: number;
  employerHourlyCostEur: number;
  saleHourlyRateEur: number;
  monthlyHours: number;
  monthlyEmployerCostEur: number;
  monthlySaleEur: number;
  runtimeMonths: number;
  runtimeSaleEur: number;
  targetMargin: number;
}

const DEFAULT_TIME_MODEL_HOURS: Record<TariffTimeModel, {
  weekday: number;
  saturday: number;
  sunday: number;
  holiday: number;
  night: number;
}> = {
  day: {
    weekday: 180,
    saturday: 28,
    sunday: 12,
    holiday: 0,
    night: 0,
  },
  night: {
    weekday: 132,
    saturday: 26,
    sunday: 22,
    holiday: 4,
    night: 184,
  },
  twentyfourseven: {
    weekday: 440,
    saturday: 112,
    sunday: 104,
    holiday: 8,
    night: 260,
  },
  patrol: {
    weekday: 72,
    saturday: 18,
    sunday: 10,
    holiday: 2,
    night: 24,
  },
};

const STATE_TARIFFS: Record<GermanFederalState, TariffContract> = {
  "baden-wuerttemberg": {
    state: "baden-wuerttemberg",
    hourlyWageEur: 18.4,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 15,
    employerCostFactor: 1.34,
  },
  bayern: {
    state: "bayern",
    hourlyWageEur: 18.1,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 15,
    employerCostFactor: 1.34,
  },
  berlin: {
    state: "berlin",
    hourlyWageEur: 18.9,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 20,
    employerCostFactor: 1.35,
  },
  brandenburg: {
    state: "brandenburg",
    hourlyWageEur: 17.6,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 15,
    employerCostFactor: 1.33,
  },
  bremen: {
    state: "bremen",
    hourlyWageEur: 17.9,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 15,
    employerCostFactor: 1.33,
  },
  hamburg: {
    state: "hamburg",
    hourlyWageEur: 18.6,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 15,
    employerCostFactor: 1.34,
  },
  hessen: {
    state: "hessen",
    hourlyWageEur: 18.2,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 15,
    employerCostFactor: 1.34,
  },
  "mecklenburg-vorpommern": {
    state: "mecklenburg-vorpommern",
    hourlyWageEur: 17.3,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 15,
    employerCostFactor: 1.33,
  },
  niedersachsen: {
    state: "niedersachsen",
    hourlyWageEur: 17.8,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 15,
    employerCostFactor: 1.33,
  },
  "nordrhein-westfalen": {
    state: "nordrhein-westfalen",
    hourlyWageEur: 18.0,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 15,
    employerCostFactor: 1.34,
  },
  "rheinland-pfalz": {
    state: "rheinland-pfalz",
    hourlyWageEur: 17.7,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 15,
    employerCostFactor: 1.33,
  },
  saarland: {
    state: "saarland",
    hourlyWageEur: 17.5,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 15,
    employerCostFactor: 1.33,
  },
  sachsen: {
    state: "sachsen",
    hourlyWageEur: 17.4,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 15,
    employerCostFactor: 1.33,
  },
  "sachsen-anhalt": {
    state: "sachsen-anhalt",
    hourlyWageEur: 17.2,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 15,
    employerCostFactor: 1.32,
  },
  "schleswig-holstein": {
    state: "schleswig-holstein",
    hourlyWageEur: 17.9,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 15,
    employerCostFactor: 1.33,
  },
  thueringen: {
    state: "thueringen",
    hourlyWageEur: 17.2,
    saturdaySurchargePercent: 25,
    sundaySurchargePercent: 50,
    holidaySurchargePercent: 100,
    nightSurchargePercent: 15,
    employerCostFactor: 1.32,
  },
};

const STATE_ALIASES: Record<string, GermanFederalState> = {
  "baden wurttemberg": "baden-wuerttemberg",
  "baden-wuerttemberg": "baden-wuerttemberg",
  "baden-württemberg": "baden-wuerttemberg",
  bayern: "bayern",
  berlin: "berlin",
  brandenburg: "brandenburg",
  bremen: "bremen",
  hamburg: "hamburg",
  hessen: "hessen",
  "mecklenburg vorpommern": "mecklenburg-vorpommern",
  "mecklenburg-vorpommern": "mecklenburg-vorpommern",
  niedersachsen: "niedersachsen",
  nrw: "nordrhein-westfalen",
  "nordrhein westfalen": "nordrhein-westfalen",
  "nordrhein-westfalen": "nordrhein-westfalen",
  "rheinland pfalz": "rheinland-pfalz",
  "rheinland-pfalz": "rheinland-pfalz",
  saarland: "saarland",
  sachsen: "sachsen",
  "sachsen anhalt": "sachsen-anhalt",
  "sachsen-anhalt": "sachsen-anhalt",
  "schleswig holstein": "schleswig-holstein",
  "schleswig-holstein": "schleswig-holstein",
  thuringen: "thueringen",
  thüringen: "thueringen",
  thueringen: "thueringen",
};

function toRounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeStateKey(state: string): GermanFederalState {
  const key = state.trim().toLowerCase();
  const mapped = STATE_ALIASES[key];
  if (mapped) {
    return mapped;
  }
  return "nordrhein-westfalen";
}

function clampMargin(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.22;
  }
  return Math.min(0.6, Math.max(0.05, value));
}

function resolveHours(input: TariffCalculationInput): {
  weekday: number;
  saturday: number;
  sunday: number;
  holiday: number;
  night: number;
} {
  const defaults = DEFAULT_TIME_MODEL_HOURS[input.timeModel] ?? DEFAULT_TIME_MODEL_HOURS.day;

  return {
    weekday: Number.isFinite(input.weekdayHoursPerMonth) ? Math.max(0, Number(input.weekdayHoursPerMonth)) : defaults.weekday,
    saturday: Number.isFinite(input.saturdayHoursPerMonth) ? Math.max(0, Number(input.saturdayHoursPerMonth)) : defaults.saturday,
    sunday: Number.isFinite(input.sundayHoursPerMonth) ? Math.max(0, Number(input.sundayHoursPerMonth)) : defaults.sunday,
    holiday: Number.isFinite(input.holidayHoursPerMonth) ? Math.max(0, Number(input.holidayHoursPerMonth)) : defaults.holiday,
    night: Number.isFinite(input.nightHoursPerMonth) ? Math.max(0, Number(input.nightHoursPerMonth)) : defaults.night,
  };
}

export function listSupportedTariffStates(): Array<{ value: GermanFederalState; label: string }> {
  return [
    { value: "baden-wuerttemberg", label: "Baden-Wuerttemberg" },
    { value: "bayern", label: "Bayern" },
    { value: "berlin", label: "Berlin" },
    { value: "brandenburg", label: "Brandenburg" },
    { value: "bremen", label: "Bremen" },
    { value: "hamburg", label: "Hamburg" },
    { value: "hessen", label: "Hessen" },
    { value: "mecklenburg-vorpommern", label: "Mecklenburg-Vorpommern" },
    { value: "niedersachsen", label: "Niedersachsen" },
    { value: "nordrhein-westfalen", label: "Nordrhein-Westfalen" },
    { value: "rheinland-pfalz", label: "Rheinland-Pfalz" },
    { value: "saarland", label: "Saarland" },
    { value: "sachsen", label: "Sachsen" },
    { value: "sachsen-anhalt", label: "Sachsen-Anhalt" },
    { value: "schleswig-holstein", label: "Schleswig-Holstein" },
    { value: "thueringen", label: "Thueringen" },
  ];
}

export function calculateTariffSelling(input: TariffCalculationInput): TariffCalculationResult {
  const state = normalizeStateKey(input.state);
  const contract = STATE_TARIFFS[state];
  const margin = clampMargin(input.targetMargin);
  const runtimeMonths = Number.isFinite(input.runtimeMonths)
    ? Math.max(1, Math.round(Number(input.runtimeMonths)))
    : 1;
  const hours = resolveHours(input);
  const monthlyHours = hours.weekday + hours.saturday + hours.sunday + hours.holiday;

  const base = contract.hourlyWageEur;
  const hourlyWageWeighted = (
    base * hours.weekday
    + base * (1 + contract.saturdaySurchargePercent / 100) * hours.saturday
    + base * (1 + contract.sundaySurchargePercent / 100) * hours.sunday
    + base * (1 + contract.holidaySurchargePercent / 100) * hours.holiday
    + base * (contract.nightSurchargePercent / 100) * hours.night
  ) / Math.max(1, monthlyHours);

  const employerHourlyCost = hourlyWageWeighted * contract.employerCostFactor;
  const saleHourlyRate = employerHourlyCost / (1 - margin);
  const monthlyEmployerCost = employerHourlyCost * monthlyHours;
  const monthlySale = saleHourlyRate * monthlyHours;

  return {
    contract,
    weightedHourlyWageEur: toRounded(hourlyWageWeighted),
    employerHourlyCostEur: toRounded(employerHourlyCost),
    saleHourlyRateEur: toRounded(saleHourlyRate),
    monthlyHours: toRounded(monthlyHours),
    monthlyEmployerCostEur: toRounded(monthlyEmployerCost),
    monthlySaleEur: toRounded(monthlySale),
    runtimeMonths,
    runtimeSaleEur: toRounded(monthlySale * runtimeMonths),
    targetMargin: margin,
  };
}
