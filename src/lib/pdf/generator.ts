import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb } from "pdf-lib";
import type { QuoteLineItem } from "@/types";
import { deriveQuoteTotalsFromLineItems } from "@/lib/pricing/calculator";
import { localCustomerRepository } from "@/features/customers/repository";
import { companySettingsRepository } from "@/features/company-settings/repository";
import { getSupabaseClient, getSupabaseUserSafe } from "@/lib/supabase/client";
import { tryResolveTenantContext } from "@/lib/supabase/tenant-context";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN_LEFT = 48;
const MARGIN_RIGHT = 48;
const MARGIN_TOP = 52;
const FOOTER_HEIGHT = 58;
const CONTENT_BOTTOM_Y = FOOTER_HEIGHT + 10;
const SECTION_TITLE_HEIGHT = 20;
const SECTION_TITLE_TEXT_INSET_X = 10;
const SECTION_TITLE_TEXT_INSET_Y = 7;
const SECTION_GAP_AFTER_TITLE = 8;
const BLOCK_PADDING_X = 10;
const BLOCK_PADDING_Y = 10;
const TABLE_HEADER_HEIGHT = 22;
const TABLE_ROW_MIN_HEIGHT = 24;
const TABLE_CELL_TEXT_INSET_X = 6;
const TABLE_CELL_TEXT_INSET_Y = 15;
const TABLE_LINE_HEIGHT = 11;

const COLOR_TEXT = rgb(0.12, 0.15, 0.2);
const COLOR_MUTED = rgb(0.36, 0.4, 0.47);
const COLOR_LINE = rgb(0.78, 0.81, 0.86);
const COLOR_HEADER_BG = rgb(0.95, 0.96, 0.98);
const PDF_FONT_REGULAR_PATH = "fonts/noto-sans-regular.ttf";
const PDF_FONT_BOLD_PATH = "fonts/noto-sans-bold.ttf";
const PDF_DEBUG_TIMING = process.env.NODE_ENV !== "production";
const PDF_FONT_CACHE = new Map<string, Promise<Uint8Array>>();

interface DocumentRuntime {
  pdf: PDFDocument;
  font: PDFFont;
  fontBold: PDFFont;
  page: PDFPage;
  cursorY: number;
}

interface CompanyBranding {
  companyName: string;
  logoUrl?: string;
  letterhead?: string;
  footer?: string;
  contactLine?: string;
  paymentTerms?: string;
  legalTermsText?: string;
  currency: string;
  introText?: string;
  closingText?: string;
  address?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  website?: string;
  primaryColor?: string;
  secondaryColor?: string;
  signatureName?: string;
}

export interface QuotePdfCustomer {
  customerId?: string;
  name: string;
  contactPerson?: string;
  address?: string;
  email?: string;
  phone?: string;
}

export interface QuotePdfProject {
  name: string;
  location: string;
  durationMonths: number;
}

export interface QuotePdfTower {
  label: string;
  templateLabel: string;
  rotationDeg: number;
}

export interface QuotePdfPayload {
  quoteNumber: string;
  issueDate: string;
  validUntil?: string;
  notes?: string;
  customer: QuotePdfCustomer;
  project: QuotePdfProject;
  towers: QuotePdfTower[];
  lineItems: QuoteLineItem[];
  onDemandLineItems?: QuoteLineItem[];
  monthlyTotal: number;
  oneTimeTotal: number;
  subtotal: number;
  discountAmount: number;
  totalNet: number;
  totalGross: number;
  vatRate: number;
  generatedText?: string;
  conceptText?: string;
  signerName?: string;
  planSnapshotDataUrl?: string | null;
}

interface TableColumn {
  key: "position" | "label" | "quantity" | "unit" | "unitPrice" | "totalPrice";
  title: string;
  width: number;
  align?: "left" | "right";
}

interface PdfTotals {
  monthlyTotal: number;
  oneTimeTotal: number;
  subtotal: number;
  discountAmount: number;
  totalNet: number;
  totalGross: number;
  vatRate: number;
}

interface PreparedPdfData {
  customer: Required<Pick<QuotePdfCustomer, "name" | "address">> & Omit<QuotePdfCustomer, "name" | "address">;
  lineItems: QuoteLineItem[];
  totals: PdfTotals;
  introText: string;
  notesText: string;
  closingBodyText: string;
  serviceScopeText: string;
  paymentTermsText: string;
  validUntilText: string;
}

const TABLE_COLUMNS: TableColumn[] = [
  { key: "position", title: "Pos.", width: 30 },
  { key: "label", title: "Bezeichnung", width: 205 },
  { key: "quantity", title: "Menge", width: 46, align: "right" },
  { key: "unit", title: "Einheit", width: 44 },
  { key: "unitPrice", title: "Einzelpreis", width: 82, align: "right" },
  { key: "totalPrice", title: "Gesamtpreis", width: 82, align: "right" },
];

export async function generateQuotePdf(payload: QuotePdfPayload): Promise<Uint8Array> {
  const processStartedAt = Date.now();
  const [resolvedCustomer, company] = await measurePdfStage("data-resolution", async () =>
    Promise.all([
      resolveCustomer(payload.customer),
      resolveCompanySettings(payload.signerName),
    ])
  );
  const prepared = await measurePdfStage("validation+template-prep", async () =>
    preparePdfData(payload, company, resolvedCustomer)
  );

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const { font, fontBold } = await loadFonts(pdf);
  pdf.setTitle(`Angebot ${payload.quoteNumber}`);
  pdf.setSubject("Angebot");
  pdf.setProducer("CRM Tool PDF Export");
  pdf.setCreator(company.companyName || "CRM Tool");
  pdf.setCreationDate(new Date());
  pdf.setModificationDate(new Date());

  const runtime = createRuntime(pdf, font, fontBold);

  await measurePdfStage("pdf-render", async () => {
    await drawHeader(runtime, payload, company, prepared.customer);
    runtime.cursorY -= 12;

    drawIntroSection(runtime, payload, company, prepared.introText, prepared.serviceScopeText);
    runtime.cursorY -= 10;

    drawLineItemTable(runtime, prepared.lineItems, company.currency, company);
    runtime.cursorY -= 12;

    drawOnDemandServicesSection(runtime, payload.onDemandLineItems ?? [], company.currency, company);
    runtime.cursorY -= 10;

    drawTotalsSection(runtime, prepared.totals, company.currency, company);
    runtime.cursorY -= 10;

    drawAdditionalInfoSection(runtime, company, {
      paymentTermsText: prepared.paymentTermsText,
      validUntilText: prepared.validUntilText,
      notesText: prepared.notesText,
    });
    runtime.cursorY -= 10;

    drawClosingSection(runtime, company, {
      closingBodyText: prepared.closingBodyText,
    });

    if (payload.planSnapshotDataUrl) {
      await drawAppendixPage(runtime, payload.planSnapshotDataUrl, payload.project.name, company);
    }

    renderFooters(runtime, company);
  });

  const bytes = await measurePdfStage("pdf-save", async () => pdf.save());
  logPdfTiming("total", Date.now() - processStartedAt);
  return bytes;
}

