import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb } from "pdf-lib";
import type { QuoteLineItem } from "@/types";
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

interface DocumentRuntime {
  pdf: PDFDocument;
  font: PDFFont;
  fontBold: PDFFont;
  page: PDFPage;
  pageNumber: number;
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

const TABLE_COLUMNS: TableColumn[] = [
  { key: "position", title: "Pos.", width: 30 },
  { key: "label", title: "Bezeichnung", width: 205 },
  { key: "quantity", title: "Menge", width: 46, align: "right" },
  { key: "unit", title: "Einheit", width: 44 },
  { key: "unitPrice", title: "Einzelpreis", width: 82, align: "right" },
  { key: "totalPrice", title: "Gesamtpreis", width: 82, align: "right" },
];

export async function generateQuotePdf(payload: QuotePdfPayload): Promise<Uint8Array> {
  const resolvedCustomer = await resolveCustomer(payload.customer);
  const company = await resolveCompanySettings(payload.signerName);
  const totals = calculatePdfTotals(payload);

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

  drawHeader(runtime, payload, company, resolvedCustomer);
  runtime.cursorY -= 12;

  drawIntroSection(runtime, payload, company);
  runtime.cursorY -= 10;

  await drawLineItemTable(runtime, payload.lineItems, company.currency, company);
  runtime.cursorY -= 12;

  drawOnDemandServicesSection(runtime, payload.onDemandLineItems ?? [], company.currency, company);
  runtime.cursorY -= 10;

  drawTotalsSection(runtime, totals, company.currency, company);
  runtime.cursorY -= 10;

  drawAdditionalInfoSection(runtime, payload, company);
  runtime.cursorY -= 10;

  drawClosingSection(runtime, company);

  if (payload.planSnapshotDataUrl) {
    await drawAppendixPage(runtime, payload.planSnapshotDataUrl, payload.project.name, company);
  }

  return pdf.save();
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
    pageNumber: 1,
    cursorY: A4_HEIGHT - MARGIN_TOP,
  };
}

function addPage(runtime: DocumentRuntime, company: CompanyBranding): void {
  drawPageFooter(runtime.page, runtime.pageNumber, runtime.font, company);
  runtime.page = runtime.pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  runtime.pageNumber += 1;
  runtime.cursorY = A4_HEIGHT - MARGIN_TOP;
}

function ensureSpace(runtime: DocumentRuntime, requiredHeight: number, company: CompanyBranding): void {
  if (runtime.cursorY - requiredHeight < CONTENT_BOTTOM_Y) {
    addPage(runtime, company);
  }
}

async function loadFonts(pdf: PDFDocument): Promise<{ font: PDFFont; fontBold: PDFFont }> {
  const regular = await loadBinaryResource("/fonts/arial.ttf");
  const bold = await loadBinaryResource("/fonts/arial-bold.ttf");

  if (!regular || !bold) {
    throw new Error("PDF fonts could not be loaded.");
  }

  const font = await pdf.embedFont(regular, { subset: false });
  const fontBold = await pdf.embedFont(bold, { subset: false });
  return { font, fontBold };
}

function drawHeader(
  runtime: DocumentRuntime,
  payload: QuotePdfPayload,
  company: CompanyBranding,
  customer: Required<Pick<QuotePdfCustomer, "name" | "address">> & Omit<QuotePdfCustomer, "name" | "address">
): void {
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
    void drawHeaderLogo(runtime, company.logoUrl, senderX, senderY);
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

async function drawHeaderLogo(runtime: DocumentRuntime, logoUrl: string, x: number, y: number): Promise<void> {
  try {
    const logo = await embedImage(runtime.pdf, logoUrl);
    if (!logo) {
      return;
    }

    const maxWidth = 94;
    const maxHeight = 48;
    const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height, 1);

    runtime.page.drawImage(logo.ref, {
      x,
      y: y - logo.height * scale + 6,
      width: logo.width * scale,
      height: logo.height * scale,
    });
  } catch {
    // Ignore logo rendering errors and continue with text header.
  }
}

