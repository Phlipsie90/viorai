import type { BillingInterval, BillingMode, QuoteLineItem, TowerPowerType, TowerTemplate } from "@/types";

export type PricingTowerTemplate = Pick<
  TowerTemplate,
  "id" | "label" | "powerType" | "powerMode" | "autark" | "pricing" | "cameraSlots"
>;

export type ConnectivityType = "none" | "lte" | "vpn" | "sat";

export interface TowerSelection {
  templateId: string;
  quantity: number;
}

export interface MonthlyFeatureOptions {
  nslEnabled: boolean;
  connectivity: ConnectivityType;
  servicePauschaleEnabled: boolean;
}

export interface OneTimeCostInput {
  transportDelivery: number;
  setup: number;
  teardown: number;
  transportReturn: number;
}

export interface OptionalCostInput {
  autarkySurcharge: number;
  lightPackage: number;
  specialServices: number;
  discountAmount: number;
}

export interface QuoteCalculationInput {
  towerSelections: TowerSelection[];
  durationMonths: number;
  monthlyOptions: MonthlyFeatureOptions;
  oneTimeCosts: OneTimeCostInput;
  optionalCosts: OptionalCostInput;
}

export interface PriceConfig {
  vatRate: number;
  nslMonthlyPerTower: number;
  connectivityMonthlyPerTower: Record<Exclude<ConnectivityType, "none">, number>;
  serviceMonthlyPerTower: number;
  templateMonthlyRateById: Record<string, number>;
}

export interface QuoteCalculationResult {
  lineItems: QuoteLineItem[];
  towerCount: number;
  durationMonths: number;
  monthlyTotal: number;
  oneTimeTotal: number;
  subtotal: number;
  discountAmount: number;
  totalNet: number;
  totalGross: number;
  vatRate: number;
}

export interface QuoteTotalsInput {
  lineItems: QuoteLineItem[];
  durationMonths: number;
  discountAmount: number;
  vatRate: number;
}

export interface QuoteTotalsResult {
  lineItems: QuoteLineItem[];
  durationMonths: number;
  monthlyTotal: number;
  oneTimeTotal: number;
  subtotal: number;
  discountAmount: number;
  totalNet: number;
  totalGross: number;
  vatRate: number;
}

export interface DerivedQuoteTotalsInput {
  lineItems: QuoteLineItem[];
  discountAmount: number;
  vatRate: number;
}

const TEMPLATE_RATE_FALLBACK = 1850;
const DEFAULT_PERSONNEL_STUNDEN_PRO_TAG = 8;
const DEFAULT_PERSONNEL_NACHT_STUNDEN_PRO_TAG = 0;
const DEFAULT_PERSONNEL_TAGE_WERKTAGE = 30;
const DEFAULT_PERSONNEL_TAGE_SAMSTAG = 0;
const DEFAULT_PERSONNEL_TAGE_SONNTAG = 0;
const DEFAULT_PERSONNEL_TAGE_FEIERTAG = 0;
const DEFAULT_REVIER_KONTROLLEN_WERKTAG = 2;
const DEFAULT_REVIER_KONTROLLEN_SAMSTAG = 1;
const DEFAULT_REVIER_KONTROLLEN_SONNTAG = 1;
const DEFAULT_REVIER_KONTROLLEN_FEIERTAG = 1;
const DEFAULT_REVIER_NACHT_KONTROLLEN_PRO_TAG = 0;
const DEFAULT_REVIER_TAGE_WERKTAGE = 30;
const DEFAULT_REVIER_TAGE_SAMSTAG = 0;
const DEFAULT_REVIER_TAGE_SONNTAG = 0;
const DEFAULT_REVIER_TAGE_FEIERTAG = 0;
const DEFAULT_SAMSTAG_ZUSCHLAG_PERCENT = 25;
const DEFAULT_SONNTAG_ZUSCHLAG_PERCENT = 50;
const DEFAULT_FEIERTAG_ZUSCHLAG_PERCENT = 100;
const DEFAULT_NACHT_ZUSCHLAG_PERCENT = 25;

export const DEFAULT_PRICE_CONFIG: PriceConfig = {
  vatRate: 0.19,
  nslMonthlyPerTower: 120,
  connectivityMonthlyPerTower: {
    lte: 45,
    vpn: 70,
    sat: 160,
  },
  serviceMonthlyPerTower: 80,
  templateMonthlyRateById: {},
};

export const DEFAULT_STANDARD_ONE_TIME_COSTS: OneTimeCostInput = {
  transportDelivery: 420,
  setup: 650,
  teardown: 520,
  transportReturn: 420,
};