export function buildQuotePdfFileName(input: {
  quoteNumber: string;
  customerName: string;
  projectName: string;
}): string {
  const number = sanitizeFileNameSegment(input.quoteNumber || "angebot");
  const customer = sanitizeFileNameSegment(input.customerName || "kunde");
  const project = sanitizeFileNameSegment(input.projectName || "projekt");
  return `${number}_${customer}_${project}.pdf`;
}

export function downloadPdf(bytes: Uint8Array, fileName: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function createRuntime(pdf: PDFDocument, font: PDFFont, fontBold: PDFFont): DocumentRuntime {
  const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  return {
    pdf,
    font,
    fontBold,
    page,
    cursorY: A4_HEIGHT - MARGIN_TOP,
  };
}

function addPage(runtime: DocumentRuntime, company: CompanyBranding): void {
  runtime.page = runtime.pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  runtime.cursorY = A4_HEIGHT - MARGIN_TOP;
}

function ensureSpace(runtime: DocumentRuntime, requiredHeight: number, company: CompanyBranding): void {
  if (runtime.cursorY - requiredHeight < CONTENT_BOTTOM_Y) {
    addPage(runtime, company);
  }
}

async function loadFonts(pdf: PDFDocument): Promise<{ font: PDFFont; fontBold: PDFFont }> {
  try {
    const [regularBytes, boldBytes] = await Promise.all([
      loadPdfFontResource(PDF_FONT_REGULAR_PATH),
      loadPdfFontResource(PDF_FONT_BOLD_PATH),
    ]);

    const font = await pdf.embedFont(regularBytes, { subset: false });
    const fontBold = await pdf.embedFont(boldBytes, { subset: false });
    return { font, fontBold };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `PDF fonts could not be loaded (regular=${PDF_FONT_REGULAR_PATH}, bold=${PDF_FONT_BOLD_PATH}): ${message}`
    );
  }
}

async function drawHeader(
  runtime: DocumentRuntime,
  payload: QuotePdfPayload,
  company: CompanyBranding,
  customer: Required<Pick<QuotePdfCustomer, "name" | "address">> & Omit<QuotePdfCustomer, "name" | "address">
): Promise<void> {
  const { page, font, fontBold } = runtime;
  const contentWidth = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

  page.drawLine({
    start: { x: MARGIN_LEFT, y: runtime.cursorY - 80 },
    end: { x: MARGIN_LEFT + contentWidth, y: runtime.cursorY - 80 },
    thickness: 1,
    color: COLOR_LINE,
  });

  const senderX = MARGIN_LEFT;
  const senderY = runtime.cursorY;

  if (company.logoUrl) {
    await drawHeaderLogo(runtime.page, runtime.pdf, company.logoUrl, senderX, senderY);
  }

  const textStartX = senderX + 112;
  drawLabel(page, "Absender", textStartX, senderY + 2, fontBold);
  drawText(page, company.companyName || "Firma", textStartX, senderY - 14, 13, fontBold);

  let senderLineY = senderY - 30;
  for (const line of buildSenderLines(company).slice(0, 5)) {
    drawText(page, line, textStartX, senderLineY, 9, font, COLOR_MUTED);
    senderLineY -= 11;
  }

  const recipientTopY = runtime.cursorY - 96;
  const recipientBoxX = MARGIN_LEFT;
  const recipientBoxY = recipientTopY - 68;
  const recipientBoxW = 260;
  const recipientBoxH = 74;
  page.drawRectangle({
    x: recipientBoxX,
    y: recipientBoxY,
    width: recipientBoxW,
    height: recipientBoxH,
    color: rgb(0.99, 0.992, 0.996),
    borderColor: COLOR_LINE,
    borderWidth: 1,
  });
  drawLabel(page, "Anschrift", recipientBoxX + BLOCK_PADDING_X, recipientTopY - 3, fontBold);

  let recipientY = recipientTopY - 18;
  drawText(page, customer.name, recipientBoxX + BLOCK_PADDING_X, recipientY, 10, fontBold);
  recipientY -= 12;
  drawText(page, customer.address, recipientBoxX + BLOCK_PADDING_X, recipientY, 10, font);
  recipientY -= 12;
  if (customer.email) {
    drawText(page, `E-Mail: ${customer.email}`, recipientBoxX + BLOCK_PADDING_X, recipientY, 9, font, COLOR_MUTED);
    recipientY -= 11;
  }
  if (customer.phone) {
    drawText(page, `Telefon: ${customer.phone}`, recipientBoxX + BLOCK_PADDING_X, recipientY, 9, font, COLOR_MUTED);
  }

  const metaX = A4_WIDTH - MARGIN_RIGHT - 210;
  const metaTop = runtime.cursorY - 96;
  page.drawRectangle({
    x: metaX,
    y: metaTop - 68,
    width: 210,
    height: 74,
    color: rgb(0.99, 0.992, 0.996),
    borderColor: COLOR_LINE,
    borderWidth: 1,
  });
  drawLabel(page, "Angebotsdaten", metaX + BLOCK_PADDING_X, metaTop - 3, fontBold);
  drawKeyValue(page, "Angebotsnummer", payload.quoteNumber, metaX + BLOCK_PADDING_X, metaTop - 18, font, fontBold);
  drawKeyValue(page, "Datum", formatIsoDate(payload.issueDate), metaX + BLOCK_PADDING_X, metaTop - 32, font, fontBold);
  drawKeyValue(
    page,
    "Ansprechpartner",
    customer.contactPerson || company.contactPerson || "-",
    metaX + BLOCK_PADDING_X,
    metaTop - 46,
    font,
    fontBold
  );

  runtime.cursorY -= 182;
}

async function drawHeaderLogo(page: PDFPage, pdf: PDFDocument, logoUrl: string, x: number, y: number): Promise<void> {
  try {
    const logo = await embedImage(pdf, logoUrl);
    if (!logo) {
      return;
    }

    const maxWidth = 94;
    const maxHeight = 48;
    const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height, 1);

    const rightX = A4_WIDTH - MARGIN_RIGHT - (logo.width * scale);
    page.drawImage(logo.ref, {
      x: Math.max(x, rightX),
      y: y - logo.height * scale + 6,
      width: logo.width * scale,
      height: logo.height * scale,
    });
  } catch {
    // Ignore logo rendering errors and continue with text header.
  }
}

