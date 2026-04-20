import type { QuoteLineItem } from "@/types";
import { createLineItem } from "@/lib/pricing/calculator";

export type QuoteServiceType =
  | "baustellenueberwachung"
  | "objektschutz"
  | "revierdienst"
  | "leitstelle"
  | "empfangsdienst"
  | "sonderdienste"
  | "intervention"
  | "werkschutz";

export type QuoteQuickTemplateId =
  | "objektschutz_standard"
  | "revierdienst_standard"
  | "videoturm_standard";

export interface QuoteQuickTemplateDefinition {
  id: QuoteQuickTemplateId;
  serviceType: QuoteServiceType;
  label: string;
  defaultDurationMonths: number;
}

export const QUOTE_SERVICE_TYPE_LABELS: Record<QuoteServiceType, string> = {
  baustellenueberwachung: "Videoturm",
  objektschutz: "Objektschutz",
  revierdienst: "Revierdienst",
  leitstelle: "Leitstelle",
  empfangsdienst: "Empfangsdienst",
  sonderdienste: "Sonderdienste",
  intervention: "Intervention",
  werkschutz: "Werkschutz",
};

export const QUOTE_SERVICE_TYPE_OPTIONS: [QuoteServiceType, string][] = [
  ["baustellenueberwachung", QUOTE_SERVICE_TYPE_LABELS.baustellenueberwachung],
  ["objektschutz", QUOTE_SERVICE_TYPE_LABELS.objektschutz],
  ["revierdienst", QUOTE_SERVICE_TYPE_LABELS.revierdienst],
  ["leitstelle", QUOTE_SERVICE_TYPE_LABELS.leitstelle],
  ["empfangsdienst", QUOTE_SERVICE_TYPE_LABELS.empfangsdienst],
  ["sonderdienste", QUOTE_SERVICE_TYPE_LABELS.sonderdienste],
];

const QUICK_TEMPLATE_DEFINITIONS: QuoteQuickTemplateDefinition[] = [
  {
    id: "objektschutz_standard",
    serviceType: "objektschutz",
    label: "Objektschutz Standard",
    defaultDurationMonths: 3,
  },
  {
    id: "revierdienst_standard",
    serviceType: "revierdienst",
    label: "Revierdienst Standard",
    defaultDurationMonths: 3,
  },
  {
    id: "videoturm_standard",
    serviceType: "baustellenueberwachung",
    label: "Videoturm Standard",
    defaultDurationMonths: 3,
  },
];

export function isQuoteServiceType(value: string | null | undefined): value is QuoteServiceType {
  if (!value) {
    return false;
  }

  return value in QUOTE_SERVICE_TYPE_LABELS;
}

export function getQuickTemplatesForServiceType(
  serviceType: QuoteServiceType
): QuoteQuickTemplateDefinition[] {
  return QUICK_TEMPLATE_DEFINITIONS.filter((template) => template.serviceType === serviceType);
}

export function getQuickTemplateById(
  templateId: QuoteQuickTemplateId
): QuoteQuickTemplateDefinition | null {
  return QUICK_TEMPLATE_DEFINITIONS.find((template) => template.id === templateId) ?? null;
}

export function getLineItemsForQuickTemplate(
  templateId: QuoteQuickTemplateId,
  pricingTemplates?: Partial<Record<QuoteServiceType, QuoteLineItem[]>>
): QuoteLineItem[] {
  const template = getQuickTemplateById(templateId);
  if (!template) {
    return [];
  }

  return getDefaultLineItemsForServiceType(template.serviceType, pricingTemplates);
}