export function createStandardQuoteLineItems(
  input: {
    towerSelections: TowerSelection[];
    oneTimeCosts: OneTimeCostInput;
  },
  config: PriceConfig = DEFAULT_PRICE_CONFIG,
  templateCatalog: PricingTowerTemplate[] = []
): QuoteLineItem[] {
  const lineItems: QuoteLineItem[] = [];

  for (const selection of input.towerSelections) {
    if (!selection.templateId) {
      continue;
    }

    const quantity = Math.max(0, Math.floor(selection.quantity));
    if (quantity <= 0) {
      continue;
    }

    const template = templateCatalog.find((entry) => entry.id === selection.templateId);
    const templateLabel = template?.label ?? selection.templateId;
    const monthlyRate =
      config.templateMonthlyRateById[selection.templateId] ??
      estimateTemplateMonthlyRate(selection.templateId, config, template);

    lineItems.push(
      createLineItem({
        type: "videotower",
        label: `Miete: ${templateLabel}`,
        quantity,
        unit: "Stk",
        unitPrice: monthlyRate,
        billingMode: "recurring",
        interval: "monthly",
        category: "equipment_rental",
        metadata: { templateId: selection.templateId },
      })
    );
  }

  lineItems.push(
    createLineItem({
      type: "transport",
      label: "Transport (Anlieferung)",
      quantity: 1,
      unit: "Einsatz",
      unitPrice: input.oneTimeCosts.transportDelivery,
      billingMode: "one_time",
      interval: "once",
      category: "logistics",
    }),
    createLineItem({
      type: "setup",
      label: "Aufbau",
      quantity: 1,
      unit: "Einsatz",
      unitPrice: input.oneTimeCosts.setup,
      billingMode: "one_time",
      interval: "once",
      category: "service",
    }),
    createLineItem({
      type: "setup",
      label: "Abbau",
      quantity: 1,
      unit: "Einsatz",
      unitPrice: input.oneTimeCosts.teardown,
      billingMode: "one_time",
      interval: "once",
      category: "service",
    }),
    createLineItem({
      type: "transport",
      label: "Rücktransport",
      quantity: 1,
      unit: "Einsatz",
      unitPrice: input.oneTimeCosts.transportReturn,
      billingMode: "one_time",
      interval: "once",
      category: "logistics",
    })
  );

  return lineItems;
}

export function calculateQuoteTotals(input: QuoteTotalsInput): QuoteTotalsResult {
  if (!Number.isInteger(input.durationMonths) || input.durationMonths <= 0) {
    throw new Error("durationMonths must be an integer greater than 0");
  }

  const normalizedLineItems = input.lineItems.map(normalizeLineItem);
  const derivedTotals = deriveQuoteTotalsFromLineItems({
    lineItems: normalizedLineItems,
    discountAmount: input.discountAmount,
    vatRate: input.vatRate,
  });

  return {
    lineItems: normalizedLineItems,
    durationMonths: input.durationMonths,
    monthlyTotal: derivedTotals.monthlyTotal,
    oneTimeTotal: derivedTotals.oneTimeTotal,
    subtotal: derivedTotals.subtotal,
    discountAmount: derivedTotals.discountAmount,
    totalNet: derivedTotals.totalNet,
    totalGross: derivedTotals.totalGross,
    vatRate: derivedTotals.vatRate,
  };
}

export function deriveQuoteTotalsFromLineItems(input: DerivedQuoteTotalsInput): Omit<QuoteTotalsResult, "lineItems" | "durationMonths"> {
  const normalizedLineItems = input.lineItems.map(normalizeLineItem);
  const safeVatRate = clampNumber(input.vatRate);
  const recurringTotalCents = sumByBillingModeInCents(normalizedLineItems, "recurring");
  const oneTimeTotalCents = sumByBillingModeInCents(normalizedLineItems, "one_time");
  const subtotalCents = recurringTotalCents + oneTimeTotalCents;
  const discountAmountCents = toCurrencyCents(clampCurrency(input.discountAmount));
  const totalNetCents = Math.max(0, subtotalCents - discountAmountCents);
  const totalGrossCents = Math.round(totalNetCents * (1 + safeVatRate));

  return {
    monthlyTotal: fromCurrencyCents(recurringTotalCents),
    oneTimeTotal: fromCurrencyCents(oneTimeTotalCents),
    subtotal: fromCurrencyCents(subtotalCents),
    discountAmount: fromCurrencyCents(discountAmountCents),
    totalNet: fromCurrencyCents(totalNetCents),
    totalGross: fromCurrencyCents(totalGrossCents),
    vatRate: safeVatRate,
  };
}