function drawIntroSection(
  runtime: DocumentRuntime,
  payload: QuotePdfPayload,
  company: CompanyBranding,
  introText: string,
  serviceScopeText: string
): void {
  const leftBoxWidth = 210;
  const gap = 14;
  const rightBoxWidth = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT - leftBoxWidth - gap;
  const leftBoxHeight = 78;
  const rightIntroLines = wrapText(introText, runtime.font, 10, rightBoxWidth - (BLOCK_PADDING_X * 2), 6);
  const rightScopeLines = wrapText(serviceScopeText, runtime.font, 10, rightBoxWidth - (BLOCK_PADDING_X * 2), 8);
  const rightBoxHeight = Math.max(110, 24 + (rightIntroLines.length * 12) + 14 + (rightScopeLines.length * 12));
  const totalHeight = Math.max(leftBoxHeight, rightBoxHeight) + SECTION_TITLE_HEIGHT + SECTION_GAP_AFTER_TITLE + 14;
  ensureSpace(runtime, totalHeight, company);

  drawSectionTitle(runtime, "Einleitung", company);

  const leftX = MARGIN_LEFT;
  const rightX = leftX + leftBoxWidth + gap;
  const topY = runtime.cursorY;

  runtime.page.drawRectangle({
    x: leftX,
    y: topY - leftBoxHeight,
    width: leftBoxWidth,
    height: leftBoxHeight,
    color: rgb(0.99, 0.992, 0.996),
    borderColor: COLOR_LINE,
    borderWidth: 1,
  });

  let leftY = topY - BLOCK_PADDING_Y - 1;
  drawKeyValue(runtime.page, "Projektname", payload.project.name, leftX + BLOCK_PADDING_X, leftY, runtime.font, runtime.fontBold);
  leftY -= 20;
  drawKeyValue(runtime.page, "Einsatzort", payload.project.location, leftX + BLOCK_PADDING_X, leftY, runtime.font, runtime.fontBold);
  leftY -= 20;
  drawKeyValue(runtime.page, "Laufzeit", `${payload.project.durationMonths} Monat(e)`, leftX + BLOCK_PADDING_X, leftY, runtime.font, runtime.fontBold);

  runtime.page.drawRectangle({
    x: rightX,
    y: topY - rightBoxHeight,
    width: rightBoxWidth,
    height: rightBoxHeight,
    color: rgb(0.99, 0.992, 0.996),
    borderColor: COLOR_LINE,
    borderWidth: 1,
  });

  let rightY = topY - BLOCK_PADDING_Y - 1;
  drawText(runtime.page, "Einleitung", rightX + BLOCK_PADDING_X, rightY, 10, runtime.fontBold);
  rightY -= 14;
  rightY = drawLines(runtime.page, rightIntroLines, rightX + BLOCK_PADDING_X, rightY, 10, 12, runtime.font, COLOR_TEXT);
  rightY -= 8;
  drawText(runtime.page, "Leistungsumfang", rightX + BLOCK_PADDING_X, rightY, 10, runtime.fontBold);
  rightY -= 14;
  drawLines(runtime.page, rightScopeLines, rightX + BLOCK_PADDING_X, rightY, 10, 12, runtime.font, COLOR_TEXT);

  runtime.cursorY -= Math.max(leftBoxHeight, rightBoxHeight) + 8;
}

function drawAdditionalInfoSection(
  runtime: DocumentRuntime,
  company: CompanyBranding,
  input: {
    paymentTermsText: string;
    validUntilText: string;
    notesText: string;
  }
): void {
  ensureSpace(runtime, 90, company);
  drawSectionTitle(runtime, "Zusatzangaben", company);

  drawInfoRow(runtime, "Zahlungsbedingungen", input.paymentTermsText, company);
  drawInfoRow(runtime, "Angebotsgültigkeit", input.validUntilText, company);

  ensureSpace(runtime, 24, company);
  drawText(runtime.page, "Hinweise:", MARGIN_LEFT + BLOCK_PADDING_X, runtime.cursorY - 2, 10, runtime.fontBold);
  runtime.cursorY -= 16;
  renderSectionWithAutoPageBreak(runtime, wrapText(input.notesText, runtime.font, 10, A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT - (BLOCK_PADDING_X * 2), 120), 10, 12, company, COLOR_TEXT);

  const legalTerms = company.legalTermsText?.trim() ?? "";
  if (legalTerms.length > 0) {
    runtime.cursorY -= 6;
    ensureSpace(runtime, 24, company);
    drawText(runtime.page, "AGB / Vertragsbedingungen / Datenschutz:", MARGIN_LEFT + BLOCK_PADDING_X, runtime.cursorY - 2, 9, runtime.fontBold, COLOR_MUTED);
    runtime.cursorY -= 16;
    renderSectionWithAutoPageBreak(runtime, wrapText(legalTerms, runtime.font, 9, A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT - (BLOCK_PADDING_X * 2), 200), 9, 11, company, COLOR_MUTED);
  }

  runtime.cursorY -= 6;
}

function drawInfoRow(runtime: DocumentRuntime, label: string, value: string, company: CompanyBranding): void {
  ensureSpace(runtime, 24, company);
  const rowY = runtime.cursorY;
  drawText(runtime.page, `${label}:`, MARGIN_LEFT + BLOCK_PADDING_X, rowY - 2, 9.5, runtime.fontBold, COLOR_TEXT);
  drawText(runtime.page, value || "-", MARGIN_LEFT + 130, rowY - 2, 9.5, runtime.font, COLOR_TEXT);
  runtime.page.drawRectangle({
    x: MARGIN_LEFT,
    y: rowY - 18,
    width: A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT,
    height: 20,
    borderColor: COLOR_LINE,
    borderWidth: 0.6,
  });
  runtime.cursorY -= 22;
}

function renderSectionWithAutoPageBreak(
  runtime: DocumentRuntime,
  lines: string[],
  size: number,
  lineHeight: number,
  company: CompanyBranding,
  color = COLOR_TEXT
): void {
  for (const line of lines) {
    ensureSpace(runtime, lineHeight + 2, company);
    drawText(runtime.page, line, MARGIN_LEFT + BLOCK_PADDING_X, runtime.cursorY - 2, size, runtime.font, color);
    runtime.cursorY -= lineHeight;
  }
}

