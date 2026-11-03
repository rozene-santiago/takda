// Render the print sheets built by print.ts into a PDF (8.5x11 portrait,
// one sheet per page) and offer it as a download. Used where the browser's
// print dialog isn't available (the Claude artifact viewer).
//
// It reads the same HTML that would be sent to the printer, so the two stay
// in step: template background, heading/sub-line, vertical offset, row
// height, time style, subject colours, break rows and blocked times. Measurements mirror
// PRINT_CSS in print.ts (CSS px at 96/in, converted to PDF points).
import { jsPDF } from "jspdf";
import { saveFile, notify, hideNotice } from "./save-file";

const PX = 0.75; // 1 CSS px in PDF points
const PAGE_W = 612, PAGE_H = 792; // 8.5x11in
const SIDE = 72; // .page padding: 0 1in
const CONTENT_W = PAGE_W - SIDE * 2;
const TIME_COL = 74 * PX;
const BORDER = 1 * PX;
// Arial / Liberation Sans vertical metrics (em units), for placing baselines in line boxes.
const ASC = 0.905, DESC = 0.212;

type Rgb = [number, number, number];
function hexRgb(hex: string | null | undefined, fallback: Rgb = [255, 255, 255]): Rgb {
  const m = /#([0-9a-f]{6})\b/i.exec(hex ?? "");
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------- fonts ----------
// Liberation Sans ships with the app (pdf.js standard fonts) and covers far
// more characters than the PDF base fonts (ñ, accents, symbols...).
let FONT = "helvetica";
let fontData: Promise<Record<string, string> | null> | null = null;
function loadFonts(): Promise<Record<string, string> | null> {
  fontData ??= (async () => {
    const base = import.meta.env.BASE_URL + "pdfjs/standard_fonts/";
    const files = { normal: "LiberationSans-Regular.ttf", bold: "LiberationSans-Bold.ttf", italic: "LiberationSans-Italic.ttf" };
    try {
      const out: Record<string, string> = {};
      for (const [style, file] of Object.entries(files)) {
        const res = await fetch(base + file);
        if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        let s = "";
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        out[style] = btoa(s);
      }
      return out;
    } catch (e) {
      console.warn("[print] falling back to built-in PDF fonts", e);
      return null;
    }
  })();
  return fontData;
}

function installFonts(doc: jsPDF, data: Record<string, string> | null) {
  if (!data) { FONT = "helvetica"; return; }
  for (const [style, b64] of Object.entries(data)) {
    const vfsName = `LiberationSans-${style}.ttf`;
    doc.addFileToVFS(vfsName, b64);
    doc.addFont(vfsName, "LiberationSans", style, undefined, "Identity-H");
  }
  FONT = "LiberationSans";
}

// ---------- template image ----------
async function templateForPdf(uri: string): Promise<{ data: string; fmt: "PNG" | "JPEG" }> {
  if (/^data:image\/png/i.test(uri)) return { data: uri, fmt: "PNG" };
  if (/^data:image\/jpe?g/i.test(uri)) return { data: uri, fmt: "JPEG" };
  // Anything else (webp, svg...): flatten through a canvas.
  const img = new Image();
  img.src = uri;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || 2550;
  c.height = img.naturalHeight || 3300;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { data: c.toDataURL("image/jpeg", 0.92), fmt: "JPEG" };
}

// ---------- text helpers ----------
interface Run { text: string; style: "normal" | "bold" | "italic"; size: number; lh: number; color: Rgb; charSpace?: number; nowrap?: boolean }
interface Laid { lines: string[]; run: Run }

function layRuns(doc: jsPDF, runs: Run[], width: number): Laid[] {
  return runs.filter((r) => r.text.trim() !== "").map((run) => {
    doc.setFont(FONT, run.style);
    doc.setFontSize(run.size);
    const lines = run.nowrap ? [run.text] : (doc.splitTextToSize(run.text, Math.max(4, width)) as string[]);
    return { lines, run };
  });
}
const laidHeight = (laid: Laid[]) => laid.reduce((h, l) => h + l.lines.length * l.run.lh, 0);

function textWidth(doc: jsPDF, s: string, run: Run) {
  return doc.getTextWidth(s) + (run.charSpace ?? 0) * Math.max(0, s.length - 1);
}

/** Draw laid-out runs in a box starting at `top`, aligned left/center inside [x, x+w]. */
function drawLaid(doc: jsPDF, laid: Laid[], x: number, w: number, top: number, align: "left" | "center") {
  let y = top;
  for (const { lines, run } of laid) {
    doc.setFont(FONT, run.style);
    doc.setFontSize(run.size);
    doc.setTextColor(...run.color);
    for (const line of lines) {
      const base = y + (run.lh - (ASC + DESC) * run.size) / 2 + ASC * run.size;
      const tx = align === "center" ? x + (w - textWidth(doc, line, run)) / 2 : x;
      doc.text(line, tx, base, run.charSpace ? { charSpace: run.charSpace } : undefined);
      y += run.lh;
    }
  }
}

const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

// ---------- one table cell ----------
interface CellPlan {
  fill: Rgb | null;
  fillOpacity?: number;
  laid: Laid[];
  padX: number;
  padY: number;
  valign: "top" | "middle";
  align: "left" | "center";
}

function planCell(doc: jsPDF, td: Element, width: number): CellPlan {
  const cls = td.classList;
  if (cls.contains("time")) {
    if (cls.contains("emph")) {
      const padX = 2 * PX;
      return {
        fill: hexRgb("#f3f6f4"), padX, padY: 8 * PX, valign: "middle", align: "center",
        laid: layRuns(doc, [{ text: txt(td.querySelector(".rng-big")), style: "bold", size: 11 * PX, lh: 11 * PX * 1.2, color: hexRgb("#1A1A1A"), charSpace: 0.01 * 11 * PX, nowrap: true }], width - padX * 2),
      };
    }
    const padX = 4 * PX;
    return {
      fill: hexRgb("#f3f6f4"), padX, padY: 8 * PX, valign: "middle", align: "left",
      laid: layRuns(doc, [
        { text: txt(td.querySelector(".lbl")), style: "bold", size: 10 * PX, lh: 10 * PX * 1.2, color: hexRgb("#1A1A1A") },
        { text: txt(td.querySelector(".rng")), style: "normal", size: 8 * PX, lh: 8 * PX * 1.2, color: hexRgb("#666666") },
      ], width - padX * 2),
    };
  }
  if (cls.contains("brk")) {
    return {
      fill: hexRgb("#eef0ee"), padX: 0, padY: 0, valign: "middle", align: "center",
      laid: layRuns(doc, [{ text: txt(td), style: "italic", size: 9 * PX, lh: 9 * PX * 1.2, color: hexRgb("#888888") }], width - 2),
    };
  }
  if (cls.contains("blk")) {
    const padX = 4 * PX;
    return {
      fill: hexRgb("#f1ede3"), padX, padY: 6 * PX, valign: "middle", align: "center",
      laid: layRuns(doc, [{ text: txt(td), style: "bold", size: 9 * PX, lh: 9 * PX * 1.2, color: hexRgb("#4a4536") }], width - padX * 2),
    };
  }
  if (cls.contains("na")) {
    return {
      fill: hexRgb("#e4e6e3"), padX: 0, padY: 0, valign: "middle", align: "center",
      laid: layRuns(doc, [{ text: txt(td), style: "italic", size: 8 * PX, lh: 8 * PX * 1.2, color: hexRgb("#888888") }], width - 2),
    };
  }
  if (cls.contains("cell")) {
    const padX = 5 * PX;
    const style = td.getAttribute("style") ?? "";
    const bg = /background:\s*(#[0-9a-f]{6})/i.exec(style)?.[1];
    const runs: Run[] = [{ text: txt(td.querySelector(".subj")), style: "bold", size: 10 * PX, lh: 10 * PX * 1.15, color: hexRgb("#1A1A1A") }];
    td.querySelectorAll(".meta").forEach((m) => runs.push({ text: txt(m), style: "normal", size: 8 * PX, lh: 8 * PX * 1.2, color: hexRgb("#2b2b2b") }));
    return { fill: hexRgb(bg, [229, 231, 235]), padX, padY: 7 * PX, valign: "top", align: "left", laid: layRuns(doc, runs, width - padX * 2) };
  }
  // empty
  return { fill: [255, 255, 255], fillOpacity: 0.92, padX: 0, padY: 0, valign: "top", align: "left", laid: [] };
}

// ---------- one sheet ----------
function drawTable(doc: jsPDF, table: Element, top: number, minRow: number) {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (!rows.length) return;
  const header = rows[0];
  const nDays = Math.max(1, header.querySelectorAll("th").length - 1);
  const dayW = (CONTENT_W - TIME_COL) / nDays;
  const colX = (i: number) => SIDE + (i === 0 ? 0 : TIME_COL + (i - 1) * dayW);
  const colW = (i: number) => (i === 0 ? TIME_COL : dayW);
  let y = top;

  // Header row
  {
    const ths = Array.from(header.querySelectorAll("th"));
    const plans = ths.map((th, i) => layRuns(doc, [{ text: txt(th).toUpperCase(), style: "bold", size: 10 * PX, lh: 10 * PX * 1.2, color: [255, 255, 255], charSpace: 0.03 * 10 * PX }], colW(i) - 8 * PX));
    const h = Math.max(...plans.map((p) => laidHeight(p))) + 12 * PX;
    ths.forEach((_, i) => {
      doc.setFillColor(...hexRgb("#007041"));
      doc.rect(colX(i), y, colW(i), h, "F");
      drawLaid(doc, plans[i], colX(i) + 4 * PX, colW(i) - 8 * PX, y + (h - laidHeight(plans[i])) / 2, "center");
    });
    ths.forEach((_, i) => { doc.setDrawColor(0); doc.setLineWidth(BORDER); doc.rect(colX(i), y, colW(i), h, "S"); });
    y += h;
  }

  // Body rows
  for (const tr of rows.slice(1)) {
    const tds = Array.from(tr.children).filter((c) => c.tagName === "TD");
    const plans = tds.map((td, i) => planCell(doc, td, colW(i)));
    const h = Math.max(minRow, ...plans.map((p) => laidHeight(p.laid) + p.padY * 2));
    plans.forEach((p, i) => {
      if (p.fill) {
        if (p.fillOpacity != null && p.fillOpacity < 1) {
          doc.saveGraphicsState();
          doc.setGState(new (doc as any).GState({ opacity: p.fillOpacity }));
          doc.setFillColor(...p.fill);
          doc.rect(colX(i), y, colW(i), h, "F");
          doc.restoreGraphicsState();
        } else {
          doc.setFillColor(...p.fill);
          doc.rect(colX(i), y, colW(i), h, "F");
        }
      }
      const contentH = laidHeight(p.laid);
      const ty = p.valign === "middle" ? y + (h - contentH) / 2 : y + p.padY;
      drawLaid(doc, p.laid, colX(i) + p.padX, colW(i) - p.padX * 2, ty, p.align);
    });
    doc.setDrawColor(0);
    doc.setLineWidth(BORDER);
    plans.forEach((_, i) => doc.rect(colX(i), y, colW(i), h, "S"));
    y += h;
    if (y > PAGE_H) break; // the printed sheet clips here too
  }
}

function drawTitle(doc: jsPDF, block: Element | null, top: number): number {
  if (!block) return top;
  let y = top;
  const head = block.querySelector(".phead");
  if (head) {
    const run: Run = { text: "", style: "bold", size: 15 * PX, lh: 15 * PX * 1.25, color: hexRgb("#1e3d32"), charSpace: 0.02 * 15 * PX };
    // white-space: pre-line keeps the user's line breaks
    const lines = (head.textContent ?? "").split(/\n/).map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
    const laid = lines.flatMap((l) => layRuns(doc, [{ ...run, text: l }], CONTENT_W));
    drawLaid(doc, laid, SIDE, CONTENT_W, y, "center");
    y += laidHeight(laid);
  }
  const sub = block.querySelector(".psub");
  if (sub) {
    if (head) y += 2 * PX;
    const laid = layRuns(doc, [{ text: txt(sub).toUpperCase(), style: "bold", size: 12 * PX, lh: 12 * PX * 1.2, color: hexRgb("#007041"), charSpace: 0.03 * 12 * PX }], CONTENT_W);
    drawLaid(doc, laid, SIDE, CONTENT_W, y, "center");
    y += laidHeight(laid);
  }
  return y + 10 * PX;
}

/** Build the PDF for the given print HTML and hand it to the viewer. */
export async function printHtmlToPdf(title: string, bodyHtml: string, rowHeight?: number | null) {
  const blob = await htmlToPdfBlob(title, bodyHtml, rowHeight);
  if (!blob) { notify("There is nothing to print yet.", "error"); return; }
  hideNotice();
  await saveFile(pdfName(title), blob);
}

export const pdfName = (title: string) => `${title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Schedule"}.pdf`;

/** Render print HTML (one or more .page sheets) to a PDF file. */
export async function htmlToPdfBlob(title: string, bodyHtml: string, rowHeight?: number | null): Promise<Blob | null> {
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${bodyHtml}</body>`, "text/html");
  const pages = Array.from(parsed.querySelectorAll(".page"));
  if (!pages.length) return null;

  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait", compress: true });
  installFonts(doc, await loadFonts());
  doc.setProperties({ title, creator: "DLSU-D TAKDÁ" });

  const minRow = (typeof rowHeight === "number" && rowHeight > 0 ? Math.round(rowHeight) : 34) * PX;
  const tplCache = new Map<string, { data: string; fmt: "PNG" | "JPEG" }>();

  for (let p = 0; p < pages.length; p++) {
    if (p > 0) doc.addPage("letter", "portrait");
    const page = pages[p];
    const style = page.getAttribute("style") ?? "";
    const tplUri = /background-image:\s*url\('([^']+)'\)/i.exec(style)?.[1];
    if (tplUri) {
      let tpl = tplCache.get(tplUri);
      if (!tpl) { tpl = await templateForPdf(tplUri); tplCache.set(tplUri, tpl); }
      // Same alias on every page, so the image is embedded once.
      doc.addImage(tpl.data, tpl.fmt, 0, 0, PAGE_W, PAGE_H, "print-template", "FAST");
    }
    const wrap = page.querySelector(".sched-wrap");
    const off = parseFloat(/margin-top:\s*(-?[\d.]+)in/i.exec(wrap?.getAttribute("style") ?? "")?.[1] ?? "0") || 0;
    const y = drawTitle(doc, page.querySelector(".ptitle"), off * 72);
    const table = page.querySelector("table.grid");
    if (table) drawTable(doc, table, y, minRow);
  }

  return doc.output("blob");
}