export function calculateQuote(
  input: QuoteCalculationInput,
  config: PriceConfig = DEFAULT_PRICE_CONFIG,
  templateCatalog: PricingTowerTemplate[] = []
): QuoteCalculationResult {
  assertCalculationInput(input);

  const lineItems = createStandardQuoteLineItems(
    {
      towerSelections: input.towerSelections,
      oneTimeCosts: input.oneTimeCosts,
    },
    config,
    templateCatalog
  );
  const towerCount = input.towerSelections.reduce((sum, selection) => sum + selection.quantity, 0);

  if (input.monthlyOptions.nslEnabled && towerCount > 0) {
    lineItems.push(
      createLineItem({
        type: "custom",
        label: "NSL-Aufschaltung",
        quantity: towerCount,
        unit: "Stk",
        unitPrice: config.nslMonthlyPerTower,
        billingMode: "recurring",
        interval: "monthly",
        category: "monitoring",
      })
    );
  }

  if (input.monthlyOptions.connectivity !== "none" && towerCount > 0) {
    lineItems.push(
      createLineItem({
        type: "custom",
        label: `Datenverbindung (${input.monthlyOptions.connectivity.toUpperCase()})`,
        quantity: towerCount,
        unit: "Stk",
        unitPrice: config.connectivityMonthlyPerTower[input.monthlyOptions.connectivity],
        billingMode: "recurring",
        interval: "monthly",
        category: "connectivity",
      })
    );
  }

  if (input.monthlyOptions.servicePauschaleEnabled && towerCount > 0) {
    lineItems.push(
      createLineItem({
        type: "custom",
        label: "Servicepauschale",
        quantity: towerCount,
        unit: "Stk",
        unitPrice: config.serviceMonthlyPerTower,
        billingMode: "recurring",
        interval: "monthly",
        category: "service",
      })
    );
  }

  if (input.optionalCosts.autarkySurcharge > 0) {
    lineItems.push(
      createLineItem({
        type: "custom",
        label: "Autarkie-Zuschlag",
        quantity: 1,
        unit: "Pauschal",
        unitPrice: input.optionalCosts.autarkySurcharge,
        billingMode: "one_time",
        interval: "once",
        category: "optional",
      })
    );
  }

  if (input.optionalCosts.lightPackage > 0) {
    lineItems.push(
      createLineItem({
        type: "custom",
        label: "Lichtpaket",
        quantity: 1,
        unit: "Pauschal",
        unitPrice: input.optionalCosts.lightPackage,
        billingMode: "one_time",
        interval: "once",
        category: "optional",
      })
    );
  }

  if (input.optionalCosts.specialServices > 0) {
    lineItems.push(
      createLineItem({
        type: "custom",
        label: "Sonderleistungen",
        quantity: 1,
        unit: "Pauschal",
        unitPrice: input.optionalCosts.specialServices,
        billingMode: "one_time",
        interval: "once",
        category: "optional",
      })
    );
  }

  const totals = calculateQuoteTotals({
    lineItems,
    durationMonths: input.durationMonths,
    discountAmount: input.optionalCosts.discountAmount,
    vatRate: config.vatRate,
  });

  return {
    lineItems: totals.lineItems,
    towerCount,
    durationMonths: totals.durationMonths,
    monthlyTotal: totals.monthlyTotal,
    oneTimeTotal: totals.oneTimeTotal,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    totalNet: totals.totalNet,
    totalGross: totals.totalGross,
    vatRate: totals.vatRate,
  };
}