function drawLineItemTable(
  runtime: DocumentRuntime,
  lineItems: QuoteLineItem[],
  currency: string,
  company: CompanyBranding
): void {
  drawSectionTitle(runtime, "Leistungs-/Positionsübersicht", company);

  const drawTableHead = () => {
    ensureSpace(runtime, TABLE_HEADER_HEIGHT + 10, company);
    const headerY = runtime.cursorY;
    let cursorX = MARGIN_LEFT;

    runtime.page.drawRectangle({
      x: MARGIN_LEFT,
      y: headerY - TABLE_HEADER_HEIGHT,
      width: A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT,
      height: TABLE_HEADER_HEIGHT,
      color: COLOR_HEADER_BG,
    });

    for (const col of TABLE_COLUMNS) {
      drawText(
        runtime.page,
        col.title,
        cursorX + TABLE_CELL_TEXT_INSET_X,
        headerY - TABLE_CELL_TEXT_INSET_Y,
        9,
        runtime.fontBold
      );
      cursorX += col.width;
    }

    runtime.page.drawLine({
      start: { x: MARGIN_LEFT, y: headerY - TABLE_HEADER_HEIGHT },
      end: { x: A4_WIDTH - MARGIN_RIGHT, y: headerY - TABLE_HEADER_HEIGHT },
      thickness: 1,
      color: COLOR_LINE,
    });

    runtime.cursorY = headerY - TABLE_HEADER_HEIGHT;
  };

  drawTableHead();

  lineItems.forEach((item, index) => {
    const positionLabel = String(index + 1);
    const itemLabel = buildItemLabel(item);
    const labelLines = wrapText(itemLabel, runtime.font, 9, getColumnWidth("label") - (TABLE_CELL_TEXT_INSET_X * 2), 4);
    const rowHeight = Math.max(TABLE_ROW_MIN_HEIGHT, labelLines.length * TABLE_LINE_HEIGHT + 10);

    if (runtime.cursorY - rowHeight < CONTENT_BOTTOM_Y + 14) {
      addPage(runtime, company);
      drawSectionTitle(runtime, "Leistungs-/Positionsübersicht (Fortsetzung)", company);
      drawTableHead();
    }

    let cursorX = MARGIN_LEFT;
    const rowTop = runtime.cursorY;

    drawTableCell(runtime.page, positionLabel, cursorX, rowTop, getColumnWidth("position"), rowHeight, runtime.font, "left");
    cursorX += getColumnWidth("position");

    drawTableCellMultiline(runtime.page, labelLines, cursorX, rowTop, getColumnWidth("label"), rowHeight, runtime.font);
    cursorX += getColumnWidth("label");

    drawTableCell(runtime.page, formatNumber(item.quantity), cursorX, rowTop, getColumnWidth("quantity"), rowHeight, runtime.font, "right");
    cursorX += getColumnWidth("quantity");

    drawTableCell(runtime.page, item.unit || "-", cursorX, rowTop, getColumnWidth("unit"), rowHeight, runtime.font, "left");
    cursorX += getColumnWidth("unit");

    drawTableCell(runtime.page, formatCurrency(item.unitPrice, currency), cursorX, rowTop, getColumnWidth("unitPrice"), rowHeight, runtime.font, "right");
    cursorX += getColumnWidth("unitPrice");

    drawTableCell(runtime.page, formatCurrency(item.totalPrice, currency), cursorX, rowTop, getColumnWidth("totalPrice"), rowHeight, runtime.fontBold, "right");

    runtime.page.drawLine({
      start: { x: MARGIN_LEFT, y: rowTop - rowHeight },
      end: { x: A4_WIDTH - MARGIN_RIGHT, y: rowTop - rowHeight },
      thickness: 0.7,
      color: COLOR_LINE,
    });

    runtime.cursorY -= rowHeight;
  });
}

function drawTotalsSection(runtime: DocumentRuntime, totals: PdfTotals, currency: string, company: CompanyBranding): void {
  const rowHeight = 15;
  const rowsCount = 7;
  const boxHeight = (BLOCK_PADDING_Y * 2) + rowsCount * rowHeight + 2;
  ensureSpace(runtime, boxHeight + SECTION_TITLE_HEIGHT, company);

  drawSectionTitle(runtime, "Summenblock", company);

  const rows = [
    { label: "Wiederkehrend", value: formatCurrency(totals.monthlyTotal, currency) },
    { label: "Einmalig", value: formatCurrency(totals.oneTimeTotal, currency) },
    { label: "Zwischensumme", value: formatCurrency(totals.subtotal, currency) },
    { label: "Rabatt", value: `- ${formatCurrency(totals.discountAmount, currency)}` },
    { label: "Netto", value: formatCurrency(totals.totalNet, currency), bold: true },
    {
      label: `MwSt (${Math.round(totals.vatRate * 100)}%)`,
      value: formatCurrency(Math.max(totals.totalGross - totals.totalNet, 0), currency),
    },
    { label: "Brutto", value: formatCurrency(totals.totalGross, currency), bold: true },
  ];

  let y = runtime.cursorY - BLOCK_PADDING_Y - 1;
  const left = A4_WIDTH - MARGIN_RIGHT - 230;
  const width = 230;

  runtime.page.drawRectangle({
    x: left,
    y: runtime.cursorY - boxHeight,
    width,
    height: boxHeight,
    color: rgb(0.985, 0.988, 0.995),
    borderColor: COLOR_LINE,
    borderWidth: 1,
  });

  rows.forEach((row) => {
    drawText(runtime.page, row.label, left + BLOCK_PADDING_X, y, 10, row.bold ? runtime.fontBold : runtime.font);
    drawRightAlignedText(runtime.page, row.value, left + width - BLOCK_PADDING_X, y, 10, row.bold ? runtime.fontBold : runtime.font);
    y -= rowHeight;
  });

  runtime.cursorY -= boxHeight + 4;
}

function drawOnDemandServicesSection(
  runtime: DocumentRuntime,
  onDemandLineItems: QuoteLineItem[],
  currency: string,
  company: CompanyBranding
): void {
  if (onDemandLineItems.length === 0) {
    return;
  }

  ensureSpace(runtime, 120, company);
  drawSectionTitle(runtime, "Zusatzleistungen (auf Anforderung)", company);

  const introLines = wrapText(
    "Diese Leistungen sind nicht Bestandteil der laufenden Kalkulation und werden nur bei tatsächlicher Inanspruchnahme berechnet.",
    runtime.font,
    9,
    A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT - (BLOCK_PADDING_X * 2),
    3
  );
  runtime.cursorY = drawLines(runtime.page, introLines, MARGIN_LEFT + BLOCK_PADDING_X, runtime.cursorY - 1, 9, 11, runtime.font, COLOR_MUTED) - 6;

  const cols = [
    { key: "leistung", title: "Leistung", width: 270 },
    { key: "abrechnung", title: "Abrechnung", width: 120 },
    { key: "preis", title: "Preis", width: 109 },
  ] as const;

  const drawHead = () => {
    ensureSpace(runtime, TABLE_HEADER_HEIGHT + 8, company);
    const y = runtime.cursorY;
    runtime.page.drawRectangle({
      x: MARGIN_LEFT,
      y: y - TABLE_HEADER_HEIGHT,
      width: A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT,
      height: TABLE_HEADER_HEIGHT,
      color: COLOR_HEADER_BG,
    });
    let x = MARGIN_LEFT;
    cols.forEach((col) => {
      drawText(runtime.page, col.title, x + TABLE_CELL_TEXT_INSET_X, y - TABLE_CELL_TEXT_INSET_Y, 9, runtime.fontBold);
      x += col.width;
    });
    runtime.cursorY -= TABLE_HEADER_HEIGHT;
  };

  drawHead();

  onDemandLineItems.forEach((item) => {
    const rowHeight = TABLE_ROW_MIN_HEIGHT;
    ensureSpace(runtime, rowHeight + 4, company);
    const y = runtime.cursorY;
    let x = MARGIN_LEFT;

    const label = item.description ? `${item.label} - ${item.description}` : item.label;
    drawText(runtime.page, label, x + TABLE_CELL_TEXT_INSET_X, y - TABLE_CELL_TEXT_INSET_Y, 9, runtime.font);
    x += cols[0].width;

    drawText(runtime.page, item.unit || "-", x + TABLE_CELL_TEXT_INSET_X, y - TABLE_CELL_TEXT_INSET_Y, 9, runtime.font);
    x += cols[1].width;

    drawRightAlignedText(runtime.page, formatCurrency(item.unitPrice, currency), x + cols[2].width - TABLE_CELL_TEXT_INSET_X, y - TABLE_CELL_TEXT_INSET_Y, 9, runtime.fontBold);

    runtime.page.drawLine({
      start: { x: MARGIN_LEFT, y: y - rowHeight },
      end: { x: A4_WIDTH - MARGIN_RIGHT, y: y - rowHeight },
      thickness: 0.7,
      color: COLOR_LINE,
    });
    runtime.cursorY -= rowHeight;
  });
}