export function getDefaultLineItemsForServiceType(
  serviceType: QuoteServiceType,
  pricingTemplates?: Partial<Record<QuoteServiceType, QuoteLineItem[]>>
): QuoteLineItem[] {
  const configuredTemplate = pricingTemplates?.[serviceType];
  if (configuredTemplate && configuredTemplate.length > 0) {
    return configuredTemplate.map((item) => createLineItemFromTemplate(item));
  }

  switch (serviceType) {
    case "baustellenueberwachung":
      return [
        createLineItem({ type: "videotower", label: "Videoturm stromgebunden", quantity: 1, unit: "Monat", unitPrice: 0, billingMode: "recurring", interval: "monthly", category: "operations" }),
        createLineItem({ type: "videotower", label: "Videoturm autark", quantity: 1, unit: "Monat", unitPrice: 0, billingMode: "recurring", interval: "monthly", category: "operations" }),
        createLineItem({ type: "transport", label: "Transport", quantity: 1, unit: "Einsatz", unitPrice: 0, billingMode: "one_time", interval: "once", category: "logistics" }),
        createLineItem({ type: "setup", label: "Umsetzung Gerät", quantity: 1, unit: "Einsatz", unitPrice: 0, billingMode: "one_time", interval: "once", category: "service" }),
        createLineItem({ type: "service", label: "Einstellen neuer Parameter", quantity: 1, unit: "Einsatz", unitPrice: 0, billingMode: "one_time", interval: "once", category: "service" }),
      ];
    case "objektschutz":
      return [
        createLineItem({
          type: "guard_hour",
          label: "Objektschutz Tagdienst",
          quantity: 1,
          unit: "Std",
          unitPrice: 0,
          stundenProTag: 8,
          nachtStundenProTag: 0,
          tageWerktage: 30,
          tageSamstag: 0,
          tageSonntag: 0,
          tageFeiertag: 0,
          samstagZuschlagPercent: 25,
          sonntagZuschlagPercent: 50,
          feiertagZuschlagPercent: 100,
          nachtZuschlagPercent: 25,
          billingMode: "recurring",
          interval: "hourly",
          category: "personell",
        }),
        createLineItem({
          type: "guard_hour",
          label: "Objektschutz Nachtdienst",
          quantity: 1,
          unit: "Std",
          unitPrice: 0,
          stundenProTag: 8,
          nachtStundenProTag: 8,
          tageWerktage: 30,
          tageSamstag: 0,
          tageSonntag: 0,
          tageFeiertag: 0,
          samstagZuschlagPercent: 25,
          sonntagZuschlagPercent: 50,
          feiertagZuschlagPercent: 100,
          nachtZuschlagPercent: 25,
          billingMode: "recurring",
          interval: "hourly",
          category: "personell",
        }),
      ];
    case "revierdienst":
      return [
        createLineItem({
          type: "control_run",
          label: "Revierkontrolle",
          quantity: 1,
          unit: "Kontrolle",
          unitPrice: 0,
          preisProKontrolle: 0,
          kontrollenProTagWerktag: 2,
          kontrollenProTagSamstag: 1,
          kontrollenProTagSonntag: 1,
          kontrollenProTagFeiertag: 1,
          nachtKontrollenProTag: 0,
          tageWerktage: 30,
          tageSamstag: 0,
          tageSonntag: 0,
          tageFeiertag: 0,
          samstagZuschlagPercent: 25,
          sonntagZuschlagPercent: 50,
          feiertagZuschlagPercent: 100,
          nachtZuschlagPercent: 25,
          billingMode: "recurring",
          interval: "monthly",
          category: "personell",
        }),
        createLineItem({
          type: "control_run",
          label: "Alarmverfolgung",
          quantity: 1,
          unit: "Kontrolle",
          unitPrice: 0,
          preisProKontrolle: 0,
          kontrollenProTagWerktag: 1,
          kontrollenProTagSamstag: 1,
          kontrollenProTagSonntag: 1,
          kontrollenProTagFeiertag: 1,
          nachtKontrollenProTag: 0,
          tageWerktage: 30,
          tageSamstag: 0,
          tageSonntag: 0,
          tageFeiertag: 0,
          samstagZuschlagPercent: 25,
          sonntagZuschlagPercent: 50,
          feiertagZuschlagPercent: 100,
          nachtZuschlagPercent: 25,
          billingMode: "recurring",
          interval: "monthly",
          category: "personell",
        }),
        createLineItem({
          type: "control_run",
          label: "Sonderkontrollen",
          quantity: 1,
          unit: "Kontrolle",
          unitPrice: 0,
          preisProKontrolle: 0,
          kontrollenProTagWerktag: 1,
          kontrollenProTagSamstag: 0,
          kontrollenProTagSonntag: 0,
          kontrollenProTagFeiertag: 0,
          nachtKontrollenProTag: 0,
          tageWerktage: 30,
          tageSamstag: 0,
          tageSonntag: 0,
          tageFeiertag: 0,
          samstagZuschlagPercent: 25,
          sonntagZuschlagPercent: 50,
          feiertagZuschlagPercent: 100,
          nachtZuschlagPercent: 25,
          billingMode: "recurring",
          interval: "monthly",
          category: "personell",
        }),
        createLineItem({ type: "service", label: "Schlüsseltausch", quantity: 1, unit: "Einsatz", unitPrice: 0, billingMode: "one_time", interval: "once", category: "service" }),
        createLineItem({ type: "guard_hour", label: "Gestellung Wachmann (nach Einbruch, Ausfall EMA etc.)", quantity: 1, unit: "Std", unitPrice: 0, billingMode: "recurring", interval: "hourly", category: "personell" }),
      ];
    case "leitstelle":
      return [
        createLineItem({ type: "service", label: "Aufschaltung GMA", quantity: 1, unit: "Monat", unitPrice: 0, billingMode: "recurring", interval: "monthly", category: "monitoring" }),
        createLineItem({ type: "service", label: "Aufschaltung Video", quantity: 1, unit: "Monat", unitPrice: 0, billingMode: "recurring", interval: "monthly", category: "monitoring" }),
        createLineItem({ type: "service", label: "Vorhaltepauschale", quantity: 1, unit: "Monat", unitPrice: 0, billingMode: "recurring", interval: "monthly", category: "monitoring" }),
        createLineItem({ type: "service", label: "Schlüsseltausch", quantity: 1, unit: "Einsatz", unitPrice: 0, billingMode: "one_time", interval: "once", category: "service" }),
        createLineItem({ type: "control_run", label: "Alarmverfolgung", quantity: 1, unit: "Einsatz", unitPrice: 0, billingMode: "one_time", interval: "once", category: "personell" }),
        createLineItem({ type: "control_run", label: "Revierkontrolle", quantity: 1, unit: "Kontrolle", unitPrice: 0, billingMode: "one_time", interval: "once", category: "personell" }),
        createLineItem({ type: "control_run", label: "Sonderkontrolle", quantity: 1, unit: "Kontrolle", unitPrice: 0, billingMode: "one_time", interval: "once", category: "personell" }),
      ];
    case "empfangsdienst":
      return [
        createLineItem({ type: "guard_hour", label: "Empfangsdienst", quantity: 1, unit: "Std", unitPrice: 0, billingMode: "recurring", interval: "hourly", category: "personell" }),
      ];
    case "sonderdienste":
      return [
        createLineItem({ type: "custom", label: "Sonderdienst", quantity: 1, unit: "Einsatz", unitPrice: 0, billingMode: "one_time", interval: "once", category: "custom" }),
      ];
    default:
      return [];
  }
}