export function createLineItem(input: {
  type: QuoteLineItem["type"];
  label: string;
  description?: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  stundenProTag?: number;
  nachtStundenProTag?: number;
  tageProMonat?: number;
  tageSamstag?: number;
  tageSonntag?: number;
  tageFeiertag?: number;
  preisProKontrolle?: number;
  kontrollenProTagWerktag?: number;
  kontrollenProTagSamstag?: number;
  kontrollenProTagSonntag?: number;
  kontrollenProTagFeiertag?: number;
  nachtKontrollenProTag?: number;
  kontrollenProTagWochenende?: number;
  tageWerktage?: number;
  samstagZuschlagPercent?: number;
  sonntagZuschlagPercent?: number;
  feiertagZuschlagPercent?: number;
  nachtZuschlagPercent?: number;
  tageWochenende?: number;
  billingMode?: BillingMode;
  interval?: BillingInterval;
  category?: string;
  metadata?: Record<string, unknown>;
}): QuoteLineItem {
  const quantity = clampNumber(input.quantity);
  const unitPrice = clampCurrency(input.unitPrice);
  const defaults = getLineItemDefaults(input.type);
  const billingMode = input.billingMode ?? defaults.billingMode;
  const interval = input.interval ?? defaults.interval;
  const category = input.category ?? defaults.category;
  const isRevierdienstControl = isRevierdienstControlCalculation({
    type: input.type,
    billingMode,
    interval,
  });
  const isPersonnel = isPersonnelLineItem({
    type: input.type,
    category,
    billingMode,
  });
  const stundenProTag = isPersonnel
    ? clampNumber(input.stundenProTag ?? DEFAULT_PERSONNEL_STUNDEN_PRO_TAG)
    : undefined;
  const nachtStundenProTag = isPersonnel
    ? clampNumber(input.nachtStundenProTag ?? DEFAULT_PERSONNEL_NACHT_STUNDEN_PRO_TAG)
    : undefined;
  const tageWerktage = clampNumber(
    input.tageWerktage ?? (isPersonnel ? DEFAULT_PERSONNEL_TAGE_WERKTAGE : DEFAULT_REVIER_TAGE_WERKTAGE)
  );
  const tageSamstag = clampNumber(
    input.tageSamstag ?? Math.floor((input.tageWochenende ?? (isPersonnel ? DEFAULT_PERSONNEL_TAGE_SAMSTAG + DEFAULT_PERSONNEL_TAGE_SONNTAG : DEFAULT_REVIER_TAGE_SAMSTAG + DEFAULT_REVIER_TAGE_SONNTAG)) / 2)
  );
  const tageSonntag = clampNumber(
    input.tageSonntag ?? Math.ceil((input.tageWochenende ?? (isPersonnel ? DEFAULT_PERSONNEL_TAGE_SAMSTAG + DEFAULT_PERSONNEL_TAGE_SONNTAG : DEFAULT_REVIER_TAGE_SAMSTAG + DEFAULT_REVIER_TAGE_SONNTAG)) / 2)
  );
  const tageFeiertag = clampNumber(
    input.tageFeiertag ?? (isPersonnel ? DEFAULT_PERSONNEL_TAGE_FEIERTAG : DEFAULT_REVIER_TAGE_FEIERTAG)
  );
  const tageProMonat = isPersonnel
    ? clampNumber(
      input.tageProMonat ?? (tageWerktage + tageSamstag + tageSonntag + tageFeiertag)
    )
    : undefined;
  const preisProKontrolle = isRevierdienstControl
    ? clampCurrency(input.preisProKontrolle ?? unitPrice)
    : undefined;
  const kontrollenProTagWerktag = isRevierdienstControl
    ? clampNumber(input.kontrollenProTagWerktag ?? DEFAULT_REVIER_KONTROLLEN_WERKTAG)
    : undefined;
  const kontrollenProTagSamstag = isRevierdienstControl
    ? clampNumber(
      input.kontrollenProTagSamstag ?? input.kontrollenProTagWochenende ?? DEFAULT_REVIER_KONTROLLEN_SAMSTAG
    )
    : undefined;
  const kontrollenProTagSonntag = isRevierdienstControl
    ? clampNumber(
      input.kontrollenProTagSonntag ?? input.kontrollenProTagWochenende ?? DEFAULT_REVIER_KONTROLLEN_SONNTAG
    )
    : undefined;
  const kontrollenProTagFeiertag = isRevierdienstControl
    ? clampNumber(input.kontrollenProTagFeiertag ?? DEFAULT_REVIER_KONTROLLEN_FEIERTAG)
    : undefined;
  const nachtKontrollenProTag = isRevierdienstControl
    ? clampNumber(input.nachtKontrollenProTag ?? DEFAULT_REVIER_NACHT_KONTROLLEN_PRO_TAG)
    : undefined;
  const kontrollenProTagWochenende = isRevierdienstControl
    ? clampNumber(input.kontrollenProTagWochenende ?? kontrollenProTagSamstag ?? DEFAULT_REVIER_KONTROLLEN_SAMSTAG)
    : undefined;
  const samstagZuschlagPercent =
    isPersonnel || isRevierdienstControl
      ? clampNumber(input.samstagZuschlagPercent ?? DEFAULT_SAMSTAG_ZUSCHLAG_PERCENT)
      : undefined;
  const sonntagZuschlagPercent =
    isPersonnel || isRevierdienstControl
      ? clampNumber(input.sonntagZuschlagPercent ?? DEFAULT_SONNTAG_ZUSCHLAG_PERCENT)
      : undefined;
  const feiertagZuschlagPercent =
    isPersonnel || isRevierdienstControl
      ? clampNumber(input.feiertagZuschlagPercent ?? DEFAULT_FEIERTAG_ZUSCHLAG_PERCENT)
      : undefined;
  const nachtZuschlagPercent =
    isPersonnel || isRevierdienstControl
      ? clampNumber(input.nachtZuschlagPercent ?? DEFAULT_NACHT_ZUSCHLAG_PERCENT)
      : undefined;
  const tageWochenende = isRevierdienstControl
    ? clampNumber(input.tageWochenende ?? tageSamstag + tageSonntag)
    : undefined;

  return {
    id: crypto.randomUUID(),
    type: input.type,
    label: input.label,
    description: normalizeDescription(input.description),
    quantity,
    unit: normalizeUnit(input.unit),
    unitPrice,
    stundenProTag,
    nachtStundenProTag,
    tageProMonat,
    tageSamstag: isPersonnel || isRevierdienstControl ? tageSamstag : undefined,
    tageSonntag: isPersonnel || isRevierdienstControl ? tageSonntag : undefined,
    tageFeiertag: isPersonnel || isRevierdienstControl ? tageFeiertag : undefined,
    preisProKontrolle,
    kontrollenProTagWerktag,
    kontrollenProTagSamstag,
    kontrollenProTagSonntag,
    kontrollenProTagFeiertag,
    nachtKontrollenProTag,
    kontrollenProTagWochenende,
    tageWerktage: isPersonnel || isRevierdienstControl ? tageWerktage : undefined,
    samstagZuschlagPercent,
    sonntagZuschlagPercent,
    feiertagZuschlagPercent,
    nachtZuschlagPercent,
    tageWochenende,
    billingMode,
    interval,
    category,
    metadata: input.metadata,
    totalPrice: calculateLineItemTotal({
      id: "line-item-total",
      type: input.type,
      label: input.label,
      quantity,
      unit: normalizeUnit(input.unit),
      unitPrice,
      stundenProTag,
      nachtStundenProTag,
      tageProMonat,
      tageSamstag: isPersonnel || isRevierdienstControl ? tageSamstag : undefined,
      tageSonntag: isPersonnel || isRevierdienstControl ? tageSonntag : undefined,
      tageFeiertag: isPersonnel || isRevierdienstControl ? tageFeiertag : undefined,
      preisProKontrolle,
      kontrollenProTagWerktag,
      kontrollenProTagSamstag,
      kontrollenProTagSonntag,
      kontrollenProTagFeiertag,
      nachtKontrollenProTag,
      kontrollenProTagWochenende,
      tageWerktage: isPersonnel || isRevierdienstControl ? tageWerktage : undefined,
      samstagZuschlagPercent,
      sonntagZuschlagPercent,
      feiertagZuschlagPercent,
      nachtZuschlagPercent,
      tageWochenende,
      billingMode,
      interval,
      category,
      metadata: input.metadata,
      totalPrice: 0,
    }),
  };
}