function drawClosingSection(
  runtime: DocumentRuntime,
  company: CompanyBranding,
  input: {
    closingBodyText: string;
  }
): void {
  ensureSpace(runtime, 120, company);
  drawSectionTitle(runtime, "Abschluss", company);

  const signerName = company.signatureName?.trim() || company.contactPerson?.trim() || company.companyName || "Ihr Team";
  const boxX = MARGIN_LEFT;
  const boxW = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const lines = wrapText(input.closingBodyText, runtime.font, 10, boxW - (BLOCK_PADDING_X * 2), 4);
  const boxHeight = (BLOCK_PADDING_Y * 2) + Math.max(lines.length * 12, 16) + 22;

  runtime.page.drawRectangle({
    x: boxX,
    y: runtime.cursorY - boxHeight,
    width: boxW,
    height: boxHeight,
    color: rgb(0.99, 0.992, 0.996),
    borderColor: COLOR_LINE,
    borderWidth: 1,
  });

  let y = drawLines(
    runtime.page,
    lines,
    boxX + BLOCK_PADDING_X,
    runtime.cursorY - BLOCK_PADDING_Y - 1,
    10,
    12,
    runtime.font,
    COLOR_TEXT
  );
  y -= 8;

  drawText(runtime.page, "Mit freundlichen Grüßen", boxX + BLOCK_PADDING_X, y, 10, runtime.font);
  y -= 14;
  drawText(runtime.page, signerName, boxX + BLOCK_PADDING_X, y, 10, runtime.fontBold);
  y -= 14;
  drawKeyValue(runtime.page, "Kontakt", company.contactLine || buildSenderLines(company).join(" | "), boxX + BLOCK_PADDING_X, y, runtime.font, runtime.fontBold);

  runtime.cursorY -= boxHeight + 4;
}

async function drawAppendixPage(
  runtime: DocumentRuntime,
  snapshotDataUrl: string,
  projectName: string,
  company: CompanyBranding
): Promise<void> {
  addPage(runtime, company);

  drawSectionTitle(runtime, "Anhang", company);
  drawText(runtime.page, `Planbild / Snapshot - ${projectName}`, MARGIN_LEFT, runtime.cursorY - 16, 10, runtime.font, COLOR_MUTED);

  const image = await embedImage(runtime.pdf, snapshotDataUrl);
  if (!image) {
    drawText(runtime.page, "Anhang konnte nicht geladen werden.", MARGIN_LEFT, runtime.cursorY - 34, 10, runtime.font, COLOR_MUTED);
    return;
  }

  const maxW = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const maxH = A4_HEIGHT - MARGIN_TOP - CONTENT_BOTTOM_Y - 40;
  const scale = Math.min(maxW / image.width, maxH / image.height, 1);
  const drawW = image.width * scale;
  const drawH = image.height * scale;

  runtime.page.drawImage(image.ref, {
    x: MARGIN_LEFT + (maxW - drawW) / 2,
    y: CONTENT_BOTTOM_Y + (maxH - drawH) / 2,
    width: drawW,
    height: drawH,
  });

}

function drawSectionTitle(runtime: DocumentRuntime, title: string, company: CompanyBranding): void {
  ensureSpace(runtime, SECTION_TITLE_HEIGHT + 8, company);
  const primaryColor = parseHexColor(company.primaryColor, COLOR_HEADER_BG);
  const secondaryColor = parseHexColor(company.secondaryColor, COLOR_TEXT);

  runtime.page.drawRectangle({
    x: MARGIN_LEFT,
    y: runtime.cursorY - SECTION_TITLE_HEIGHT,
    width: A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT,
    height: SECTION_TITLE_HEIGHT,
    color: primaryColor,
  });

  drawText(
    runtime.page,
    title,
    MARGIN_LEFT + SECTION_TITLE_TEXT_INSET_X,
    runtime.cursorY - SECTION_TITLE_TEXT_INSET_Y - 3,
    10,
    runtime.fontBold,
    secondaryColor
  );
  runtime.cursorY -= SECTION_TITLE_HEIGHT + SECTION_GAP_AFTER_TITLE;
}

function drawPageFooter(page: PDFPage, pageLabel: string, font: PDFFont, company: CompanyBranding): void {
  const footerTop = FOOTER_HEIGHT;
  const footerTextTop = footerTop + 6;
  const copyrightText = buildCopyrightFooterText(company);

  page.drawLine({
    start: { x: MARGIN_LEFT, y: footerTop + 16 },
    end: { x: A4_WIDTH - MARGIN_RIGHT, y: footerTop + 16 },
    thickness: 0.8,
    color: COLOR_LINE,
  });

  const footerText = company.footer || "";
  if (footerText) {
    const lines = wrapText(footerText, font, 8, A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT - 80, 2);
    drawLines(page, lines, MARGIN_LEFT, footerTextTop, 8, 10, font, COLOR_MUTED);
  }

  drawRightAlignedText(page, pageLabel, A4_WIDTH - MARGIN_RIGHT, footerTop + 6, 8, font, COLOR_MUTED);

  const copyrightWidth = font.widthOfTextAtSize(normalizePdfText(copyrightText), 8);
  const centeredX = (A4_WIDTH - copyrightWidth) / 2;
  drawText(page, copyrightText, centeredX, 16, 8, font, rgb(0.45, 0.48, 0.53));
}

function renderFooters(runtime: DocumentRuntime, company: CompanyBranding): void {
  const pages = runtime.pdf.getPages();
  const total = pages.length;
  pages.forEach((page, index) => {
    drawPageFooter(page, `Seite ${index + 1} von ${total}`, runtime.font, company);
  });
}

function buildCopyrightFooterText(company: CompanyBranding): string {
  const year = new Date().getFullYear();
  const companyName = (company.companyName || "").trim();

  if (companyName.length > 0) {
    return `© ${year} ViorAI (Phillipp Reiß) – ${companyName} – Alle Rechte vorbehalten`;
  }

  return `© ${year} ViorAI (Phillipp Reiß) – Alle Rechte vorbehalten`;
}

function drawKeyValue(
  page: PDFPage,
  key: string,
  value: string,
  x: number,
  y: number,
  font: PDFFont,
  fontBold: PDFFont
): void {
  drawText(page, `${key}:`, x, y, 9.5, fontBold, COLOR_TEXT);
  drawText(page, value || "-", getKeyValueValueX(key, x, fontBold, 9.5), y, 9.5, font, COLOR_TEXT);
}

function getKeyValueValueX(key: string, x: number, fontBold: PDFFont, size: number): number {
  const labelWidth = fontBold.widthOfTextAtSize(`${normalizePdfText(key)}:`, size);
  return x + Math.max(92, Math.ceil(labelWidth) + 12);
}