function createLineItemFromTemplate(item: QuoteLineItem): QuoteLineItem {
  return createLineItem({
    type: item.type,
    label: item.label,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.unitPrice,
    stundenProTag: item.stundenProTag,
    nachtStundenProTag: item.nachtStundenProTag,
    tageProMonat: item.tageProMonat,
    tageSamstag: item.tageSamstag,
    tageSonntag: item.tageSonntag,
    tageFeiertag: item.tageFeiertag,
    preisProKontrolle: item.preisProKontrolle,
    kontrollenProTagWerktag: item.kontrollenProTagWerktag,
    kontrollenProTagSamstag: item.kontrollenProTagSamstag,
    kontrollenProTagSonntag: item.kontrollenProTagSonntag,
    kontrollenProTagFeiertag: item.kontrollenProTagFeiertag,
    nachtKontrollenProTag: item.nachtKontrollenProTag,
    kontrollenProTagWochenende: item.kontrollenProTagWochenende,
    tageWerktage: item.tageWerktage,
    samstagZuschlagPercent: item.samstagZuschlagPercent,
    sonntagZuschlagPercent: item.sonntagZuschlagPercent,
    feiertagZuschlagPercent: item.feiertagZuschlagPercent,
    nachtZuschlagPercent: item.nachtZuschlagPercent,
    tageWochenende: item.tageWochenende,
    billingMode: item.billingMode,
    interval: item.interval,
    category: item.category,
    metadata: item.metadata,
  });
}