export function normalizeLineItem(item: QuoteLineItem): QuoteLineItem {
  const quantity = clampNumber(item.quantity);
  const unitPrice = clampCurrency(item.unitPrice);
  const label = item.label.trim().length > 0 ? item.label.trim() : "Position";
  const description = normalizeDescription(item.description);
  const defaults = getLineItemDefaults(item.type);
  const normalizedBillingMode =
    item.billingMode ??
    (item.type === "monthly" ? "recurring" : item.type === "one_time" || item.type === "optional" ? "one_time" : undefined) ??
    defaults.billingMode;
  const normalizedInterval =
    item.interval ??
    (item.type === "monthly" ? "monthly" : item.type === "one_time" || item.type === "optional" ? "once" : undefined) ??
    defaults.interval;
  const normalizedCategory = item.category ?? defaults.category;
  const isRevierdienstControl = isRevierdienstControlCalculation({
    type: item.type,
    billingMode: normalizedBillingMode,
    interval: normalizedInterval,
  });
  const isPersonnel = isPersonnelLineItem({
    type: item.type,
    category: normalizedCategory,
    billingMode: normalizedBillingMode,
  });
  const stundenProTag = isPersonnel
    ? clampNumber(item.stundenProTag ?? DEFAULT_PERSONNEL_STUNDEN_PRO_TAG)
    : undefined;
  const nachtStundenProTag = isPersonnel
    ? clampNumber(item.nachtStundenProTag ?? DEFAULT_PERSONNEL_NACHT_STUNDEN_PRO_TAG)
    : undefined;
  const tageWerktage = clampNumber(
    item.tageWerktage ?? (isPersonnel ? DEFAULT_PERSONNEL_TAGE_WERKTAGE : DEFAULT_REVIER_TAGE_WERKTAGE)
  );
  const tageSamstag = clampNumber(
    item.tageSamstag ?? Math.floor((item.tageWochenende ?? (isPersonnel ? DEFAULT_PERSONNEL_TAGE_SAMSTAG + DEFAULT_PERSONNEL_TAGE_SONNTAG : DEFAULT_REVIER_TAGE_SAMSTAG + DEFAULT_REVIER_TAGE_SONNTAG)) / 2)
  );
  const tageSonntag = clampNumber(
    item.tageSonntag ?? Math.ceil((item.tageWochenende ?? (isPersonnel ? DEFAULT_PERSONNEL_TAGE_SAMSTAG + DEFAULT_PERSONNEL_TAGE_SONNTAG : DEFAULT_REVIER_TAGE_SAMSTAG + DEFAULT_REVIER_TAGE_SONNTAG)) / 2)
  );
  const tageFeiertag = clampNumber(
    item.tageFeiertag ?? (isPersonnel ? DEFAULT_PERSONNEL_TAGE_FEIERTAG : DEFAULT_REVIER_TAGE_FEIERTAG)
  );
  const tageProMonat = isPersonnel
    ? clampNumber(item.tageProMonat ?? (tageWerktage + tageSamstag + tageSonntag + tageFeiertag))
    : undefined;
  const preisProKontrolle = isRevierdienstControl
    ? clampCurrency(item.preisProKontrolle ?? unitPrice)
    : undefined;
  const kontrollenProTagWerktag = isRevierdienstControl
    ? clampNumber(item.kontrollenProTagWerktag ?? DEFAULT_REVIER_KONTROLLEN_WERKTAG)
    : undefined;
  const kontrollenProTagSamstag = isRevierdienstControl
    ? clampNumber(
      item.kontrollenProTagSamstag ?? item.kontrollenProTagWochenende ?? DEFAULT_REVIER_KONTROLLEN_SAMSTAG
    )
    : undefined;
  const kontrollenProTagSonntag = isRevierdienstControl
    ? clampNumber(
      item.kontrollenProTagSonntag ?? item.kontrollenProTagWochenende ?? DEFAULT_REVIER_KONTROLLEN_SONNTAG
    )
    : undefined;
  const kontrollenProTagFeiertag = isRevierdienstControl
    ? clampNumber(item.kontrollenProTagFeiertag ?? DEFAULT_REVIER_KONTROLLEN_FEIERTAG)
    : undefined;
  const nachtKontrollenProTag = isRevierdienstControl
    ? clampNumber(item.nachtKontrollenProTag ?? DEFAULT_REVIER_NACHT_KONTROLLEN_PRO_TAG)
    : undefined;
  const kontrollenProTagWochenende = isRevierdienstControl
    ? clampNumber(item.kontrollenProTagWochenende ?? kontrollenProTagSamstag ?? DEFAULT_REVIER_KONTROLLEN_SAMSTAG)
    : undefined;
  const samstagZuschlagPercent =
    isPersonnel || isRevierdienstControl
      ? clampNumber(item.samstagZuschlagPercent ?? DEFAULT_SAMSTAG_ZUSCHLAG_PERCENT)
      : undefined;
  const sonntagZuschlagPercent =
    isPersonnel || isRevierdienstControl
      ? clampNumber(item.sonntagZuschlagPercent ?? DEFAULT_SONNTAG_ZUSCHLAG_PERCENT)
      : undefined;
  const feiertagZuschlagPercent =
    isPersonnel || isRevierdienstControl
      ? clampNumber(item.feiertagZuschlagPercent ?? DEFAULT_FEIERTAG_ZUSCHLAG_PERCENT)
      : undefined;
  const nachtZuschlagPercent =
    isPersonnel || isRevierdienstControl
      ? clampNumber(item.nachtZuschlagPercent ?? DEFAULT_NACHT_ZUSCHLAG_PERCENT)
      : undefined;
  const tageWochenende = isRevierdienstControl
    ? clampNumber(item.tageWochenende ?? tageSamstag + tageSonntag)
    : undefined;
  const normalizedQuantity = isRevierdienstControl ? 1 : quantity;

  return {
    ...item,
    label,
    description,
    quantity: normalizedQuantity,
    unit: normalizeUnit(item.unit),
    unitPrice,
    stundenProTag,
    nachtStundenProTag,
    tageProMonat,
    tageSamstag: isPersonnel || isRevierdienstControl ? tageSamstag : undefined,
    tageSonntag: isPersonnel || isRevierdienstControl ? tageSonntag : undefined,
    tageFeiertag: isPersonnel || isRevierdienstControl ? tageFeiertag : undefined,
    preisProKontrolle,
    kontrollenProTagWerktag,
    kontrollenProTagSamstag,
    kontrollenProTagSonntag,
    kontrollenProTagFeiertag,
    nachtKontrollenProTag,
    kontrollenProTagWochenende,
    tageWerktage: isPersonnel || isRevierdienstControl ? tageWerktage : undefined,
    samstagZuschlagPercent,
    sonntagZuschlagPercent,
    feiertagZuschlagPercent,
    nachtZuschlagPercent,
    tageWochenende,
    billingMode: normalizedBillingMode,
    interval: normalizedInterval,
    category: normalizedCategory,
    totalPrice: calculateLineItemTotal({
      ...item,
      label,
      description,
      quantity: normalizedQuantity,
      unit: normalizeUnit(item.unit),
      unitPrice,
      stundenProTag,
      nachtStundenProTag,
      tageProMonat,
      tageSamstag: isPersonnel || isRevierdienstControl ? tageSamstag : undefined,
      tageSonntag: isPersonnel || isRevierdienstControl ? tageSonntag : undefined,
      tageFeiertag: isPersonnel || isRevierdienstControl ? tageFeiertag : undefined,
      preisProKontrolle,
      kontrollenProTagWerktag,
      kontrollenProTagSamstag,
      kontrollenProTagSonntag,
      kontrollenProTagFeiertag,
      nachtKontrollenProTag,
      kontrollenProTagWochenende,
      tageWerktage: isPersonnel || isRevierdienstControl ? tageWerktage : undefined,
      samstagZuschlagPercent,
      sonntagZuschlagPercent,
      feiertagZuschlagPercent,
      nachtZuschlagPercent,
      tageWochenende,
      billingMode: normalizedBillingMode,
      interval: normalizedInterval,
      category: normalizedCategory,
      totalPrice: item.totalPrice,
    }),
  };
}