function drawLabel(page: PDFPage, text: string, x: number, y: number, fontBold: PDFFont): void {
  drawText(page, text, x, y, 9.5, fontBold, COLOR_MUTED);
}

function drawTableCell(
  page: PDFPage,
  value: string,
  x: number,
  y: number,
  width: number,
  rowHeight: number,
  font: PDFFont,
  align: "left" | "right"
): void {
  if (align === "right") {
    drawRightAlignedText(page, value, x + width - TABLE_CELL_TEXT_INSET_X, y - TABLE_CELL_TEXT_INSET_Y, 9, font);
  } else {
    drawText(page, value, x + TABLE_CELL_TEXT_INSET_X, y - TABLE_CELL_TEXT_INSET_Y, 9, font);
  }

  page.drawLine({
    start: { x: x + width, y },
    end: { x: x + width, y: y - rowHeight },
    thickness: 0.5,
    color: COLOR_LINE,
  });
}

function drawTableCellMultiline(
  page: PDFPage,
  lines: string[],
  x: number,
  y: number,
  width: number,
  rowHeight: number,
  font: PDFFont
): void {
  let lineY = y - (TABLE_CELL_TEXT_INSET_Y - 2);
  lines.forEach((line) => {
    drawText(page, line, x + TABLE_CELL_TEXT_INSET_X, lineY, 9, font);
    lineY -= TABLE_LINE_HEIGHT;
  });

  page.drawLine({
    start: { x: x + width, y },
    end: { x: x + width, y: y - rowHeight },
    thickness: 0.5,
    color: COLOR_LINE,
  });
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  color = COLOR_TEXT
): void {
  page.drawText(normalizePdfText(text), { x, y, size, font, color });
}

function drawRightAlignedText(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  size: number,
  font: PDFFont,
  color = COLOR_TEXT
): void {
  const normalizedText = normalizePdfText(text);
  const width = font.widthOfTextAtSize(normalizedText, size);
  page.drawText(normalizedText, { x: rightX - width, y, size, font, color });
}

function drawLines(
  page: PDFPage,
  lines: string[],
  x: number,
  y: number,
  size: number,
  lineHeight: number,
  font: PDFFont,
  color = COLOR_TEXT
): number {
  let cursor = y;
  lines.forEach((line) => {
    drawText(page, line, x, cursor, size, font, color);
    cursor -= lineHeight;
  });

  return cursor;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
  const normalized = normalizePdfText(text).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return ["-"];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    const nextWidth = font.widthOfTextAtSize(next, size);

    if (nextWidth <= maxWidth) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
    } else {
      lines.push(truncateText(word, font, size, maxWidth));
    }

    current = word;
    if (lines.length >= maxLines) {
      break;
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(truncateText(current, font, size, maxWidth));
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
  }

  if (lines.length === maxLines) {
    const last = lines[maxLines - 1] || "";
    lines[maxLines - 1] = ensureEllipsis(last, font, size, maxWidth);
  }

  return lines;
}

function normalizePdfText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFC")
    .replace(/\u00A0/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
}