function drawIntroSection(runtime: DocumentRuntime, payload: QuotePdfPayload, company: CompanyBranding): void {
  const introText = payload.generatedText?.trim() || company.introText?.trim() || "Vielen Dank für Ihre Anfrage. Nachfolgend erhalten Sie unser Angebot.";

  const blockHeight = 140;
  ensureSpace(runtime, blockHeight, company);

  drawSectionTitle(runtime, "Einleitung", company);

  const boxX = MARGIN_LEFT;
  const boxW = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const paragraphWidth = boxW - (BLOCK_PADDING_X * 2);
  const introLines = wrapText(introText, runtime.font, 10, paragraphWidth, 5);
  const introHeight = Math.max(16, introLines.length * 12);
  const infoRowsHeight = 42;
  const boxHeight = (BLOCK_PADDING_Y * 2) + introHeight + infoRowsHeight + 6;

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
    introLines,
    boxX + BLOCK_PADDING_X,
    runtime.cursorY - BLOCK_PADDING_Y - 1,
    10,
    12,
    runtime.font,
    COLOR_TEXT
  );
  y -= 8;

  drawKeyValue(runtime.page, "Projektname", payload.project.name, boxX + BLOCK_PADDING_X, y, runtime.font, runtime.fontBold);
  y -= 14;
  drawKeyValue(runtime.page, "Einsatzort", payload.project.location, boxX + BLOCK_PADDING_X, y, runtime.font, runtime.fontBold);
  y -= 14;
  drawKeyValue(
    runtime.page,
    "Laufzeit",
    `${payload.project.durationMonths} Monat(e)`,
    boxX + BLOCK_PADDING_X,
    y,
    runtime.font,
    runtime.fontBold
  );
  runtime.cursorY -= boxHeight + 4;
}