export function calculateLineItemTotal(item: QuoteLineItem): number {
  if (isRevierdienstControlCalculation(item)) {
    const preisProKontrolle = clampCurrency(item.preisProKontrolle ?? item.unitPrice);
    const kontrollenProTagWerktag = clampNumber(
      item.kontrollenProTagWerktag ?? DEFAULT_REVIER_KONTROLLEN_WERKTAG
    );
    const kontrollenProTagSamstag = clampNumber(
      item.kontrollenProTagSamstag
      ?? item.kontrollenProTagWochenende
      ?? DEFAULT_REVIER_KONTROLLEN_SAMSTAG
    );
    const kontrollenProTagSonntag = clampNumber(
      item.kontrollenProTagSonntag
      ?? item.kontrollenProTagWochenende
      ?? DEFAULT_REVIER_KONTROLLEN_SONNTAG
    );
    const kontrollenProTagFeiertag = clampNumber(
      item.kontrollenProTagFeiertag ?? DEFAULT_REVIER_KONTROLLEN_FEIERTAG
    );
    const nachtKontrollenProTag = clampNumber(
      item.nachtKontrollenProTag ?? DEFAULT_REVIER_NACHT_KONTROLLEN_PRO_TAG
    );

    const tageWerktage = clampNumber(item.tageWerktage ?? DEFAULT_REVIER_TAGE_WERKTAGE);
    const tageSamstag = clampNumber(
      item.tageSamstag ?? Math.floor((item.tageWochenende ?? (DEFAULT_REVIER_TAGE_SAMSTAG + DEFAULT_REVIER_TAGE_SONNTAG)) / 2)
    );
    const tageSonntag = clampNumber(
      item.tageSonntag ?? Math.ceil((item.tageWochenende ?? (DEFAULT_REVIER_TAGE_SAMSTAG + DEFAULT_REVIER_TAGE_SONNTAG)) / 2)
    );
    const tageFeiertag = clampNumber(item.tageFeiertag ?? DEFAULT_REVIER_TAGE_FEIERTAG);

    const samstagFactor = 1 + clampNumber(item.samstagZuschlagPercent ?? DEFAULT_SAMSTAG_ZUSCHLAG_PERCENT) / 100;
    const sonntagFactor = 1 + clampNumber(item.sonntagZuschlagPercent ?? DEFAULT_SONNTAG_ZUSCHLAG_PERCENT) / 100;
    const feiertagFactor = 1 + clampNumber(item.feiertagZuschlagPercent ?? DEFAULT_FEIERTAG_ZUSCHLAG_PERCENT) / 100;
    const nachtFactor = 1 + clampNumber(item.nachtZuschlagPercent ?? DEFAULT_NACHT_ZUSCHLAG_PERCENT) / 100;

    const tagespreisWerktag = roundCurrency(preisProKontrolle * kontrollenProTagWerktag);
    const tagespreisSamstag = roundCurrency(preisProKontrolle * kontrollenProTagSamstag * samstagFactor);
    const tagespreisSonntag = roundCurrency(preisProKontrolle * kontrollenProTagSonntag * sonntagFactor);
    const tagespreisFeiertag = roundCurrency(preisProKontrolle * kontrollenProTagFeiertag * feiertagFactor);
    const nachtpreisProTag = roundCurrency(preisProKontrolle * nachtKontrollenProTag * nachtFactor);

    return roundCurrency(
      tagespreisWerktag * tageWerktage
      + tagespreisSamstag * tageSamstag
      + tagespreisSonntag * tageSonntag
      + tagespreisFeiertag * tageFeiertag
      + nachtpreisProTag * (tageWerktage + tageSamstag + tageSonntag + tageFeiertag)
    );
  }

  if (isPersonnelLineItem(item)) {
    const stundenProTag = clampNumber(item.stundenProTag ?? DEFAULT_PERSONNEL_STUNDEN_PRO_TAG);
    const nachtStundenProTag = clampNumber(
      item.nachtStundenProTag ?? DEFAULT_PERSONNEL_NACHT_STUNDEN_PRO_TAG
    );
    const tageWerktage = clampNumber(item.tageWerktage ?? DEFAULT_PERSONNEL_TAGE_WERKTAGE);
    const tageSamstag = clampNumber(
      item.tageSamstag ?? Math.floor((item.tageWochenende ?? (DEFAULT_PERSONNEL_TAGE_SAMSTAG + DEFAULT_PERSONNEL_TAGE_SONNTAG)) / 2)
    );
    const tageSonntag = clampNumber(
      item.tageSonntag ?? Math.ceil((item.tageWochenende ?? (DEFAULT_PERSONNEL_TAGE_SAMSTAG + DEFAULT_PERSONNEL_TAGE_SONNTAG)) / 2)
    );
    const tageFeiertag = clampNumber(item.tageFeiertag ?? DEFAULT_PERSONNEL_TAGE_FEIERTAG);
    const samstagFactor = 1 + clampNumber(item.samstagZuschlagPercent ?? DEFAULT_SAMSTAG_ZUSCHLAG_PERCENT) / 100;
    const sonntagFactor = 1 + clampNumber(item.sonntagZuschlagPercent ?? DEFAULT_SONNTAG_ZUSCHLAG_PERCENT) / 100;
    const feiertagFactor = 1 + clampNumber(item.feiertagZuschlagPercent ?? DEFAULT_FEIERTAG_ZUSCHLAG_PERCENT) / 100;
    const nachtFactor = 1 + clampNumber(item.nachtZuschlagPercent ?? DEFAULT_NACHT_ZUSCHLAG_PERCENT) / 100;

    const basisTagessatz = roundCurrency(item.unitPrice * stundenProTag);
    const nachtTagessatz = roundCurrency(item.unitPrice * nachtStundenProTag * nachtFactor);
    const werktagSatz = basisTagessatz;
    const samstagSatz = roundCurrency(basisTagessatz * samstagFactor);
    const sonntagSatz = roundCurrency(basisTagessatz * sonntagFactor);
    const feiertagSatz = roundCurrency(basisTagessatz * feiertagFactor);
    const tageGesamt = tageWerktage + tageSamstag + tageSonntag + tageFeiertag;
    const monatsPreis = roundCurrency(
      werktagSatz * tageWerktage
      + samstagSatz * tageSamstag
      + sonntagSatz * tageSonntag
      + feiertagSatz * tageFeiertag
      + nachtTagessatz * tageGesamt
    );
    return roundCurrency(monatsPreis * item.quantity);
  }

  return roundCurrency(item.quantity * item.unitPrice);
}