function truncateText(value: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(value, size) <= maxWidth) {
    return value;
  }

  let result = value;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}...`, size) > maxWidth) {
    result = result.slice(0, -1);
  }

  return `${result}...`;
}

function ensureEllipsis(value: string, font: PDFFont, size: number, maxWidth: number): string {
  if (value.endsWith("...") || font.widthOfTextAtSize(value, size) <= maxWidth) {
    return value;
  }

  return truncateText(value, font, size, maxWidth);
}

function getColumnWidth(key: TableColumn["key"]): number {
  const col = TABLE_COLUMNS.find((entry) => entry.key === key);
  return col?.width ?? 0;
}

function buildItemLabel(item: QuoteLineItem): string {
  const base = item.label || "Position";
  if (!item.description || item.description.trim().length === 0) {
    return base;
  }

  return `${base} - ${item.description.trim()}`;
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: currency || "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatIsoDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}

function defaultValidUntil(): string {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
}

function sanitizeFileNameSegment(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "angebot";
}

function calculatePdfTotals(payload: QuotePdfPayload): PdfTotals {
  const derived = deriveQuoteTotalsFromLineItems({
    lineItems: payload.lineItems,
    discountAmount: sanitizeAmount(payload.discountAmount),
    vatRate: sanitizeAmount(payload.vatRate),
  });

  return {
    monthlyTotal: derived.monthlyTotal,
    oneTimeTotal: derived.oneTimeTotal,
    subtotal: derived.subtotal,
    discountAmount: derived.discountAmount,
    totalNet: derived.totalNet,
    totalGross: derived.totalGross,
    vatRate: derived.vatRate,
  };
}

function preparePdfData(
  payload: QuotePdfPayload,
  company: CompanyBranding,
  customer: Required<Pick<QuotePdfCustomer, "name" | "address">> & Omit<QuotePdfCustomer, "name" | "address">
): PreparedPdfData {
  const lineItems = payload.lineItems.map((item) => normalizeLineItemForPdf(item));
  const totals = calculatePdfTotals({ ...payload, lineItems });
  validateOfferForPdf({ payload, lineItems, totals, customer });

  const introText = buildDeterministicOfferText({
    projectName: payload.project.name,
    location: payload.project.location,
    customerName: customer.name,
    durationMonths: payload.project.durationMonths,
  });
  const notesText = sanitizeRichTextToPlainText(payload.notes || payload.conceptText || "-");
  const serviceScopeText = sanitizeRichTextToPlainText(payload.generatedText || "Leistungsumfang gemäß Positionsübersicht.");
  const paymentTermsText = sanitizeRichTextToPlainText(company.paymentTerms || "Zahlbar innerhalb von 14 Tagen ohne Abzug.");
  const validUntilText = formatIsoDate(payload.validUntil ? payload.validUntil : defaultValidUntil());
  const closingBodyText = sanitizeClosingBody(company.closingText || "Für Rückfragen stehen wir Ihnen jederzeit gern zur Verfügung.");

  return {
    customer,
    lineItems,
    totals,
    introText,
    notesText,
    closingBodyText,
    serviceScopeText,
    paymentTermsText,
    validUntilText,
  };
}

function normalizeLineItemForPdf(item: QuoteLineItem): QuoteLineItem {
  const quantity = Number.isFinite(item.quantity) ? Math.max(0, item.quantity) : 0;
  const unitPrice = Number.isFinite(item.unitPrice) ? Math.max(0, item.unitPrice) : 0;
  const computedTotal = roundCurrency(quantity * unitPrice);
  return {
    ...item,
    label: sanitizeRichTextToPlainText(item.label || "Position"),
    description: item.description ? sanitizeRichTextToPlainText(item.description) : undefined,
    unit: sanitizeRichTextToPlainText(item.unit || "-"),
    quantity,
    unitPrice,
    totalPrice: computedTotal,
  };
}

function validateOfferForPdf(input: {
  payload: QuotePdfPayload;
  lineItems: QuoteLineItem[];
  totals: PdfTotals;
  customer: Required<Pick<QuotePdfCustomer, "name" | "address">> & Omit<QuotePdfCustomer, "name" | "address">;
}): void {
  const errors: string[] = [];
  const payload = input.payload;
  if (!payload.quoteNumber?.trim()) {
    errors.push("Angebotsnummer fehlt.");
  }
  if (!payload.issueDate?.trim()) {
    errors.push("Ausstellungsdatum fehlt.");
  }
  if (!payload.project?.name?.trim()) {
    errors.push("Projektname fehlt.");
  }
  if (!input.customer.name?.trim()) {
    errors.push("Kundenname fehlt.");
  }
  if (!Array.isArray(input.lineItems) || input.lineItems.length === 0) {
    errors.push("Es sind keine Positionen vorhanden.");
  }

  input.lineItems.forEach((item, index) => {
    if (!item.label?.trim()) {
      errors.push(`Position ${index + 1}: Bezeichnung fehlt.`);
    }
    if (!item.unit?.trim()) {
      errors.push(`Position ${index + 1}: Einheit fehlt.`);
    }
    if (!Number.isFinite(item.quantity) || item.quantity < 0) {
      errors.push(`Position ${index + 1}: Menge ist ungültig.`);
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      errors.push(`Position ${index + 1}: Einzelpreis ist ungültig.`);
    }
    if (!Number.isFinite(item.totalPrice) || item.totalPrice < 0) {
      errors.push(`Position ${index + 1}: Gesamtpreis ist ungültig.`);
    }

    const expected = roundCurrency(item.quantity * item.unitPrice);
    const delta = Math.abs(expected - roundCurrency(item.totalPrice));
    if (delta > 0.01) {
      errors.push(`Position ${index + 1}: Gesamtpreis stimmt nicht zu Menge x Einzelpreis.`);
    }

    if (item.billingMode === "recurring" && item.interval === "once") {
      errors.push(`Position ${index + 1}: Widerspruch zwischen wiederkehrend und Intervall einmalig.`);
    }
    if (item.billingMode === "one_time" && item.interval !== "once") {
      errors.push(`Position ${index + 1}: Widerspruch zwischen einmalig und Intervall.`);
    }
  });

  const serverTotals = deriveQuoteTotalsFromLineItems({
    lineItems: input.lineItems,
    discountAmount: input.totals.discountAmount,
    vatRate: input.totals.vatRate,
  });

  if (Math.abs(serverTotals.monthlyTotal - input.totals.monthlyTotal) > 0.01) {
    errors.push("Summenblock: Wiederkehrend ist inkonsistent.");
  }
  if (Math.abs(serverTotals.oneTimeTotal - input.totals.oneTimeTotal) > 0.01) {
    errors.push("Summenblock: Einmalig ist inkonsistent.");
  }
  if (Math.abs(serverTotals.subtotal - input.totals.subtotal) > 0.01) {
    errors.push("Summenblock: Zwischensumme ist inkonsistent.");
  }
  if (Math.abs(serverTotals.totalNet - input.totals.totalNet) > 0.01) {
    errors.push("Summenblock: Netto ist inkonsistent.");
  }
  if (Math.abs(serverTotals.totalGross - input.totals.totalGross) > 0.01) {
    errors.push("Summenblock: Brutto ist inkonsistent.");
  }

  const payloadMonthlyTotal = roundCurrency(sanitizeAmount(payload.monthlyTotal));
  const payloadOneTimeTotal = roundCurrency(sanitizeAmount(payload.oneTimeTotal));
  const payloadTotalNet = roundCurrency(sanitizeAmount(payload.totalNet));
  const payloadTotalGross = roundCurrency(sanitizeAmount(payload.totalGross));
  if (
    Math.abs(serverTotals.monthlyTotal - payloadMonthlyTotal) > 0.01
    || Math.abs(serverTotals.oneTimeTotal - payloadOneTimeTotal) > 0.01
    || Math.abs(serverTotals.totalNet - payloadTotalNet) > 0.01
    || Math.abs(serverTotals.totalGross - payloadTotalGross) > 0.01
  ) {
    console.warn("[pdf] Payload-Summen weichen von serverseitiger Berechnung ab. Es werden serverseitige Summen verwendet.", {
      payload: {
        monthlyTotal: payloadMonthlyTotal,
        oneTimeTotal: payloadOneTimeTotal,
        totalNet: payloadTotalNet,
        totalGross: payloadTotalGross,
      },
      server: {
        monthlyTotal: serverTotals.monthlyTotal,
        oneTimeTotal: serverTotals.oneTimeTotal,
        totalNet: serverTotals.totalNet,
        totalGross: serverTotals.totalGross,
      },
    });
  }

  if (errors.length > 0) {
    throw new Error(`PDF-Validierung fehlgeschlagen: ${errors.join(" | ")}`);
  }
}

function sanitizeRichTextToPlainText(value: string): string {
  return normalizeParagraphs(
    (value || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
      .replace(/[>*]+/g, " ")
      .replace(/\r\n/g, "\n")
  );
}

function normalizeParagraphs(value: string): string {
  const normalized = value
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
  return normalized.length > 0 ? normalized : "-";
}

function buildDeterministicOfferText(input: {
  projectName: string;
  location: string;
  customerName: string;
  durationMonths: number;
}): string {
  return normalizeParagraphs(
    `Vielen Dank für Ihre Anfrage. Hiermit erhalten Sie unser Angebot für das Projekt "${input.projectName}" bei ${input.customerName}. `
    + `Der Einsatzort ist ${input.location}. Die angebotenen Leistungen werden gemäß Positionsübersicht und Summenblock abgerechnet. `
    + `Die Laufzeit beträgt ${Math.max(1, input.durationMonths)} Monat(e).`
  );
}

function sanitizeClosingBody(value: string): string {
  const normalized = sanitizeRichTextToPlainText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^mit\s+freundlichen\s+gr(ü|u)ßen\.?$/i.test(line));
  if (normalized.length === 0) {
    return "Für Rückfragen stehen wir Ihnen jederzeit gern zur Verfügung.";
  }
  return normalizeParagraphs(normalized.join("\n"));
}

async function measurePdfStage<T>(stage: string, task: () => Promise<T> | T): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await task();
    logPdfTiming(stage, Date.now() - startedAt);
    return result;
  } catch (error) {
    logPdfTiming(`${stage}:failed`, Date.now() - startedAt);
    throw error;
  }
}

function logPdfTiming(stage: string, durationMs: number): void {
  if (!PDF_DEBUG_TIMING) {
    return;
  }
  console.log(`[pdf] ${stage} ${durationMs}ms`);
}

function sanitizeAmount(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

async function resolveCustomer(
  customer: QuotePdfCustomer
): Promise<Required<Pick<QuotePdfCustomer, "name" | "address">> & Omit<QuotePdfCustomer, "name" | "address">> {
  let resolvedName = customer.name;
  let resolvedAddress = customer.address ?? "";
  let resolvedContactPerson = customer.contactPerson;
  let resolvedEmail = customer.email;
  let resolvedPhone = customer.phone;

  if (customer.customerId) {
    const customers = await localCustomerRepository.list();
    const storedCustomer = customers.find((entry) => entry.id === customer.customerId);

    if (storedCustomer) {
      resolvedName = storedCustomer.companyName || resolvedName;
      resolvedAddress = storedCustomer.billingAddress ?? storedCustomer.address ?? resolvedAddress;
      resolvedContactPerson = storedCustomer.contactName ?? resolvedContactPerson;
      resolvedEmail = storedCustomer.email ?? resolvedEmail;
      resolvedPhone = storedCustomer.phone ?? resolvedPhone;
    }
  }

  if (resolvedAddress.trim().length === 0) {
    resolvedAddress = "Keine Rechnungsadresse hinterlegt";
  }

  return {
    ...customer,
    name: resolvedName,
    address: resolvedAddress,
    contactPerson: resolvedContactPerson,
    email: resolvedEmail,
    phone: resolvedPhone,
  };
}

async function resolveCompanySettings(preferredSignerName?: string): Promise<CompanyBranding> {
  try {
    const settings = await companySettingsRepository.get();
    if (!settings) {
      return {
        companyName: "",
        currency: "EUR",
        signatureName: preferredSignerName?.trim() || undefined,
      };
    }

    const signatureName = preferredSignerName?.trim() || await resolveCurrentUserSignatureName(settings);

    return {
      companyName: settings.companyName,
      logoUrl: settings.logoUrl,
      letterhead: settings.letterhead,
      footer: settings.footer,
      contactLine: [settings.address, settings.contactPerson, settings.email, settings.phone, settings.website]
        .filter(Boolean)
        .join(" | "),
      paymentTerms: settings.paymentTerms,
      legalTermsText: settings.legalTermsText,
      currency: settings.currency || "EUR",
      introText: settings.introText,
      closingText: settings.closingText,
      address: settings.address,
      contactPerson: settings.contactPerson,
      email: settings.email,
      phone: settings.phone,
      website: settings.website,
      primaryColor: settings.primaryColor,
      secondaryColor: settings.secondaryColor,
      signatureName,
    };
  } catch {
    return {
      companyName: "",
      currency: "EUR",
      signatureName: preferredSignerName?.trim() || undefined,
    };
  }
}

async function resolveCurrentUserSignatureName(settings: Awaited<ReturnType<typeof companySettingsRepository.get>>): Promise<string | undefined> {
  try {
    const supabase = getSupabaseClient();
    const [{ data: userResult }, tenantContext] = await Promise.all([
      getSupabaseUserSafe(supabase),
      tryResolveTenantContext(supabase),
    ]);

    const user = userResult.user;
    if (user?.id && tenantContext?.tenantId) {
      const { data: tenantUser } = await supabase
        .from("tenant_users")
        .select("full_name")
        .eq("tenant_id", tenantContext.tenantId)
        .eq("auth_user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      const fullName = normalizePersonName((tenantUser as { full_name?: string | null } | null)?.full_name);
      if (fullName) {
        return fullName;
      }
    }

    const metadataName = resolveAuthMetadataName(user?.user_metadata as Record<string, unknown> | undefined);
    if (metadataName) {
      return metadataName;
    }
  } catch {
    // fallback below
  }

  return normalizePersonName(settings?.contactPerson) || normalizePersonName(settings?.companyName) || undefined;
}

function resolveAuthMetadataName(metadata?: Record<string, unknown>): string | null {
  if (!metadata) {
    return null;
  }

  const candidates = [metadata.full_name, metadata.name, metadata.display_name];
  for (const candidate of candidates) {
    const normalized = normalizePersonName(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizePersonName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildSenderLines(company: CompanyBranding): string[] {
  return [
    company.address,
    company.contactPerson ? `Ansprechpartner: ${company.contactPerson}` : null,
    company.email ? `E-Mail: ${company.email}` : null,
    company.phone ? `Telefon: ${company.phone}` : null,
    company.website ? `Web: ${company.website}` : null,
  ].filter(Boolean) as string[];
}

async function embedImage(
  pdf: PDFDocument,
  source: string
): Promise<{ ref: PDFImage; width: number; height: number } | null> {
  try {
    if (source.startsWith("data:")) {
      const { mime, bytes } = decodeDataUrl(source);
      if (mime.includes("png")) {
        const image = await pdf.embedPng(bytes);
        return { ref: image, width: image.width, height: image.height };
      }

      if (mime.includes("jpeg") || mime.includes("jpg")) {
        const image = await pdf.embedJpg(bytes);
        return { ref: image, width: image.width, height: image.height };
      }

      return null;
    }

    const response = await fetch(source);
    if (!response.ok) {
      return null;
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const bytes = new Uint8Array(await response.arrayBuffer());

    if (contentType.includes("png") || source.toLowerCase().endsWith(".png")) {
      const image = await pdf.embedPng(bytes);
      return { ref: image, width: image.width, height: image.height };
    }

    if (
      contentType.includes("jpeg") ||
      contentType.includes("jpg") ||
      source.toLowerCase().endsWith(".jpg") ||
      source.toLowerCase().endsWith(".jpeg")
    ) {
      const image = await pdf.embedJpg(bytes);
      return { ref: image, width: image.width, height: image.height };
    }

    return null;
  } catch {
    return null;
  }
}

function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const [header, encoded] = dataUrl.split(",");
  if (!header || !encoded) {
    throw new Error("Invalid data URL");
  }

  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch?.[1] ?? "application/octet-stream";
  const raw = atob(encoded);
  const bytes = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }

  return { mime, bytes };
}

async function loadPdfFontResource(publicRelativePath: string): Promise<Uint8Array> {
  const cached = PDF_FONT_CACHE.get(publicRelativePath);
  if (cached) {
    return cached;
  }

  const loaderPromise = loadPdfFontResourceUncached(publicRelativePath);
  PDF_FONT_CACHE.set(publicRelativePath, loaderPromise);
  return loaderPromise;
}

async function loadPdfFontResourceUncached(publicRelativePath: string): Promise<Uint8Array> {
  const normalizedPath = publicRelativePath.replace(/^\/+/, "");

  if (typeof window === "undefined") {
    const [{ readFile }, nodePath] = await Promise.all([import("node:fs/promises"), import("node:path")]);
    const absolutePath = nodePath.join(process.cwd(), "public", ...normalizedPath.split("/"));

    try {
      return new Uint8Array(await readFile(absolutePath));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[PDF] Font file could not be read from filesystem.", {
        requestedPath: publicRelativePath,
        absolutePath,
        error: message,
      });
      throw new Error(`Font file missing or unreadable: ${absolutePath}`);
    }
  }

  const browserPath = `/${normalizedPath}`;
  const response = await fetch(browserPath);
  if (!response.ok) {
    console.error("[PDF] Font file could not be fetched in browser runtime.", {
      requestedPath: publicRelativePath,
      browserPath,
      status: response.status,
    });
    throw new Error(`Font file fetch failed: ${browserPath} (${response.status})`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

function parseHexColor(value: string | undefined, fallback: ReturnType<typeof rgb>) {
  if (!value || !/^#([0-9a-f]{6})$/i.test(value)) {
    return fallback;
  }

  const normalized = value.slice(1);
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  return rgb(red, green, blue);
}
