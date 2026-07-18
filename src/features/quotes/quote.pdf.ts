import { jsPDF } from "jspdf";
import type { BusinessSettings } from "../settings/settings.types";
import type { Quote } from "./quote.types";

const PAGE_WIDTH = 210;
const MARGIN = 18;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_START = 276;

export async function generateQuotePdf(
  quote: Quote,
  settings: BusinessSettings,
): Promise<Uint8Array> {
  const document = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const money = createMoneyFormatter(quote.currency);
  const logo = await prepareLogo(settings);
  let y = 18;

  if (quote.status === "draft") {
    document.setTextColor(235, 237, 241);
    document.setFont("helvetica", "bold");
    document.setFontSize(36);
    document.text("BORRADOR", 105, 154, { align: "center", angle: 35 });
  }

  if (logo) {
    const maxWidth = 42;
    const maxHeight = 24;
    const ratio = Math.min(maxWidth / logo.width, maxHeight / logo.height);
    document.addImage(
      logo.dataUrl,
      "PNG",
      MARGIN,
      y,
      logo.width * ratio,
      logo.height * ratio,
      undefined,
      "FAST",
    );
  }

  document.setTextColor(24, 38, 64);
  document.setFont("helvetica", "bold");
  document.setFontSize(20);
  document.text(safeText(quote.businessName), MARGIN, logo ? y + 31 : y + 6);

  document.setFontSize(22);
  document.text("COTIZACIÓN", PAGE_WIDTH - MARGIN, y + 5, { align: "right" });
  document.setFontSize(10);
  document.setTextColor(93, 105, 127);
  document.text(quote.quoteNumber, PAGE_WIDTH - MARGIN, y + 12, { align: "right" });
  document.text(`Emisión: ${formatDate(quote.issueDate)}`, PAGE_WIDTH - MARGIN, y + 19, {
    align: "right",
  });
  document.text(`Válida hasta: ${formatDate(quote.validUntil)}`, PAGE_WIDTH - MARGIN, y + 25, {
    align: "right",
  });

  y = logo ? 57 : 49;
  document.setDrawColor(224, 229, 238);
  document.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 10;

  document.setFont("helvetica", "bold");
  document.setFontSize(9);
  document.setTextColor(101, 115, 144);
  document.text("COTIZAR A", MARGIN, y);
  y += 6;
  document.setFontSize(12);
  document.setTextColor(24, 38, 64);
  document.text(safeText(quote.clientName), MARGIN, y);
  y += 5;
  document.setFont("helvetica", "normal");
  document.setFontSize(9);
  document.setTextColor(75, 88, 113);

  const clientLines = [
    quote.clientIdentification ? `Identificación: ${quote.clientIdentification}` : null,
    quote.clientEmail,
    quote.clientPhone,
    quote.clientAddress,
  ].filter((value): value is string => Boolean(value));

  for (const line of clientLines) {
    const lines = document.splitTextToSize(safeText(line), 95) as string[];
    document.text(lines, MARGIN, y);
    y += lines.length * 4.2;
  }

  y = Math.max(y + 7, 92);
  drawItemsHeader(document, y);
  y += 9;

  quote.items.forEach((item, index) => {
    const descriptionLines = document.splitTextToSize(safeText(item.description), 82) as string[];
    const rowHeight = Math.max(9, descriptionLines.length * 4.2 + 4);

    if (y + rowHeight > FOOTER_START - 15) {
      document.addPage();
      y = 20;
      drawItemsHeader(document, y);
      y += 9;
    }

    if (index % 2 === 1) {
      document.setFillColor(247, 248, 250);
      document.rect(MARGIN, y - 4, CONTENT_WIDTH, rowHeight, "F");
    }

    document.setFont("helvetica", "normal");
    document.setFontSize(8.7);
    document.setTextColor(55, 66, 86);
    document.text(descriptionLines, MARGIN + 3, y + 1);
    document.text(formatQuantity(item.quantityMillis), 116, y + 1, { align: "right" });
    document.text(safeText(item.unit), 137, y + 1, { align: "center" });
    document.text(money.format(item.unitPriceMinor / 100), 166, y + 1, { align: "right" });
    document.text(money.format(item.totalMinor / 100), PAGE_WIDTH - MARGIN - 3, y + 1, {
      align: "right",
    });
    y += rowHeight;
  });

  y += 7;
  const totalsHeight = quote.discountMinor > 0 ? 35 : 29;
  if (y + totalsHeight > FOOTER_START - 12) {
    document.addPage();
    y = 24;
  }

  const totalsX = 122;
  drawTotalLine(document, "Subtotal", money.format(quote.subtotalMinor / 100), totalsX, y);
  y += 7;
  if (quote.discountMinor > 0) {
    drawTotalLine(
      document,
      `Descuento (${formatBasisPoints(quote.discountBasisPoints)})`,
      `-${money.format(quote.discountMinor / 100)}`,
      totalsX,
      y,
    );
    y += 7;
  }
  drawTotalLine(
    document,
    `Impuesto (${formatBasisPoints(quote.taxBasisPoints)})`,
    money.format(quote.taxMinor / 100),
    totalsX,
    y,
  );
  y += 9;
  document.setFillColor(24, 38, 64);
  document.roundedRect(totalsX, y - 5, PAGE_WIDTH - MARGIN - totalsX, 13, 1.5, 1.5, "F");
  document.setTextColor(255, 255, 255);
  document.setFont("helvetica", "bold");
  document.setFontSize(10);
  document.text("TOTAL", totalsX + 4, y + 3);
  document.text(money.format(quote.totalMinor / 100), PAGE_WIDTH - MARGIN - 4, y + 3, {
    align: "right",
  });
  y += 19;

  if (quote.notes || quote.terms) {
    const blocks = [
      quote.notes ? { title: "Notas", text: quote.notes } : null,
      quote.terms ? { title: "Condiciones", text: quote.terms } : null,
    ].filter((block): block is { title: string; text: string } => Boolean(block));

    for (const block of blocks) {
      const lines = document.splitTextToSize(safeText(block.text), CONTENT_WIDTH) as string[];
      const blockHeight = 9 + lines.length * 4.2;
      if (y + blockHeight > FOOTER_START - 8) {
        document.addPage();
        y = 22;
      }
      document.setFont("helvetica", "bold");
      document.setFontSize(9);
      document.setTextColor(24, 38, 64);
      document.text(block.title.toUpperCase(), MARGIN, y);
      y += 6;
      document.setFont("helvetica", "normal");
      document.setTextColor(76, 88, 110);
      document.text(lines, MARGIN, y);
      y += lines.length * 4.2 + 8;
    }
  }

  addFooters(document, quote);
  return new Uint8Array(document.output("arraybuffer"));
}