export function calculateNetTotal(items: QuoteLineItem[]): number {
  return roundCurrency(items.reduce((sum, item) => sum + item.totalPrice, 0));
}

export function calculateGrossTotal(netTotal: number, vatRate: number): number {
  return roundCurrency(netTotal * (1 + vatRate));
}

function sumByBillingMode(items: QuoteLineItem[], billingMode: BillingMode): number {
  return roundCurrency(
    items.filter((item) => item.billingMode === billingMode).reduce((sum, item) => sum + item.totalPrice, 0)
  );
}

function sumByBillingModeInCents(items: QuoteLineItem[], billingMode: BillingMode): number {
  return items
    .filter((item) => item.billingMode === billingMode)
    .reduce((sum, item) => sum + toCurrencyCents(item.totalPrice), 0);
}

function getLineItemDefaults(type: QuoteLineItem["type"]): {
  billingMode: BillingMode;
  interval: BillingInterval;
  category: string;
} {
  if (type === "videotower" || type === "patrol" || type === "guard_hour" || type === "control_run" || type === "service") {
    return {
      billingMode: "recurring",
      interval: "monthly",
      category: "operations",
    };
  }

  if (type === "transport" || type === "setup") {
    return {
      billingMode: "one_time",
      interval: "once",
      category: "logistics",
    };
  }

  if (type === "monthly") {
    return {
      billingMode: "recurring",
      interval: "monthly",
      category: "legacy",
    };
  }

  return {
    billingMode: "one_time",
    interval: "once",
    category: "custom",
  };
}

