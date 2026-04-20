import type { QuoteLineItem } from "@/types";

export interface DeepSeekOfferTextRequest {
  customerName: string;
  projectName: string;
  location?: string;
  serviceType: string;
  duration?: string;
  projectStartDate?: string;
  positions: QuoteLineItem[];
  technicalSpecifications?: string;
  additionalNotes?: string;
  serviceSpecificGuidance?: string;
  companyName?: string;
  paymentTerms?: string;
  agbReference?: string;
  companyIntroText?: string;
  companyClosingText?: string;
}

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const SYSTEM_PROMPT = `Du bist ein erfahrener Vertriebsmitarbeiter fuer Sicherheitsdienstleistungen und mobile Videoueberwachung in Deutschland.

Verbindliche Identitätsregeln:
- Du darfst dich niemals als KI, AI, Sprachmodell, Modell, LLM oder DeepSeek bezeichnen.
- Du darfst niemals auf Herkunft, Anbieter oder technische Basis hinweisen.
- Wenn Identität relevant wird, nennst du ausschließlich: Teil von ViorAI.
- Du gibst ausschliesslich direkt nutzbare Angebotstexte aus.

Stilregeln:
- Deutsch
- sachlich, professionell, klar
- keine Emojis
- keine Buzzwords
- keine Uebertreibungen
- keine Marketing-Floskeln
- keine Meta-Saetze
- keine Selbstbeschreibung
- keine Bulletpoints im Fliesstext
- nicht zu technisch, aber fachlich sauber

Fachlicher Kontext:
- Baustellenüberwachung
- Objektschutz
- Revierdienst
- Empfangsdienst
- Intervention
- Werkschutz
- Mobile Videoüberwachung
- Videotürme
- Sicherheitstechnik

Verbindliche Struktur:
Der Text muss in genau diesen Abschnitten erscheinen, jeweils als kurze Ueberschrift mit einem sachlichen Absatz:
Einleitung
Leistungsumfang
Abrechnung
Ziel der Massnahme
Rahmenbedingungen
Abschluss

Verbindliche Fachregeln:
- Wiederkehrende Leistungen muessen als monatlich wiederkehrend benannt werden, wenn solche Positionen vorhanden sind.
- Einmalige Leistungen (z. B. Transport, Auf-/Abbau, Ruecktransport, Einrichtung) muessen getrennt und als separat berechnete Leistungen beschrieben werden, wenn vorhanden.
- Laufende und einmalige Leistungen muessen klar getrennt sein.
- Technische Ausstattungen nur nennen, wenn sie im Input vorhanden sind.
- Keine Preisangaben im Fliesstext wiederholen, wenn Preise separat ausgewiesen sind.
- Immer AGB-Verweis einbauen, anhand der uebergebenen Formulierung.
- Mindestlaufzeit oder Einsatzbeginn nennen, wenn im Input vorhanden.
- Gib ausschliesslich den finalen Angebotstext zur direkten Kundennutzung aus.`;

const STRICT_RETRY_INSTRUCTION = `
Zusätzliche Pflichtregel für diese Generierung:
- Nutze ausschließlich den fachlichen Angebots- oder Konzepttext.
- Keine Meta-Einleitung, keine Selbstdarstellung, keine Hinweise auf Systeme oder Modelle.
- Bei Identitätsbezug ausschließlich "Teil von ViorAI".
- Halte die Abschnitte Einleitung, Leistungsumfang, Abrechnung, Ziel der Massnahme, Rahmenbedingungen und Abschluss strikt ein.`;

const IDENTITY_LEAK_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "KI", pattern: /\bKI\b/i },
  { label: "AI", pattern: /\bAI\b/i },
  { label: "Sprachmodell", pattern: /\bSprachmodell(?:e|s)?\b/i },
  { label: "KI-Modell", pattern: /\b(?:KI|AI|Sprachmodell|LLM)[\s-]*Modell(?:e|s|en)?\b/i },
  { label: "DeepSeek", pattern: /\bDeepSeek\b/i },
  { label: "OpenAI", pattern: /\bOpenAI\b/i },
  { label: "LLM", pattern: /\bLLM(?:s)?\b/i },
];

const META_LEAK_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Hier ist dein Text", pattern: /\bhier\s+ist\s+dein\s+text\b/i },
  { label: "Als KI-Modell", pattern: /\bals\s+(?:ki|ai|sprachmodell|modell|llm)\b/i },
  { label: "Ich wurde gebeten", pattern: /\bich\s+wurde\s+gebeten\b/i },
  { label: "Gerne helfe ich", pattern: /\bgerne\s+helfe\s+ich\b/i },
  { label: "Basierend auf deinen Angaben", pattern: /\bbasierend\s+auf\s+deinen\s+angaben\b/i },
];