async function drawLineItemTable(
  runtime: DocumentRuntime,
  lineItems: QuoteLineItem[],
  currency: string,
  company: CompanyBranding
): Promise<void> {
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

function drawAdditionalInfoSection(runtime: DocumentRuntime, payload: QuotePdfPayload, company: CompanyBranding): void {
  ensureSpace(runtime, 200, company);
  drawSectionTitle(runtime, "Zusatzangaben", company);

  const validUntil = payload.validUntil ? formatIsoDate(payload.validUntil) : formatIsoDate(defaultValidUntil());
  const notes = payload.notes?.trim() || payload.conceptText?.trim() || "-";

  const boxX = MARGIN_LEFT;
  const boxW = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const notesValueX = getKeyValueValueX("Hinweise", boxX + BLOCK_PADDING_X, runtime.fontBold, 10);
  const noteLines = wrapText(notes, runtime.font, 10, boxX + boxW - BLOCK_PADDING_X - notesValueX, 4);
  const infoHeight = 26;
  const notesHeight = Math.max(18, noteLines.length * 12);
  const legalTerms = company.legalTermsText?.trim() ?? "";
  const legalLines = legalTerms.length > 0
    ? wrapText(legalTerms, runtime.font, 9, boxW - (BLOCK_PADDING_X * 2), 8)
    : [];
  const legalHeight = legalLines.length > 0 ? legalLines.length * 11 + 18 : 0;
  const boxHeight = (BLOCK_PADDING_Y * 2) + infoHeight + 12 + notesHeight + legalHeight;

  runtime.page.drawRectangle({
    x: boxX,
    y: runtime.cursorY - boxHeight,
    width: boxW,
    height: boxHeight,
    color: rgb(0.99, 0.992, 0.996),
    borderColor: COLOR_LINE,
    borderWidth: 1,
  });

  let y = runtime.cursorY - BLOCK_PADDING_Y - 1;
  drawKeyValue(
    runtime.page,
    "Zahlungsbedingungen",
    company.paymentTerms || "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
    boxX + BLOCK_PADDING_X,
    y,
    runtime.font,
    runtime.fontBold
  );
  y -= 14;
  drawKeyValue(
    runtime.page,
    "Angebotsgültigkeit",
    validUntil,
    boxX + BLOCK_PADDING_X,
    y,
    runtime.font,
    runtime.fontBold
  );
  y -= 16;

  drawText(runtime.page, "Hinweise:", boxX + BLOCK_PADDING_X, y, 10, runtime.fontBold);
  y = drawLines(runtime.page, noteLines, notesValueX, y, 10, 12, runtime.font, COLOR_TEXT);

  if (legalLines.length > 0) {
    y -= 10;
    drawText(runtime.page, "AGB / Vertragsbedingungen / Datenschutz:", boxX + BLOCK_PADDING_X, y, 9, runtime.fontBold, COLOR_MUTED);
    drawLines(runtime.page, legalLines, boxX + BLOCK_PADDING_X, y - 12, 9, 11, runtime.font, COLOR_MUTED);
  }

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

function drawClosingSection(runtime: DocumentRuntime, company: CompanyBranding): void {
  ensureSpace(runtime, 120, company);
  drawSectionTitle(runtime, "Abschluss", company);

  const closingText = company.closingText?.trim() || "Für Rückfragen stehen wir Ihnen jederzeit gern zur Verfügung.";
  const signerName = company.signatureName?.trim() || company.contactPerson?.trim() || company.companyName || "Ihr Team";
  const boxX = MARGIN_LEFT;
  const boxW = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const lines = wrapText(closingText, runtime.font, 10, boxW - (BLOCK_PADDING_X * 2), 4);
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
  drawPageFooter(runtime.page, runtime.pageNumber, runtime.font, company);
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
    drawPageFooter(runtime.page, runtime.pageNumber, runtime.font, company);
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

  drawPageFooter(runtime.page, runtime.pageNumber, runtime.font, company);
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

function drawPageFooter(page: PDFPage, pageNumber: number, font: PDFFont, company: CompanyBranding): void {
  const footerTop = FOOTER_HEIGHT;
  const footerTextTop = footerTop + 6;

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

  drawRightAlignedText(page, `Seite ${pageNumber}`, A4_WIDTH - MARGIN_RIGHT, footerTop + 6, 8, font, COLOR_MUTED);
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
  const monthlyTotal = roundCurrency(
    payload.lineItems
      .filter((item) => item.billingMode === "recurring")
      .reduce((sum, item) => sum + sanitizeAmount(item.totalPrice), 0)
  );
  const oneTimeTotal = roundCurrency(
    payload.lineItems
      .filter((item) => item.billingMode !== "recurring")
      .reduce((sum, item) => sum + sanitizeAmount(item.totalPrice), 0)
  );
  const subtotal = roundCurrency(monthlyTotal + oneTimeTotal);
  const discountAmount = roundCurrency(Math.max(0, sanitizeAmount(payload.discountAmount)));
  const totalNet = roundCurrency(Math.max(0, subtotal - discountAmount));
  const vatRate = sanitizeAmount(payload.vatRate);
  const totalGross = roundCurrency(totalNet * (1 + vatRate));

  return {
    monthlyTotal,
    oneTimeTotal,
    subtotal,
    discountAmount,
    totalNet,
    totalGross,
    vatRate,
  };
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

async function loadBinaryResource(path: string): Promise<Uint8Array | null> {
  try {
    if (typeof window === "undefined") {
      const [{ readFile }, nodePath] = await Promise.all([import("node:fs/promises"), import("node:path")]);
      const absolutePath = nodePath.join(process.cwd(), "public", path.replace(/^\/+/, "").replace(/\//g, nodePath.sep));
      return new Uint8Array(await readFile(absolutePath));
    }

    const response = await fetch(path);
    if (!response.ok) {
      return null;
    }

    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
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