function isPersonnelLineItem(item: Pick<QuoteLineItem, "type" | "category" | "billingMode">): boolean {
  if (item.type === "guard_hour") {
    return true;
  }

  if (item.billingMode !== "recurring") {
    return false;
  }

  const normalizedCategory = (item.category ?? "").toLowerCase();
  return normalizedCategory === "personell" || normalizedCategory === "personnel";
}

function isRevierdienstControlCalculation(
  item: Pick<QuoteLineItem, "type" | "billingMode" | "interval">
): boolean {
  return item.type === "control_run" && item.billingMode === "recurring" && item.interval === "monthly";
}

function normalizeUnit(value?: string): string {
  if (!value) {
    return "Stk";
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Stk";
}

function normalizeDescription(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function estimateTemplateMonthlyRate(
  templateId: string,
  config: PriceConfig,
  template?: PricingTowerTemplate
): number {
  const configured = config.templateMonthlyRateById[templateId];
  if (configured) {
    return configured;
  }

  if (!template) {
    return TEMPLATE_RATE_FALLBACK;
  }

  if (template.pricing?.monthlyBaseEur) {
    return template.pricing.monthlyBaseEur;
  }

  const activeCameraSlots = template.cameraSlots.filter(
    (slot) => slot.isActive !== false && resolveSlotCameraType(slot) !== "none"
  );
  const powerType = resolveTemplatePowerType(template);
  const baseRateByPowerType: Record<TowerPowerType, number> = {
    grid: 1800,
    battery: 2050,
    efoy: 2200,
    diesel: 2100,
    solar: 2050,
    hybrid: 2250,
  };
  const baseRate = baseRateByPowerType[powerType];
  const thermalBonus = activeCameraSlots.some(
    (slot) => resolveSlotCameraType(slot) === "thermal"
  )
    ? 350
    : 0;

  return roundCurrency(baseRate + activeCameraSlots.length * 220 + thermalBonus);
}

function resolveSlotCameraType(slot: PricingTowerTemplate["cameraSlots"][number]) {
  if (slot.cameraType) {
    return slot.cameraType;
  }

  const legacyModel = slot.defaultCameraModelId?.toLowerCase() ?? "";
  if (legacyModel.includes("thermal")) {
    return "thermal";
  }
  if (legacyModel.includes("bullet")) {
    return "bullet";
  }
  if (legacyModel.includes("dome")) {
    return "dome";
  }
  if (legacyModel.includes("ptz")) {
    return "ptz";
  }

  return "none";
}

function resolveTemplatePowerType(template: PricingTowerTemplate): TowerPowerType {
  if (template.powerType) {
    return template.powerType;
  }

  if (template.powerMode === "autark" || template.autark) {
    return "hybrid";
  }

  return "grid";
}

function assertCalculationInput(input: QuoteCalculationInput): void {
  if (!Number.isInteger(input.durationMonths) || input.durationMonths <= 0) {
    throw new Error("durationMonths must be an integer greater than 0");
  }

  if (input.towerSelections.length === 0) {
    throw new Error("At least one tower selection is required");
  }

  for (const selection of input.towerSelections) {
    if (!selection.templateId) {
      throw new Error("towerSelections.templateId is required");
    }
    if (!Number.isInteger(selection.quantity) || selection.quantity <= 0) {
      throw new Error("towerSelections.quantity must be an integer greater than 0");
    }
  }
}

function clampNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

function clampCurrency(value: number): number {
  return roundCurrency(clampNumber(value));
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function toCurrencyCents(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100);
}

function fromCurrencyCents(value: number): number {
  return roundCurrency(value / 100);
}