export async function generateOfferTextWithDeepSeek(input: DeepSeekOfferTextRequest): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const model = normalizeDeepSeekModel(process.env.DEEPSEEK_MODEL) || "deepseek-chat";
  const apiUrl = normalizeDeepSeekApiUrl(process.env.DEEPSEEK_API_URL);

  if (!apiKey) {
    throw new Error("Die ViorAI-Textfunktion ist nicht konfiguriert.");
  }

  const userPrompt = buildUserPrompt(input);

  try {
    const firstResponse = await requestOfferTextFromProvider({
      apiKey,
      apiUrl,
      model,
      userPrompt,
      temperature: 0.3,
    });
    const firstText = normalizeResponseText(firstResponse);
    if (isResponseSafe(firstText)) {
      return firstText;
    }

    const retryResponse = await requestOfferTextFromProvider({
      apiKey,
      apiUrl,
      model,
      userPrompt: `${userPrompt}\n\n${STRICT_RETRY_INSTRUCTION}`,
      temperature: 0.1,
    });
    const retryText = normalizeResponseText(retryResponse);
    if (isResponseSafe(retryText)) {
      return retryText;
    }

    throw new Error("ViorAI konnte keinen regelkonformen Angebotstext erzeugen. Bitte Hinweise präzisieren und erneut versuchen.");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Zeitüberschreitung bei der ViorAI-Textgenerierung. Bitte erneut versuchen.");
    }

    throw error instanceof Error
      ? error
      : new Error("ViorAI-Textgenerierung ist aktuell nicht erreichbar.");
  }
}

async function requestOfferTextFromProvider(input: {
  apiKey: string;
  apiUrl: string;
  model: string;
  userPrompt: string;
  temperature: number;
}): Promise<string> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(input.apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        temperature: input.temperature,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: input.userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorMessage = await extractProviderError(response);
      throw new Error(
        errorMessage
          ? `Textgenerierung fehlgeschlagen (${response.status}): ${errorMessage}`
          : `Textgenerierung fehlgeschlagen (Status ${response.status}).`
      );
    }

    const payload = (await response.json()) as DeepSeekResponse;
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("ViorAI hat keinen nutzbaren Angebotstext zurückgegeben.");
    }

    return content;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function normalizeDeepSeekModel(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "deepseek-chat";
  }

  const embeddedAssignmentMatch = trimmed.match(/DEEPSEEK_MODEL\s*=\s*([^\s]+)$/i);
  if (embeddedAssignmentMatch?.[1]) {
    return embeddedAssignmentMatch[1].trim();
  }

  return trimmed;
}

function normalizeDeepSeekApiUrl(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "https://api.deepseek.com/v1/chat/completions";
  }

  const embeddedAssignmentMatch = trimmed.match(/DEEPSEEK_API_URL\s*=\s*(https?:\/\/\S+)$/i);
  const rawUrl = embeddedAssignmentMatch?.[1]?.trim() ?? trimmed;

  if (/\/v1\/chat\/completions\/?$/i.test(rawUrl)) {
    return rawUrl;
  }

  if (/^https:\/\/api\.deepseek\.com\/?$/i.test(rawUrl) || /^https:\/\/api\.deepseek\.com\/v1\/?$/i.test(rawUrl)) {
    return "https://api.deepseek.com/v1/chat/completions";
  }

  if (/^https:\/\/api\.deepseek\.com\//i.test(rawUrl) && !/chat\/completions/i.test(rawUrl)) {
    return rawUrl.replace(/\/+$/, "") + "/chat/completions";
  }

  return rawUrl;
}