export function quotePdfFileName(quote: Quote): string {
  const client = quote.clientName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${quote.quoteNumber}-${client || "Cliente"}.pdf`;
}

function drawItemsHeader(document: jsPDF, y: number) {
  document.setFillColor(24, 38, 64);
  document.rect(MARGIN, y - 5, CONTENT_WIDTH, 9, "F");
  document.setFont("helvetica", "bold");
  document.setFontSize(8);
  document.setTextColor(255, 255, 255);
  document.text("DESCRIPCIÓN", MARGIN + 3, y + 1);
  document.text("CANT.", 116, y + 1, { align: "right" });
  document.text("UNIDAD", 137, y + 1, { align: "center" });
  document.text("PRECIO", 166, y + 1, { align: "right" });
  document.text("TOTAL", PAGE_WIDTH - MARGIN - 3, y + 1, { align: "right" });
}

function drawTotalLine(document: jsPDF, label: string, value: string, x: number, y: number) {
  document.setFont("helvetica", "normal");
  document.setFontSize(8.5);
  document.setTextColor(70, 81, 103);
  document.text(label, x, y);
  document.setFont("helvetica", "bold");
  document.text(value, PAGE_WIDTH - MARGIN, y, { align: "right" });
}

function addFooters(document: jsPDF, quote: Quote) {
  const pageCount = document.getNumberOfPages();
  const contact = [quote.businessPhone, quote.businessEmail, quote.businessAddress]
    .filter(Boolean)
    .join("  •  ");

  for (let page = 1; page <= pageCount; page += 1) {
    document.setPage(page);
    document.setDrawColor(224, 229, 238);
    document.line(MARGIN, FOOTER_START, PAGE_WIDTH - MARGIN, FOOTER_START);
    document.setFont("helvetica", "normal");
    document.setFontSize(7.5);
    document.setTextColor(105, 116, 137);
    if (contact) {
      const contactLine = (document.splitTextToSize(safeText(contact), 125) as string[])[0];
      document.text(contactLine, MARGIN, FOOTER_START + 7);
    }
    document.text(`Página ${page} de ${pageCount}`, PAGE_WIDTH - MARGIN, FOOTER_START + 7, {
      align: "right",
    });
    if (quote.businessIdentification) {
      document.text(
        `Identificación: ${safeText(quote.businessIdentification)}`,
        MARGIN,
        FOOTER_START + 12,
      );
    }
  }
}

async function prepareLogo(settings: BusinessSettings) {
  if (!settings.logoData || !settings.logoMimeType) return null;
  const source = bytesToDataUrl(settings.logoData, settings.logoMimeType);
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo preparar el logo para el PDF."));
    image.src = source;
  });
}

function bytesToDataUrl(data: number[], mimeType: string): string {
  let binary = "";
  const bytes = new Uint8Array(data);
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function createMoneyFormatter(currency: string): { format: (value: number) => string } {
  const formatter = new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "CRC" ? 0 : 2,
    maximumFractionDigits: currency === "CRC" ? 0 : 2,
  });

  return {
    format: (value) => {
      const formatted = formatter.format(value);
      return currency === "CRC" ? formatted.replace("₡", "CRC ") : formatted;
    },
  };
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatQuantity(quantityMillis: number): string {
  return new Intl.NumberFormat("es-CR", { maximumFractionDigits: 3 }).format(
    quantityMillis / 1_000,
  );
}

function formatBasisPoints(value: number): string {
  return `${new Intl.NumberFormat("es-CR", { maximumFractionDigits: 2 }).format(value / 100)}%`;
}

function safeText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
}