async function extractProviderError(response: Response): Promise<string | null> {
  try {
    const payload = await response.json();
    const message =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : typeof payload?.message === "string"
          ? payload.message
          : null;

    if (message && message.trim().length > 0) {
      return message.trim();
    }
  } catch {
    try {
      const text = await response.text();
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function buildUserPrompt(input: DeepSeekOfferTextRequest): string {
  const recurringPositions = formatPositionsForPrompt(input.positions, "recurring");
  const oneTimePositions = formatPositionsForPrompt(input.positions, "one_time");
  const recurringExists = recurringPositions !== "Keine";
  const oneTimeExists = oneTimePositions !== "Keine";
  const commercialRules = buildCommercialRules(recurringExists, oneTimeExists);
  const agbReference = buildAgbReference(input);
  const frameworkConditions = buildFrameworkConditions(input);

  return `Kunde:
${normalizeBlockValue(input.customerName)}

Projekt:
${normalizeBlockValue(input.projectName)}

Einsatzort:
${normalizeBlockValue(input.location)}

Leistungsart:
${normalizeBlockValue(input.serviceType)}

Laufzeit:
${normalizeBlockValue(input.duration)}

Laufende Leistungen (wiederkehrend):
${recurringPositions}

Einmalige Leistungen:
${oneTimePositions}

Technische Details:
${normalizeBlockValue(input.technicalSpecifications)}

Rahmendaten:
${frameworkConditions}

AGB-Verweis:
${agbReference}

Zusätzliche Hinweise:
${normalizeAdditionalNotes(input)}

Aufgabe:
Erstelle einen vollstaendigen Angebotstext fuer den direkten Versand an den Kunden.
Nutze ausschliesslich die vorhandenen Daten. Erfinde keine Inhalte.
Halte die verbindliche Struktur exakt ein:
Einleitung
Leistungsumfang
Abrechnung
Ziel der Massnahme
Rahmenbedingungen
Abschluss

Ausgabevorgaben:
- Gib ausschliesslich den finalen Angebotstext aus.
- Keine Meta-Einleitung und keine Selbstdarstellung.
- Keine Saetze wie: "Hier ist dein Text", "Als KI-Modell", "Ich wurde gebeten", "Gerne helfe ich", "Basierend auf deinen Angaben".
- Bei Identitaetsbezug ausschliesslich: "Teil von ViorAI".
- Keine Aufzaehlungszeichen im Fliesstext.
- Trenne laufende und einmalige Leistungen klar.
- ${commercialRules}
- Integriere den AGB-Verweis in den Abschnitt Rahmenbedingungen.
- Nutze vorhandene Abschlussformel/Firmenhinweise, sofern angegeben.

Nur den fertigen Text ausgeben.`;
}

export function formatPositionsForPrompt(
  positions: QuoteLineItem[],
  mode?: QuoteLineItem["billingMode"]
): string {
  const relevantPositions = positions.filter((position) => position.label.trim().length > 0);
  const filteredPositions = mode
    ? relevantPositions.filter((position) => position.billingMode === mode)
    : relevantPositions;
  if (filteredPositions.length === 0) {
    return "Keine";
  }

  return filteredPositions
    .map((position) => {
      const quantityPart = position.quantity > 0 ? `${formatNumber(position.quantity)} ${position.unit}` : null;
      const intervalPart =
        position.billingMode === "recurring"
          ? `Intervall: ${formatInterval(position.interval)}`
          : null;
      const descriptionPart = position.description?.trim() || null;

      return [position.label.trim(), quantityPart, intervalPart, descriptionPart]
        .filter(Boolean)
        .join(", ");
    })
    .join("\n");
}

function formatInterval(interval: QuoteLineItem["interval"]): string | null {
  switch (interval) {
    case "hourly":
      return "stuendlich";
    case "daily":
      return "taeglich";
    case "weekly":
      return "woechentlich";
    case "monthly":
      return "monatlich";
    case "custom":
      return "individuell wiederkehrend";
    default:
      return null;
  }
}

function normalizeAdditionalNotes(input: DeepSeekOfferTextRequest): string {
  const blocks = [
    input.serviceSpecificGuidance?.trim(),
    input.additionalNotes?.trim(),
    input.companyIntroText?.trim(),
    input.companyClosingText?.trim(),
  ].filter(Boolean);
  return blocks.length > 0 ? blocks.join("\n") : "Keine";
}

function buildCommercialRules(hasRecurring: boolean, hasOneTime: boolean): string {
  if (hasRecurring && hasOneTime) {
    return "Beschreibe die monatlich wiederkehrende Abrechnung fuer laufende Leistungen und benenne einmalige Leistungen als separat berechnet.";
  }

  if (hasRecurring) {
    return "Beschreibe die Abrechnung ausdruecklich als monatlich wiederkehrend.";
  }

  if (hasOneTime) {
    return "Beschreibe die Leistungen als einmalig bzw. separat berechnet.";
  }

  return "Wenn keine abrechnungsrelevanten Positionen vorliegen, weise neutral auf positionsbasierte Abrechnung gemaess Angebot hin.";
}

function buildFrameworkConditions(input: DeepSeekOfferTextRequest): string {
  const parts: string[] = [];
  if (input.projectStartDate?.trim()) {
    parts.push(`Einsatzbeginn: ${input.projectStartDate.trim()}`);
  }
  if (input.duration?.trim()) {
    parts.push(`Laufzeit/Mindestlaufzeit: ${input.duration.trim()}`);
  }
  if (input.paymentTerms?.trim()) {
    parts.push(`Zahlungsbedingungen: ${input.paymentTerms.trim()}`);
  }

  return parts.length > 0 ? parts.join("\n") : "Keine";
}

function buildAgbReference(input: DeepSeekOfferTextRequest): string {
  const explicit = input.agbReference?.trim();
  if (explicit) {
    return explicit;
  }

  const companyName = input.companyName?.trim();
  if (companyName) {
    return `Es gelten die allgemeinen Geschaeftsbedingungen der ${companyName}.`;
  }

  return "Es gelten die allgemeinen Geschaeftsbedingungen des Auftragnehmers.";
}

function normalizeBlockValue(value?: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Keine";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function normalizeResponseText(value: string): string {
  return value.trim();
}

function isResponseSafe(value: string): boolean {
  return !matchesAny(value, IDENTITY_LEAK_PATTERNS) && !matchesAny(value, META_LEAK_PATTERNS);
}

function matchesAny(value: string, entries: Array<{ label: string; pattern: RegExp }>): boolean {
  for (const entry of entries) {
    if (entry.pattern.test(value)) {
      return true;
    }
  }

  return false;
}
