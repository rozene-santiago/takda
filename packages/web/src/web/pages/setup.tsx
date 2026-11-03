import { useState, useRef, useEffect } from "react";
import { Layout } from "@/components/layout";
import { Page, PageHeader } from "@/components/page";
import { Card, Modal, Field, Input, Select, ColorPicker, EmptyState } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ImportButton } from "@/components/import-button";
import { Chips } from "@/components/chips";
import {
  useGradeLevels, useSections, useSubjects, useRooms, useTimeSlots, useBlockedTimes, useSettings, useTeachers, useCrud, useUpdateSettings,
  useAllocations, useTeachingLoads, useTerms, useAccounts, useAudit, useAct, useLocked, useEntries,
} from "@/lib/hooks";
import { api, request, HOSTED } from "@/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DAY_SHORT, DAY_FULL } from "@/lib/types";
import type { Account, Term } from "@/lib/types";
import { useSavePoints, useCreateSavePoint, useRestoreSavePoint, useDeleteSavePoint } from "@/lib/hooks";
import { Layers, GraduationCap, BookOpen, DoorOpen, Clock, Ban, Plus, Pencil, Trash2, Coffee, Upload, GripVertical, FileText, Printer, Save, History, RotateCcw, CalendarRange, UserCog, ScrollText, FileSpreadsheet, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/lib/confirm";
import { inClaudeViewer, notify } from "@/lib/save-file";
import { takeSetupTab } from "@/lib/nav";
import { useAccess, viewerNames } from "@/lib/access";
import { sortSlots, toMinutes } from "@/lib/sched";
import { exportSetupWorkbook } from "@/lib/excel-export";

const TAB_GROUPS = [
  { title: "School", tabs: [
    { key: "grades", label: "Grade Levels", icon: Layers },
    { key: "sections", label: "Sections", icon: GraduationCap },
    { key: "subjects", label: "Subjects", icon: BookOpen },
    { key: "rooms", label: "Rooms", icon: DoorOpen },
  ] },
  { title: "Schedule", tabs: [
    { key: "slots", label: "Time Slots", icon: Clock },
    { key: "blocked", label: "Blocked Times", icon: Ban },
    { key: "terms", label: "School Years", icon: CalendarRange },
  ] },
  { title: "System", tabs: [
    { key: "template", label: "Print Template", icon: Printer },
    { key: "savepoints", label: "Save Points", icon: History },
    { key: "accounts", label: "Accounts", icon: UserCog },
    { key: "activity", label: "Activity Log", icon: ScrollText },
  ] },
] as const;
type TabKey = typeof TAB_GROUPS[number]["tabs"][number]["key"];

export default function SetupPage() {
  const access = useAccess();
  const locked = useLocked();
  const [tab, setTab] = useState<TabKey>(() => (takeSetupTab() as TabKey | null) ?? "grades");
  const groups = TAB_GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter((t) => t.key !== "accounts" || (access.mode === "server" && access.isAdmin)) }));
  const current = groups.flatMap((g) => g.tabs).find((t) => t.key === tab);
  const grades = useGradeLevels(), sections = useSections(), subjects = useSubjects(), teachers = useTeachers(), rooms = useRooms(), slots = useTimeSlots(), allocations = useAllocations(), loads = useTeachingLoads();
  const exportSetup = () => exportSetupWorkbook({
    grades: grades.data ?? [], sections: sections.data ?? [], subjects: subjects.data ?? [], teachers: teachers.data ?? [], rooms: rooms.data ?? [],
    slots: slots.data ?? [], allocations: allocations.data ?? [], loads: loads.data ?? [],
  });
  return (
    <Layout>
      <Page>
        <PageHeader title="Setup" subtitle="Build the foundations of your timetable."
          tools={[{ key: "export", label: "Export setup", icon: <FileSpreadsheet className="size-4" />, title: "Every list as a sheet; columns match the imports", onSelect: exportSetup }]} />
        <div className="flex gap-5 xl:gap-6 items-start">
          <nav aria-label="Setup sections" className={cn("hidden lg:block w-[220px] shrink-0 sticky self-start rounded-xl border border-border bg-card shadow-sm py-2 overflow-y-auto thin-scroll", locked ? "top-14 max-h-[calc(100vh-4.5rem)]" : "top-4 max-h-[calc(100vh-2rem)]")}>
            {groups.map((g) => (
              <div key={g.title} className="py-1">
                <p className="px-4 pt-1.5 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{g.title}</p>
                {g.tabs.map(({ key, label, icon: Icon }) => (
                  <button key={key} type="button" onClick={() => setTab(key)} aria-current={tab === key ? "page" : undefined}
                    className={cn("relative w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition",
                      tab === key ? "bg-brand-sage/35 text-brand-forest font-semibold" : "text-foreground hover:bg-muted/70")}>
                    {tab === key && <span className="absolute left-0 inset-y-1 w-[3px] rounded-r bg-brand" aria-hidden />}
                    <Icon className={cn("size-4 shrink-0", tab === key ? "text-brand" : "text-muted-foreground")} /> {label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="flex-1 min-w-0 space-y-4 @container">
            <div className="lg:hidden">
              <select value={tab} onChange={(e) => setTab(e.target.value as TabKey)} aria-label="Setup section"
                className="w-full h-11 rounded-lg border border-input bg-white px-3 text-base font-semibold text-brand-forest outline-none focus:border-brand-mid">
                {groups.map((g) => <optgroup key={g.title} label={g.title}>{g.tabs.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</optgroup>)}
              </select>
            </div>
            <span className="sr-only" aria-live="polite">{current?.label}</span>
            {tab === "grades" && <GradesTab />}
            {tab === "sections" && <SectionsTab />}
            {tab === "subjects" && <SubjectsTab />}
            {tab === "rooms" && <RoomsTab />}
            {tab === "slots" && <SlotsTab />}
            {tab === "blocked" && <BlockedTab />}
            {tab === "terms" && <TermsTab />}
            {tab === "template" && <PrintTemplateTab />}
            {tab === "savepoints" && <SavePointsTab />}
            {tab === "accounts" && <AccountsTab />}
            {tab === "activity" && <ActivityTab />}
          </div>
        </div>
      </Page>
    </Layout>
  );
}

function SavePointsTab() {
  const points = useSavePoints();
  const create = useCreateSavePoint();
  const restore = useRestoreSavePoint();
  const del = useDeleteSavePoint();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");

  const fmt = (d: string | number | Date) => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  async function doRestore(id: number, label: string) {
    if (await confirm({
      title: "Restore this save point?",
      message: `This will REPLACE your entire current configuration — all grades, sections, subjects, teachers, rooms, time slots, blocked times, allocations and the schedule — with the snapshot "${label}". Your current setup will be lost unless you saved it first.`,
      confirmLabel: "Restore",
    })) {
      restore.mutate(id);
    }
  }

  async function doDelete(id: number, label: string) {
    if (await confirm({ title: "Delete save point?", message: `The save point "${label}" will be permanently removed. This cannot be undone.`, confirmLabel: "Delete" })) {
      del.mutate(id);
    }
  }

  const hasPoints = (points.data?.length ?? 0) > 0;

  return (
    <Card>
      <div className="flex flex-wrap gap-3 justify-between items-center p-4 border-b border-border">
        <h3 className="font-display font-bold text-brand-forest">Save Points</h3>
        <AddBtn onClick={() => { setName(""); setNote(""); setOpen(true); }} label="New save point" />
      </div>
      <p className="text-sm text-muted-foreground px-4 py-3 border-b border-border bg-muted/30">
        A save point is a full snapshot of your configuration and schedule. Restore any time to roll back to that exact state.
      </p>

      {points.isLoading && <p className="text-sm text-muted-foreground p-6 text-center">Loading…</p>}
      {!points.isLoading && !hasPoints && (
        <EmptyState icon={<History className="size-10" />} title="No save points yet" hint="Create one before big changes so you can roll back safely." />
      )}

      {(points.data ?? []).map((sp) => (
        <div key={sp.id} className="flex items-center gap-2 px-4 py-3 border-b border-border last:border-0 hover:bg-muted/30 transition">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-brand-forest truncate">{sp.name}</div>
            <div className="text-sm text-muted-foreground">
              {fmt(sp.createdAt)} · {sp.sectionCount} section{sp.sectionCount !== 1 && "s"} · {sp.entryCount} class{sp.entryCount !== 1 && "es"}
            </div>
            {sp.note && <div className="text-xs text-muted-foreground italic mt-0.5 truncate">{sp.note}</div>}
          </div>
          <Button variant="outline" size="sm" onClick={() => doRestore(sp.id, sp.name)} disabled={restore.isPending}>
            <RotateCcw className="size-4" /> Restore
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => doDelete(sp.id, sp.name)} disabled={del.isPending} className="text-destructive hover:text-destructive">
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}

      <Modal open={open} onClose={() => setOpen(false)} title="Create save point"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate({ name: name.trim() || undefined, note: note.trim() || null }, { onSuccess: () => setOpen(false) })}
              disabled={create.isPending} className="bg-brand text-white hover:bg-brand-mid">
              <Save className="size-4" /> {create.isPending ? "Saving…" : "Save snapshot"}
            </Button>
          </>
        }>
        <Field label="Name (optional)">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`Save ${new Date().toLocaleDateString()}`} />
        </Field>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Before rebalancing Grade 8 load" />
        </Field>
      </Modal>
    </Card>
  );
}

/** Error that knows which stage of the template pipeline failed, so the UI can say something useful. */
class TemplateError extends Error {
  constructor(public stage: "read" | "open" | "render" | "save", message: string, public detail: string) {
    super(message);
    this.name = "TemplateError";
  }
}

/** Readable text for whatever pdf.js / the browser threw. */
function causeText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

/** Load pdf.js once, wired to the Vite-bundled worker. */
let pdfjsPromise: Promise<any> | null = null;
function loadPdfjs(): Promise<any> {
  pdfjsPromise ??= (async () => {
    const pdfjs: any = await import("pdfjs-dist");
    const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    return pdfjs;
  })();
  return pdfjsPromise;
}

/**
 * Support files copied from pdfjs-dist into /public/pdfjs (cmaps, standard_fonts, wasm, iccs).
 * Without these, letterheads that use CID/CJK encodings, non-embedded standard fonts, ICC colour
 * profiles, or scanned JPEG 2000 / JBIG2 images fail to open or render at all.
 */
const PDFJS_BASE = import.meta.env.BASE_URL + "pdfjs/";

/**
 * Loads pdf.js support files on the page's side. The claude.ai artifact host
 * doesn't serve .bcmap / .pfb files, so scripts/prepare-artifact.mjs packs
 * them into pdfjs/cmaps.json and pdfjs/standard_fonts.json; this loader reads
 * those bundles and fetches anything else (or everything, on a normal server)
 * by URL.
 */
const pdfBundles = new Map<string, Promise<Record<string, string> | null>>();
function pdfBundle(name: string) {
  if (!pdfBundles.has(name)) {
    pdfBundles.set(name, fetch(PDFJS_BASE + name + ".json").then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return pdfBundles.get(name)!;
}
class PdfAssetLoader {
  urls: Record<string, string | null | undefined>;
  constructor(urls: { cMapUrl?: string | null; standardFontDataUrl?: string | null; wasmUrl?: string | null }) {
    this.urls = urls;
  }
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const base = this.urls[kind];
    if (!base) throw new Error(`Missing pdf.js option ${kind}`);
    const bundleName = kind === "cMapUrl" ? "cmaps" : kind === "standardFontDataUrl" ? "standard_fonts" : null;
    if (bundleName) {
      const b64 = (await pdfBundle(bundleName))?.[filename];
      if (b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      }
    }
    const res = await fetch(base + filename);
    if (!res.ok) throw new Error(`Unable to load ${filename} (HTTP ${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

const PDFJS_ASSETS = {
  cMapUrl: PDFJS_BASE + "cmaps/",
  cMapPacked: true,
  standardFontDataUrl: PDFJS_BASE + "standard_fonts/",
  wasmUrl: PDFJS_BASE + "wasm/",
  BinaryDataFactory: PdfAssetLoader,
  useWorkerFetch: false,
  // The CMYK colour profile is read by the pdf.js worker directly, which the
  // artifact host can't serve; without it pdf.js uses its built-in CMYK conversion.
  ...(inClaudeViewer() ? {} : { iccUrl: PDFJS_BASE + "iccs/" }),
};

/** Browsers refuse very large canvases; stay well under Chrome's ~2^28 px area limit. */
const MAX_CANVAS_PX = 250_000_000;
/** Render widths tried in order: full ~300 DPI first, then step down if the browser can't cope. */
const TARGET_WIDTHS = [2550, 1700, 1275];

/** Render page 1 of a PDF File to a lossless PNG data URI at high print resolution (8.5x11 @ ~300dpi). */
async function pdfFirstPageToDataUri(file: File): Promise<string> {
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch (e) {
    throw new TemplateError("read", "Could not read that file from your device. Save it again, then re-upload.", causeText(e));
  }
  if (buf.byteLength === 0) throw new TemplateError("read", "That file is empty (0 bytes).", "0-byte file");

  const pdfjs = await loadPdfjs().catch((e) => {
    throw new TemplateError("open", "The PDF engine could not start. Reload the page and try again.", causeText(e));
  });

  let pdf: any;
  try {
    pdf = await pdfjs.getDocument({ data: buf, ...PDFJS_ASSETS }).promise;
  } catch (e: any) {
    const name = e?.name ?? "";
    if (name === "PasswordException")
      throw new TemplateError("open", "That PDF is password-protected. Save an unlocked copy (Print to PDF works) and upload that.", causeText(e));
    if (name === "InvalidPDFException")
      throw new TemplateError("open", "That file is not a readable PDF — it may be damaged or renamed from another format. Re-export it as PDF and try again.", causeText(e));
    throw new TemplateError("open", "That PDF could not be opened. Open it, use Print to PDF to make a clean copy, then upload that.", causeText(e));
  }

  if (!pdf.numPages) throw new TemplateError("open", "That PDF has no pages.", "numPages = 0");

  const page = await pdf.getPage(1).catch((e: any) => {
    throw new TemplateError("open", "Page 1 of that PDF could not be loaded.", causeText(e));
  });

  // Scale from the page's natural size: ~300 DPI on an 8.5in-wide page => 2550px wide.
  const base = page.getViewport({ scale: 1 });
  let lastDetail = "";

  for (const targetW of TARGET_WIDTHS) {
    const viewport = page.getViewport({ scale: targetW / base.width });
    const w = Math.ceil(viewport.width), h = Math.ceil(viewport.height);
    if (w * h > MAX_CANVAS_PX) { lastDetail = `${w}x${h} canvas exceeds the browser limit`; continue; }

    let canvas: HTMLCanvasElement | null = document.createElement("canvas");
    try {
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2D canvas context unavailable");
      // PDF pages are transparent by default; flatten onto white so they don't print black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      // PNG (lossless) keeps text/lines crisp.
      const uri = canvas.toDataURL("image/png");
      if (!uri || uri.length < 64) throw new Error("canvas produced an empty image");
      return uri;
    } catch (e) {
      lastDetail = `at ${targetW}px wide — ${causeText(e)}`;
    } finally {
      if (canvas) { canvas.width = 0; canvas.height = 0; canvas = null; } // free the bitmap before retrying smaller
    }
  }

  throw new TemplateError("render", "That PDF opened, but page 1 could not be turned into an image. Try flattening it (open it, then Print to PDF) and upload the result.", lastDetail);
}

function PrintTemplateTab() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const template = settings.data?.printTemplate ?? null;

  const savedHeading = settings.data?.printHeading ?? "";
  const [heading, setHeading] = useState(savedHeading);
  const [headingDirty, setHeadingDirty] = useState(false);
  // Keep local input synced when server value loads/changes (unless user is editing).
  if (!headingDirty && heading !== savedHeading) setHeading(savedHeading);
  const saveHeading = async () => {
    await update.mutateAsync({ printHeading: heading.trim() || null });
    setHeadingDirty(false);
  };

  // Vertical print offset (inches) — nudges where the schedule table starts on the page.
  const savedOffset = settings.data?.printOffset ?? 0;
  const [offset, setOffset] = useState(savedOffset);
  const [offsetDirty, setOffsetDirty] = useState(false);
  if (!offsetDirty && offset !== savedOffset) setOffset(savedOffset);
  const saveOffset = async () => {
    await update.mutateAsync({ printOffset: offset === 0 ? null : offset });
    setOffsetDirty(false);
  };

  // Printed row height (px). Default 34. Capped 28–52 so the table still fits one page.
  const ROW_MIN = 28, ROW_MAX = 52, ROW_DEFAULT = 34;
  const savedRow = settings.data?.printRowHeight ?? ROW_DEFAULT;
  const [rowH, setRowH] = useState(savedRow);
  const [rowDirty, setRowDirty] = useState(false);
  if (!rowDirty && rowH !== savedRow) setRowH(savedRow);
  const saveRow = async () => {
    await update.mutateAsync({ printRowHeight: rowH === ROW_DEFAULT ? null : rowH });
    setRowDirty(false);
  };

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setErr("Please choose a PDF file.");
      return;
    }
    setBusy(true);
    setDetail(null);
    try {
      const dataUri = await pdfFirstPageToDataUri(file);
      try {
        await update.mutateAsync({ printTemplate: dataUri });
      } catch (e) {
        const mb = (dataUri.length / 1_400_000).toFixed(1); // base64 chars -> ~MB
        throw new TemplateError("save", `The template rendered (${mb} MB) but could not be saved. Check your connection and try again.`, causeText(e));
      }
    } catch (e) {
      if (e instanceof TemplateError) {
        setErr(e.message);
        setDetail(`[${e.stage}] ${e.detail}`);
      } else {
        setErr("Could not read that PDF. Try another file.");
        setDetail(causeText(e));
      }
      console.error(e);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onRemove = async () => {
    if (!(await confirm({ title: "Remove print template?", message: "Schedules will print plain (no background) until you upload a new one.", confirmLabel: "Remove" }))) return;
    await update.mutateAsync({ printTemplate: null });
  };

  return (
    <Card>
      <div className="flex flex-wrap gap-3 justify-between items-center p-4 border-b border-border">
        <div>
          <h3 className="font-display font-bold text-brand-forest">Print Template</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Upload a single-page PDF (8.5&times;11 in, portrait). Its first page becomes the background for every printed schedule, with the timetable centered on top.</p>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* Heading text — prints above the grade-level / teacher line on every page. */}
        <div className="space-y-2">
          <Field label="Heading text (optional)">
            <textarea value={heading} rows={3}
              placeholder={"e.g.\nJunior High School Schedule\nSY 2026-2027"}
              onChange={(e) => { setHeading(e.target.value); setHeadingDirty(true); }}
              className="w-full rounded-lg border border-input bg-white px-3 py-2 text-sm outline-none focus:border-brand-mid focus:ring-2 focus:ring-brand-mid/30 transition resize-y leading-snug" />
          </Field>
          <p className="text-xs text-muted-foreground">
            Printed centered above the grade level &amp; section (class schedule) or the teacher's name (teacher schedule). Press Enter for multiple lines.
          </p>
          {headingDirty && (
            <div className="flex gap-2">
              <Button onClick={saveHeading} disabled={update.isPending} className="bg-brand text-white hover:bg-brand-mid">
                {update.isPending ? "Saving…" : "Save heading"}
              </Button>
              <Button variant="outline" onClick={() => { setHeading(savedHeading); setHeadingDirty(false); }}>Cancel</Button>
            </div>
          )}
        </div>

        <div className="border-t border-border" />

        {/* Where the schedule starts on the page (vertical offset, inches). */}
        <div className="space-y-2">
          <Field label="Schedule start position (vertical offset)">
            <div className="flex items-center gap-3">
              <input type="range" min={-2} max={4} step={0.1} value={offset}
                onChange={(e) => { setOffset(parseFloat(e.target.value)); setOffsetDirty(true); }}
                className="flex-1 accent-brand" />
              <div className="flex items-center gap-1">
                <Input type="number" min={-2} max={4} step={0.1} value={offset}
                  onChange={(e) => { setOffset(parseFloat(e.target.value) || 0); setOffsetDirty(true); }}
                  className="w-20 text-right" />
                <span className="text-sm text-muted-foreground">in</span>
              </div>
            </div>
          </Field>
          <p className="text-xs text-muted-foreground">
            Pushes the timetable down (positive) or up (negative) on the page — use this to clear a letterhead at the top of your template. 0 = centered.
          </p>
          {offsetDirty && (
            <div className="flex gap-2">
              <Button onClick={saveOffset} disabled={update.isPending} className="bg-brand text-white hover:bg-brand-mid">
                {update.isPending ? "Saving…" : "Save position"}
              </Button>
              <Button variant="outline" onClick={() => { setOffset(savedOffset); setOffsetDirty(false); }}>Cancel</Button>
            </div>
          )}
        </div>

        <div className="border-t border-border" />

        {/* Printed row height — taller rows for readability, capped to fit one page. */}
        <div className="space-y-2">
          <Field label="Printed row height">
            <div className="flex items-center gap-3">
              <input type="range" min={ROW_MIN} max={ROW_MAX} step={1} value={rowH}
                onChange={(e) => { setRowH(parseInt(e.target.value, 10)); setRowDirty(true); }}
                className="flex-1 accent-brand" />
              <div className="flex items-center gap-1">
                <Input type="number" min={ROW_MIN} max={ROW_MAX} step={1} value={rowH}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setRowH(Number.isNaN(v) ? ROW_DEFAULT : Math.min(ROW_MAX, Math.max(ROW_MIN, v)));
                    setRowDirty(true);
                  }}
                  className="w-20 text-right" />
                <span className="text-sm text-muted-foreground">px</span>
              </div>
            </div>
          </Field>
          <p className="text-xs text-muted-foreground">
            Taller rows are easier to read. Range {ROW_MIN}–{ROW_MAX}px (default {ROW_DEFAULT}). Kept within limits so the schedule still fits one page.
          </p>
          {rowDirty && (
            <div className="flex gap-2">
              <Button onClick={saveRow} disabled={update.isPending} className="bg-brand text-white hover:bg-brand-mid">
                {update.isPending ? "Saving…" : "Save row height"}
              </Button>
              <Button variant="outline" onClick={() => { setRowH(savedRow); setRowDirty(false); }}>Cancel</Button>
            </div>
          )}
        </div>

        <div className="border-t border-border" />

        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden"
          onChange={(e) => onPick(e.target.files?.[0])} />

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => fileRef.current?.click()} disabled={busy} className="bg-brand text-white hover:bg-brand-mid">
            <Upload className="size-4 mr-1.5" /> {busy ? "Processing…" : template ? "Replace template" : "Upload PDF template"}
          </Button>
          {template && (
            <Button variant="outline" onClick={onRemove} disabled={busy} className="text-destructive border-destructive/40 hover:bg-destructive/10">
              <Trash2 className="size-4 mr-1.5" /> Remove
            </Button>
          )}
        </div>

        {err && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
            <p className="text-sm text-destructive font-medium">{err}</p>
            {detail && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none">Technical details</summary>
                <p className="mt-1 break-words font-mono">{detail}</p>
              </details>
            )}
          </div>
        )}

        {template ? (
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Current template — page 1 preview</p>
            <div className="inline-block rounded-lg border border-border shadow-sm overflow-hidden bg-white" style={{ width: "min(340px, 100%)" }}>
              <img src={template} alt="Print template preview" className="block w-full h-auto" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">This is exactly what sits behind every printed page.</p>
          </div>
        ) : (
          <EmptyState icon={<FileText className="size-10" />} title="No template uploaded"
            hint="Schedules print plain. Upload a PDF to use your own letterhead/branding behind the timetable." />
        )}
      </div>
    </Card>
  );
}

function ListRow({ children, cols, template, onEdit, onDelete, confirmLabel, confirmNote, drag }: {
  children?: React.ReactNode;
  /** Table-like columns (first = main); they line up with a ListHeader using the same template. */
  cols?: React.ReactNode[];
  template?: string;
  onEdit?: () => void; onDelete: () => void; confirmLabel?: string; confirmNote?: string;
  drag?: { onDragStart: () => void; onDragEnter: () => void; onDragEnd: () => void; isDragging: boolean; isOver: boolean };
}) {
  const confirm = useConfirm();
  const handleDelete = async () => {
    const ok = await confirm({ title: "Delete?", message: `Remove ${confirmLabel ?? "this item"}?${confirmNote ? ` ${confirmNote}` : ""} You can undo this afterwards.`, confirmLabel: "Delete" });
    if (ok) onDelete();
  };
  return (
    <div draggable={!!drag} onDragStart={drag?.onDragStart} onDragEnter={drag?.onDragEnter}
      onDragOver={drag ? (e) => e.preventDefault() : undefined} onDragEnd={drag?.onDragEnd}
      onDrop={drag ? (e) => { e.preventDefault(); drag.onDragEnd(); } : undefined}
      className={cn("flex items-center gap-2 px-4 py-2.5 border-b border-border last:border-0 hover:bg-muted/30 transition",
        drag?.isDragging && "opacity-40", drag?.isOver && "border-t-2 border-t-brand bg-brand-sage/15")}>
      {drag && (
        <span className="w-4 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-brand touch-none select-none" title="Drag to reorder">
          <GripVertical className="size-4" />
        </span>
      )}
      {cols ? (
        <div className="flex-1 min-w-0 @3xl:grid @3xl:items-center @3xl:gap-x-4" style={{ gridTemplateColumns: template }}>
          <div className="min-w-0 font-semibold text-foreground truncate">{cols[0]}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5 @3xl:contents @3xl:text-sm @3xl:text-foreground">
            {cols.slice(1).map((c, i) => <div key={i} className={cn("min-w-0 @3xl:truncate", (c == null || c === "" || c === false) && "hidden @3xl:block")}>{c == null || c === "" || c === false ? <span className="text-muted-foreground/50">—</span> : c}</div>)}
          </div>
        </div>
      ) : <div className="flex-1 min-w-0">{children}</div>}
      <div className="flex shrink-0 w-[72px] justify-end">
        {onEdit && <Button size="icon-sm" variant="ghost" aria-label={`Edit ${confirmLabel ?? ""}`} onClick={onEdit}><Pencil className="size-4" /></Button>}
        <Button size="icon-sm" variant="ghost" aria-label={`Delete ${confirmLabel ?? ""}`} onClick={handleDelete} className="text-destructive hover:text-destructive"><Trash2 className="size-4" /></Button>
      </div>
    </div>
  );
}

/** Column titles for ListRow columns (hidden on phones, where rows stack). */
function ListHeader({ labels, template, drag }: { labels: string[]; template: string; drag?: boolean }) {
  return (
    <div className="hidden @3xl:flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
      {drag && <span className="w-4 shrink-0" />}
      <div className="flex-1 min-w-0 grid gap-x-4" style={{ gridTemplateColumns: template }}>{labels.map((l) => <div key={l} className="truncate">{l}</div>)}</div>
      <span className="w-[72px] shrink-0" />
    </div>
  );
}

// Generic drag-to-reorder hook for a list of items with id + sortOrder.
// persist(orderedIds) is called with the new full ordering when a drop completes.
function useReorder<T extends { id: number }>(items: T[], persist: (orderedIds: number[]) => void) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const onDragStart = (id: number) => setDragId(id);
  const onDragEnter = (id: number) => { if (dragId != null && id !== dragId) setOverId(id); };
  const onDragEnd = () => {
    if (dragId != null && overId != null && dragId !== overId) {
      const ids = items.map((i) => i.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(overId);
      if (from !== -1 && to !== -1) {
        ids.splice(from, 1);
        ids.splice(to, 0, dragId);
        persist(ids);
      }
    }
    setDragId(null);
    setOverId(null);
  };

  const dragProps = (id: number) => ({
    onDragStart: () => onDragStart(id),
    onDragEnter: () => onDragEnter(id),
    onDragEnd,
    isDragging: dragId === id,
    isOver: overId === id && dragId !== id,
  });

  return { dragProps };
}

function AddBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return <Button onClick={onClick} className="bg-brand text-white hover:bg-brand-mid"><Plus className="size-4" /> {label}</Button>;
}

// "Delete all" button with a confirm prompt. Hidden when there's nothing to delete.
function DeleteAllBtn({ count, noun, note, onClear }: { count: number; noun: string; note?: string; onClear: () => void }) {
  const confirm = useConfirm();
  if (count <= 0) return null;
  const handle = async () => {
    const ok = await confirm({
      title: `Delete all ${noun}?`,
      message: `This will permanently remove all ${count} ${noun}.${note ? ` ${note}` : ""} This cannot be undone.`,
      confirmLabel: `Delete all`,
    });
    if (ok) onClear();
  };
  return (
    <Button variant="outline" onClick={handle} className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive">
      <Trash2 className="size-4 mr-1" /> Delete all
    </Button>
  );
}

// ---------------- shared bits ----------------
/** Run a change through the API, refresh, and keep the dialog open with the message if it fails. */
function useSaver(onDone?: () => void) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (method: string, path: string, body?: unknown) => {
    setError(null); setBusy(true);
    try {
      const r = await request(method, path, body);
      await qc.invalidateQueries();
      onDone?.();
      return r;
    } catch (e: any) {
      setError(e?.message ?? String(e));
      return undefined;
    } finally { setBusy(false); }
  };
  return { run, error, busy, setError };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p role="alert" className="text-sm text-destructive font-medium mt-1">{error}</p> : null;
}

function useQuick() {
  const qc = useQueryClient();
  return async (method: string, path: string, body?: unknown) => {
    try { await request(method, path, body); } catch (e: any) { notify(e?.message ?? String(e), "error"); }
    await qc.invalidateQueries();
  };
}

// ---------------- GRADES ----------------
const GRADE_COLS = "minmax(120px,1fr) minmax(180px,2.5fr) minmax(90px,0.8fr) minmax(110px,0.8fr) minmax(90px,0.8fr)";
function GradesTab() {
  const grades = useGradeLevels();
  const sections = useSections();
  const allocations = useAllocations();
  const quick = useQuick();
  const [editing, setEditing] = useState<any>(null);
  const saver = useSaver(() => setEditing(null));
  return (
    <Card>
      <div className="flex flex-wrap gap-3 justify-between items-center p-4 border-b border-border">
        <h3 className="font-display font-bold text-brand-forest">Grade Levels</h3>
        <div className="flex flex-wrap items-center gap-2">
          <DeleteAllBtn count={grades.data?.length ?? 0} noun="grade levels" note="Their sections, schedules and allocations are also removed." onClear={() => quick("POST", "/grade-levels/clear")} />
          <AddBtn onClick={() => { saver.setError(null); setEditing({ name: "", sortOrder: (grades.data?.length ?? 0) + 1 }); }} label="Add grade" />
        </div>
      </div>
      {grades.isLoading && <p className="p-4 text-muted-foreground">Loading…</p>}
      {!grades.isLoading && (grades.data?.length ?? 0) === 0 && <EmptyState icon={<Layers className="size-10" />} title="No grade levels" hint="e.g. Grade 7, Grade 8" />}
      {(grades.data?.length ?? 0) > 0 && <ListHeader template={GRADE_COLS} labels={["Grade level", "Sections", "Students", "Periods / week", "Subjects"]} />}
      {(grades.data ?? []).map((g) => {
        const secs = (sections.data ?? []).filter((s) => s.gradeLevelId === g.id);
        const allocs = (allocations.data ?? []).filter((a) => a.gradeLevelId === g.id && a.periodsPerWeek > 0);
        const students = secs.reduce((n, s) => n + (s.studentCount ?? 0), 0);
        return (
          <ListRow key={g.id} template={GRADE_COLS} cols={[g.name, `${secs.length} section${secs.length === 1 ? "" : "s"}${secs.length ? ` (${secs.map((s) => s.name).join(", ")})` : ""}`, students ? `${students} students` : "", allocs.length ? `${allocs.reduce((n, a) => n + a.periodsPerWeek, 0)} periods` : "", allocs.length ? `${allocs.length} subjects` : ""]}
            confirmLabel={`grade level "${g.name}"`} confirmNote="Its sections and their classes are removed too." onEdit={() => { saver.setError(null); setEditing(g); }} onDelete={() => quick("DELETE", `/grade-levels/${g.id}`)} />
        );
      })}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? "Edit grade" : "Add grade"}
          footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={!editing.name?.trim() || saver.busy} onClick={() => saver.run(editing.id ? "PUT" : "POST", editing.id ? `/grade-levels/${editing.id}` : "/grade-levels", { name: editing.name.trim(), sortOrder: Number(editing.sortOrder) || 0 })} className="bg-brand text-white hover:bg-brand-mid">Save</Button></>}>
          <Field label="Name"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Grade 7" autoFocus /></Field>
          <Field label="Order" hint="Lower numbers come first"><Input type="number" value={editing.sortOrder} onChange={(e) => setEditing({ ...editing, sortOrder: e.target.value })} /></Field>
          <ErrorLine error={saver.error} />
        </Modal>
      )}
    </Card>
  );
}

// ---------------- SECTIONS ----------------
const SECTION_COLS = "minmax(90px,1fr) minmax(90px,1fr) minmax(110px,1.1fr) minmax(70px,0.6fr) minmax(140px,1.6fr) minmax(90px,0.7fr)";
function SectionsTab() {
  const entries = useEntries();
  const sections = useSections();
  const grades = useGradeLevels();
  const teachers = useTeachers();
  const rooms = useRooms();
  const qc = useQueryClient();
  const quick = useQuick();
  const [editing, setEditing] = useState<any>(null);
  const saver = useSaver(() => setEditing(null));
  const [gradeFilter, setGradeFilter] = useState<number | "">("");
  const list = (sections.data ?? []).filter((s) => gradeFilter === "" || s.gradeLevelId === gradeFilter);

  const reorder = async (orderedIds: number[]) => {
    // Reordering inside a filtered list keeps the other sections where they are.
    const all = (sections.data ?? []).map((s) => s.id);
    const visible = new Set(orderedIds);
    let i = 0;
    const merged = all.map((id) => (visible.has(id) ? orderedIds[i++] : id));
    const prev = qc.getQueryData<any[]>(["sections"]);
    if (prev) { const byId = new Map(prev.map((s) => [s.id, s])); qc.setQueryData(["sections"], merged.map((id, n) => ({ ...byId.get(id), sortOrder: n + 1 }))); }
    await quick("POST", "/sections/reorder", { ids: merged });
  };
  const { dragProps } = useReorder(list, reorder);
  const homeroomUse = (roomId: number | null, selfId?: number) => roomId == null ? [] : (sections.data ?? []).filter((s) => s.homeroomId === roomId && s.id !== selfId).map((s) => s.name);

  const body = (e: any) => ({ name: e.name.trim(), gradeLevelId: Number(e.gradeLevelId), adviser: e.adviser || null, homeroomId: e.homeroomId ? Number(e.homeroomId) : null, studentCount: e.studentCount ? Number(e.studentCount) : null });
  const countBad = editing?.studentCount && (!Number.isInteger(Number(editing.studentCount)) || Number(editing.studentCount) < 1 || Number(editing.studentCount) > 200);

  return (
    <Card>
      <div className="flex flex-wrap gap-3 justify-between items-center p-4 border-b border-border">
        <h3 className="font-display font-bold text-brand-forest">Sections</h3>
        <div className="flex flex-wrap items-center gap-2">
          <DeleteAllBtn count={sections.data?.length ?? 0} noun="sections" note="Their scheduled classes are also removed." onClear={() => quick("POST", "/sections/clear")} />
          <ImportButton disabled={(grades.data?.length ?? 0) === 0} endpoint="/sections/import" headerHints={["section", "grade"]} itemLabel="section" />
          <AddBtn onClick={() => { saver.setError(null); setEditing({ name: "", gradeLevelId: gradeFilter || grades.data?.[0]?.id, adviser: "", homeroomId: "", studentCount: "" }); }} label="Add section" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <Select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value === "" ? "" : Number(e.target.value))} className="w-auto min-w-36 h-9">
          <option value="">All grade levels</option>
          {(grades.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
        <p className="text-xs text-muted-foreground">Import columns: section, grade level, students, homeroom, adviser · drag rows to reorder</p>
      </div>
      {(grades.data?.length ?? 0) === 0 && <p className="p-4 text-sm text-muted-foreground">Add a grade level first.</p>}
      {list.length > 0 && <ListHeader drag template={SECTION_COLS} labels={["Section", "Grade", "Homeroom", "Students", "Adviser", "Classes / week"]} />}
      {list.map((s) => {
        const g = grades.data?.find((g) => g.id === s.gradeLevelId);
        const room = rooms.data?.find((r) => r.id === s.homeroomId);
        const n = (entries.data ?? []).filter((e) => e.sectionId === s.id).length;
        const over = room?.capacity && s.studentCount && s.studentCount > room.capacity;
        return (
          <ListRow key={s.id} drag={dragProps(s.id)} template={SECTION_COLS}
            cols={[s.name, g?.name, room ? <span className={cn(over && "text-destructive")} title={over ? `Only ${room.capacity} seats` : undefined}>{room.name}{over ? " ⚠" : ""}</span> : "", s.studentCount ? String(s.studentCount) : "", s.adviser, n ? String(n) : ""]}
            confirmLabel={`section "${s.name}"`} confirmNote="Its scheduled classes are removed too." onEdit={() => { saver.setError(null); setEditing({ ...s, homeroomId: s.homeroomId ?? "", studentCount: s.studentCount ?? "", adviser: s.adviser ?? "" }); }} onDelete={() => quick("DELETE", `/sections/${s.id}`)} />
        );
      })}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? "Edit section" : "Add section"}
          footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={!editing.name?.trim() || !editing.gradeLevelId || countBad || saver.busy} onClick={() => saver.run(editing.id ? "PUT" : "POST", editing.id ? `/sections/${editing.id}` : "/sections", body(editing))} className="bg-brand text-white hover:bg-brand-mid">Save</Button></>}>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Section name"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="7-Einstein" autoFocus /></Field>
            <Field label="Grade level">
              <Select value={editing.gradeLevelId ?? ""} onChange={(e) => setEditing({ ...editing, gradeLevelId: Number(e.target.value) })}>
                {(grades.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            </Field>
            <Field label="Homeroom" hint={homeroomUse(editing.homeroomId ? Number(editing.homeroomId) : null, editing.id).length ? `Also homeroom of ${homeroomUse(Number(editing.homeroomId), editing.id).join(", ")}` : "Classes go here unless the subject needs its own room"}>
              <Select value={editing.homeroomId ?? ""} onChange={(e) => setEditing({ ...editing, homeroomId: e.target.value })}>
                <option value="">— None —</option>
                {(rooms.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}{r.capacity ? ` (${r.capacity} seats)` : ""}</option>)}
              </Select>
            </Field>
            <Field label="Number of students" hint={countBad ? "Enter a whole number from 1 to 200." : "Checked against room seats"}>
              <Input type="number" min={1} value={editing.studentCount ?? ""} onChange={(e) => setEditing({ ...editing, studentCount: e.target.value })} placeholder="optional" aria-invalid={!!countBad} />
            </Field>
          </div>
          <Field label="Class adviser">
            <Select value={editing.adviser ?? ""} onChange={(e) => setEditing({ ...editing, adviser: e.target.value })}>
              <option value="">— None —</option>
              {(teachers.data ?? []).map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </Select>
          </Field>
          <ErrorLine error={saver.error} />
        </Modal>
      )}
    </Card>
  );
}

// ---------------- SUBJECTS ----------------
const SUBJECT_COLS = "minmax(180px,2.4fr) minmax(60px,0.6fr) minmax(110px,1.1fr) minmax(90px,0.8fr) minmax(100px,0.8fr) minmax(70px,0.6fr)";
function SubjectsTab() {
  const grades = useGradeLevels();
  const allocations = useAllocations();
  const teachers = useTeachers();
  const subjects = useSubjects();
  const rooms = useRooms();
  const qc = useQueryClient();
  const quick = useQuick();
  const [editing, setEditing] = useState<any>(null);
  const saver = useSaver(() => setEditing(null));
  const reorder = async (ids: number[]) => {
    const prev = qc.getQueryData<any[]>(["subjects"]);
    if (prev) { const byId = new Map(prev.map((s) => [s.id, s])); qc.setQueryData(["subjects"], ids.map((id, i) => ({ ...byId.get(id), sortOrder: i + 1 }))); }
    await quick("POST", "/subjects/reorder", { ids });
  };
  const { dragProps } = useReorder(subjects.data ?? [], reorder);
  const body = (e: any) => ({ name: e.name.trim(), code: e.code?.trim() || null, color: e.color ?? null, roomIds: e.roomIds ?? [], timePreference: e.timePreference || null });

  return (
    <Card>
      <div className="flex flex-wrap gap-3 justify-between items-center p-4 border-b border-border">
        <h3 className="font-display font-bold text-brand-forest">Subjects</h3>
        <div className="flex flex-wrap items-center gap-2">
          <DeleteAllBtn count={subjects.data?.length ?? 0} noun="subjects" note="They are removed from schedules and allocations." onClear={() => quick("POST", "/subjects/clear")} />
          <ImportButton endpoint="/subjects/import" headerHints={["name", "code", "subject"]} itemLabel="subject" />
          <AddBtn onClick={() => { saver.setError(null); setEditing({ name: "", code: "", color: "#338D67", roomIds: [], timePreference: "" }); }} label="Add subject" />
        </div>
      </div>
      <p className="px-4 pt-2 text-xs text-muted-foreground">Import columns: name, code · drag rows to reorder</p>
      {(subjects.data?.length ?? 0) > 0 && <ListHeader drag template={SUBJECT_COLS} labels={["Subject", "Code", "Room", "Best time", "Periods / week", "Teachers"]} />}
      {(subjects.data ?? []).map((s) => {
        const per = (grades.data ?? []).map((g) => ({ g, n: (allocations.data ?? []).find((a) => a.gradeLevelId === g.id && a.subjectId === s.id)?.periodsPerWeek ?? 0 })).filter((x) => x.n > 0);
        const tCount = (teachers.data ?? []).filter((t) => t.subjectIds.includes(s.id)).length;
        return (
          <ListRow key={s.id} drag={dragProps(s.id)} template={SUBJECT_COLS}
            cols={[<span className="inline-flex items-center gap-2 min-w-0"><span className="size-3.5 rounded border border-border shrink-0" style={{ backgroundColor: s.color || "transparent" }} /><span className="truncate" title={s.name}>{s.name}</span></span>,
              s.code, s.roomIds?.length ? s.roomIds.map((id) => rooms.data?.find((r) => r.id === id)?.name).filter(Boolean).join(" / ") : "Homeroom",
              s.timePreference ? (s.timePreference === "morning" ? "Mornings" : "Afternoons") : "",
              per.length ? <span title={per.map((x) => `${x.g.name}: ${x.n}`).join("\n")}>{[...new Set(per.map((x) => x.n))].join(" / ")}</span> : "",
              tCount ? String(tCount) : ""]}
            confirmLabel={`subject "${s.name}"`} confirmNote="It will be removed from schedules and allocations." onEdit={() => { saver.setError(null); setEditing({ ...s, roomIds: s.roomIds ?? [], timePreference: s.timePreference ?? "" }); }} onDelete={() => quick("DELETE", `/subjects/${s.id}`)} />
        );
      })}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? "Edit subject" : "Add subject"}
          footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={!editing.name?.trim() || saver.busy} onClick={() => saver.run(editing.id ? "PUT" : "POST", editing.id ? `/subjects/${editing.id}` : "/subjects", body(editing))} className="bg-brand text-white hover:bg-brand-mid">Save</Button></>}>
          <div className="grid sm:grid-cols-[1fr_120px] gap-x-4">
            <Field label="Name"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Mathematics" autoFocus /></Field>
            <Field label="Code"><Input value={editing.code ?? ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} placeholder="MATH" /></Field>
          </div>
          <Field label="Needs one of these rooms" hint="For labs, the gym, the computer room… None picked = the section's homeroom.">
            <Chips options={(rooms.data ?? []).map((r) => ({ id: r.id, label: r.name }))} value={editing.roomIds ?? []} onChange={(v) => setEditing({ ...editing, roomIds: v })} />
          </Field>
          <Field label="Best time of day" hint="Auto-fill tries to follow this">
            <Select value={editing.timePreference ?? ""} onChange={(e) => setEditing({ ...editing, timePreference: e.target.value })}>
              <option value="">Any time</option>
              <option value="morning">Mornings</option>
              <option value="afternoon">Afternoons</option>
            </Select>
          </Field>
          <Field label="Color" hint="Pick a swatch, type a hex, or choose No color"><ColorPicker value={editing.color ?? null} onChange={(c) => setEditing({ ...editing, color: c })} allowNone /></Field>
          <ErrorLine error={saver.error} />
        </Modal>
      )}
    </Card>
  );
}

// ---------------- ROOMS ----------------
const ROOM_COLS = "minmax(120px,1.2fr) minmax(80px,0.6fr) minmax(140px,1.6fr) minmax(140px,1.6fr) minmax(110px,0.9fr)";
function RoomsTab() {
  const entries = useEntries();
  const rooms = useRooms();
  const sections = useSections();
  const subjects = useSubjects();
  const quick = useQuick();
  const [editing, setEditing] = useState<any>(null);
  const saver = useSaver(() => setEditing(null));
  const capBad = editing?.capacity !== "" && editing?.capacity != null && (!Number.isInteger(Number(editing.capacity)) || Number(editing.capacity) < 1 || Number(editing.capacity) > 2000);
  return (
    <Card>
      <div className="flex flex-wrap gap-3 justify-between items-center p-4 border-b border-border">
        <h3 className="font-display font-bold text-brand-forest">Rooms</h3>
        <div className="flex flex-wrap items-center gap-2">
          <DeleteAllBtn count={rooms.data?.length ?? 0} noun="rooms" note="They are removed from classes and homerooms." onClear={() => quick("POST", "/rooms/clear")} />
          <ImportButton endpoint="/rooms/import" headerHints={["name", "capacity", "room"]} itemLabel="room" />
          <AddBtn onClick={() => { saver.setError(null); setEditing({ name: "", capacity: "" }); }} label="Add room" />
        </div>
      </div>
      <p className="px-4 pt-2 text-xs text-muted-foreground">Import columns: name, seats. Set homerooms on the Sections tab and special rooms (labs) on Subjects.</p>
      {(rooms.data?.length ?? 0) > 0 && <ListHeader template={ROOM_COLS} labels={["Room", "Seats", "Homeroom of", "Used for", "In use"]} />}
      {(rooms.data ?? []).map((r) => {
        const homes = (sections.data ?? []).filter((s) => s.homeroomId === r.id).map((s) => s.name);
        const special = (subjects.data ?? []).filter((s) => s.roomIds?.includes(r.id)).map((s) => s.name);
        return (
          <ListRow key={r.id} template={ROOM_COLS} cols={[r.name, r.capacity ? `${r.capacity} seats` : "", homes.join(", "), special.join(", "), (() => { const n = (entries.data ?? []).filter((e) => e.roomId === r.id).length; return n ? `${n} classes / week` : ""; })()]}
            confirmLabel={`room "${r.name}"`} confirmNote="It will be removed from classes and homerooms." onEdit={() => { saver.setError(null); setEditing({ ...r, capacity: r.capacity ?? "" }); }} onDelete={() => quick("DELETE", `/rooms/${r.id}`)} />
        );
      })}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? "Edit room" : "Add room"}
          footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={!editing.name?.trim() || capBad || saver.busy} onClick={() => saver.run(editing.id ? "PUT" : "POST", editing.id ? `/rooms/${editing.id}` : "/rooms", { name: editing.name.trim(), capacity: editing.capacity === "" ? null : Number(editing.capacity) })} className="bg-brand text-white hover:bg-brand-mid">Save</Button></>}>
          <Field label="Name"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Room 101" autoFocus /></Field>
          <Field label="Seats" hint={capBad ? "Enter a whole number, 1 or more." : "How many students fit (optional)"}><Input type="number" min={1} value={editing.capacity ?? ""} onChange={(e) => setEditing({ ...editing, capacity: e.target.value })} placeholder="optional" aria-invalid={!!capBad} /></Field>
          <ErrorLine error={saver.error} />
        </Modal>
      )}
    </Card>
  );
}

// ---------------- TIME SLOTS (bell schedules) ----------------
const SLOT_COLS = "minmax(130px,1.2fr) minmax(100px,0.9fr) minmax(70px,0.6fr) minmax(100px,0.8fr) minmax(130px,1.4fr) minmax(110px,1.1fr)";
function SlotsTab() {
  const slots = useTimeSlots();
  const grades = useGradeLevels();
  const settings = useSettings();
  const quick = useQuick();
  const [editing, setEditing] = useState<any>(null);
  const saver = useSaver(() => setEditing(null));
  const [gradeView, setGradeView] = useState<number | "">("");
  const days = settings.data?.activeDays ?? [1, 2, 3, 4, 5];
  const sorted = sortSlots(slots.data ?? []).filter((s) => gradeView === "" || !s.gradeLevelIds?.length || s.gradeLevelIds.includes(gradeView));
  const gName = (id: number) => grades.data?.find((g) => g.id === id)?.name ?? "?";
  const timeBad = editing && editing.startTime && editing.endTime && editing.endTime <= editing.startTime;
  const body = (e: any) => ({ label: e.label.trim(), startTime: e.startTime, endTime: e.endTime, isBreak: !!e.isBreak, gradeLevelIds: e.gradeLevelIds ?? [], days: e.days ?? [], sortOrder: Number(e.sortOrder) || 0 });

  return (
    <Card>
      <div className="flex flex-wrap gap-3 justify-between items-center p-4 border-b border-border">
        <h3 className="font-display font-bold text-brand-forest">Time Slots / Periods</h3>
        <div className="flex flex-wrap items-center gap-2">
          <DeleteAllBtn count={slots.data?.length ?? 0} noun="time slots" note="Classes and blocks in them are also removed." onClear={() => quick("POST", "/time-slots/clear")} />
          <ImportButton endpoint="/time-slots/import" headerHints={["label", "start", "end"]} itemLabel="period" />
          <AddBtn onClick={() => { saver.setError(null); const last = sorted[sorted.length - 1]; setEditing({ label: "", startTime: last?.endTime ?? "07:30", endTime: "", isBreak: false, gradeLevelIds: gradeView === "" ? [] : [gradeView], days: [], sortOrder: (slots.data?.length ?? 0) + 1 }); }} label="Add period" />
        </div>
      </div>
      <div className="px-4 pt-3 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={gradeView} onChange={(e) => setGradeView(e.target.value === "" ? "" : Number(e.target.value))} className="w-auto min-w-40 h-9">
            <option value="">All bell schedules</option>
            {(grades.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}'s periods</option>)}
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">Periods are listed by start time. Give a period to some grades or days only when grades have different bell schedules (e.g. Grade 7 starts at 7:00, Grade 10 at 7:30). Import columns: label, start, end, order, break (yes), grade levels (separate with ;).</p>
      </div>
      {sorted.length > 0 && <ListHeader template={SLOT_COLS} labels={["Period", "Time", "Length", "Type", "Grades", "Days"]} />}
      {sorted.map((s) => {
        const mins = toMinutes(s.endTime) - toMinutes(s.startTime);
        return (
          <ListRow key={s.id} template={SLOT_COLS}
            cols={[<span className="inline-flex items-center gap-2">{s.isBreak && <Coffee className="size-4 text-brand-wood shrink-0" />}{s.label}</span>,
              <span className="tabular-nums">{s.startTime}–{s.endTime}</span>, Number.isFinite(mins) ? `${mins} min` : "",
              s.isBreak ? <span className="text-brand-wood font-medium">Break</span> : "Class period",
              s.gradeLevelIds?.length ? s.gradeLevelIds.map(gName).join(", ") : "All grades",
              s.days?.length ? s.days.map((d) => DAY_SHORT[d]).join(", ") : "Every day"]}
            confirmLabel={`period "${s.label}"`} confirmNote="Classes in this period will be removed." onEdit={() => { saver.setError(null); setEditing({ ...s, gradeLevelIds: s.gradeLevelIds ?? [], days: s.days ?? [] }); }} onDelete={() => quick("DELETE", `/time-slots/${s.id}`)} />
        );
      })}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? "Edit period" : "Add period"}
          footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={!editing.label?.trim() || !editing.startTime || !editing.endTime || timeBad || saver.busy} onClick={() => saver.run(editing.id ? "PUT" : "POST", editing.id ? `/time-slots/${editing.id}` : "/time-slots", body(editing))} className="bg-brand text-white hover:bg-brand-mid">Save</Button></>}>
          <Field label="Label"><Input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="P1 or Recess" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start"><Input type="time" value={editing.startTime} onChange={(e) => setEditing({ ...editing, startTime: e.target.value })} /></Field>
            <Field label="End"><Input type="time" value={editing.endTime} onChange={(e) => setEditing({ ...editing, endTime: e.target.value })} aria-invalid={!!timeBad} /></Field>
          </div>
          {timeBad && <p className="text-xs text-destructive -mt-2 mb-3">The end time must be after the start time.</p>}
          <Field label="Used by" hint="None picked = every grade">
            <Chips options={(grades.data ?? []).map((g) => ({ id: g.id, label: g.name }))} value={editing.gradeLevelIds ?? []} onChange={(v) => setEditing({ ...editing, gradeLevelIds: v })} />
          </Field>
          <Field label="On these days" hint="None picked = every school day">
            <Chips options={days.map((d) => ({ id: d, label: DAY_SHORT[d] }))} value={editing.days ?? []} onChange={(v) => setEditing({ ...editing, days: v })} />
          </Field>
          <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
            <input type="checkbox" checked={!!editing.isBreak} onChange={(e) => setEditing({ ...editing, isBreak: e.target.checked })} className="size-4 accent-brand" />
            This is a break (recess/lunch) — no classes
          </label>
          <ErrorLine error={saver.error} />
        </Modal>
      )}
    </Card>
  );
}

// ---------------- BLOCKED TIMES ----------------
const BLOCK_COLS = "minmax(100px,0.8fr) minmax(150px,1.2fr) minmax(160px,1.6fr) minmax(160px,1.6fr)";
function BlockedTab() {
  const blocked = useBlockedTimes();
  const slots = useTimeSlots();
  const sections = useSections();
  const grades = useGradeLevels();
  const settings = useSettings();
  const { inv } = useCrud();
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<any>({ dayOfWeek: 1, timeSlotIds: [], scope: "all", gradeLevelId: null, sectionIds: [], reason: "" });
  const [filterDay, setFilterDay] = useState<number | "">("");
  const [filterGrade, setFilterGrade] = useState<number | "">("");

  const save = useMutation({
    mutationFn: async (b: any) => {
      const base: any = { dayOfWeek: b.dayOfWeek, reason: b.reason, sectionId: null, gradeLevelId: null, sectionIds: null };
      if (b.scope === "grade") base.gradeLevelId = b.gradeLevelId ?? null;
      else if (b.scope === "sections") base.sectionIds = b.sectionIds ?? [];
      const ids: number[] = b.timeSlotIds ?? [];
      if (editId != null) {
        // Editing an existing block updates that one row (first selected period).
        return [await request("PUT", `/blocked-times/${editId}`, { ...base, timeSlotId: ids[0] })];
      }
      // one blocked row per selected period
      return Promise.all(ids.map((tid) => api["blocked-times"].$post({ json: { ...base, timeSlotId: tid } }).then((r) => r.json())));
    },
    onSuccess: () => { inv(["blocked-times", "conflicts"]); setAdding(false); setEditId(null); },
  });

  const startEdit = (b: any) => {
    const scope = b.sectionIds && b.sectionIds.length ? "sections" : b.gradeLevelId != null ? "grade" : "all";
    setForm({
      dayOfWeek: b.dayOfWeek,
      timeSlotIds: [b.timeSlotId],
      scope,
      gradeLevelId: b.gradeLevelId ?? grades.data?.[0]?.id ?? null,
      sectionIds: b.sectionIds ?? (b.sectionId != null ? [b.sectionId] : []),
      reason: b.reason ?? "",
    });
    setEditId(b.id);
    setAdding(true);
  };
  const del = useMutation({ mutationFn: async (id: number) => (await api["blocked-times"][":id"].$delete({ param: { id: String(id) } })).json(), onSuccess: () => inv(["blocked-times", "conflicts"]) });
  const clearAll = useMutation({ mutationFn: async () => (await api["blocked-times"].clear.$post()).json(), onSuccess: () => inv(["blocked-times", "conflicts"]) });

  const days = settings.data?.activeDays ?? [1, 2, 3, 4, 5];
  const schedSlots = sortSlots(slots.data ?? []).filter((s) => !s.isBreak);

  const scopeLabel = (b: any) => {
    if (b.sectionIds && b.sectionIds.length) {
      const names = b.sectionIds.map((id: number) => sections.data?.find((s) => s.id === id)?.name).filter(Boolean);
      return names.length ? names.join(", ") : `${b.sectionIds.length} sections`;
    }
    if (b.gradeLevelId != null) return grades.data?.find((g) => g.id === b.gradeLevelId)?.name ?? "Grade level";
    if (b.sectionId != null) return sections.data?.find((s) => s.id === b.sectionId)?.name ?? "Section";
    return "All sections";
  };

  const toggleSection = (id: number) => setForm((f: any) => ({ ...f, sectionIds: f.sectionIds.includes(id) ? f.sectionIds.filter((x: number) => x !== id) : [...f.sectionIds, id] }));
  const togglePeriod = (id: number) => setForm((f: any) => ({ ...f, timeSlotIds: f.timeSlotIds.includes(id) ? f.timeSlotIds.filter((x: number) => x !== id) : [...f.timeSlotIds, id] }));
  const canSave = form.timeSlotIds.length > 0 && (form.scope !== "grade" || form.gradeLevelId != null) && (form.scope !== "sections" || form.sectionIds.length > 0);

  // Does a block apply to / mention the chosen grade level?
  const blockMatchesGrade = (b: any, gid: number) => {
    if (b.gradeLevelId != null) return b.gradeLevelId === gid;
    if (b.sectionIds && b.sectionIds.length) return b.sectionIds.some((sid: number) => sections.data?.find((s) => s.id === sid)?.gradeLevelId === gid);
    if (b.sectionId != null) return sections.data?.find((s) => s.id === b.sectionId)?.gradeLevelId === gid;
    return true; // "all sections" block applies to every grade
  };
  const filtered = (blocked.data ?? []).filter((b: any) =>
    (filterDay === "" || b.dayOfWeek === filterDay) &&
    (filterGrade === "" || blockMatchesGrade(b, Number(filterGrade)))
  );
  const hasBlocks = (blocked.data?.length ?? 0) > 0;

  return (
    <Card>
      <div className="flex flex-wrap gap-3 justify-between items-center p-4 border-b border-border">
        <h3 className="font-display font-bold text-brand-forest">Blocked Times</h3>
        <div className="flex flex-wrap items-center gap-2">
        <DeleteAllBtn count={blocked.data?.length ?? 0} noun="blocked times" onClear={() => clearAll.mutate()} />
        <AddBtn onClick={() => { setEditId(null); setForm({ dayOfWeek: days[0], timeSlotIds: [], scope: "all", gradeLevelId: grades.data?.[0]?.id ?? null, sectionIds: [], reason: "" }); setAdding(true); }} label="Block a slot" />
        </div>
      </div>
      {hasBlocks && (
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border bg-muted/30">
          <span className="text-xs font-medium text-muted-foreground">Filter:</span>
          <Select value={filterDay} onChange={(e) => setFilterDay(e.target.value === "" ? "" : Number(e.target.value))} className="w-auto min-w-32">
            <option value="">All days</option>
            {days.map((d) => <option key={d} value={d}>{DAY_SHORT[d]}</option>)}
          </Select>
          <Select value={filterGrade} onChange={(e) => setFilterGrade(e.target.value === "" ? "" : Number(e.target.value))} className="w-auto min-w-36">
            <option value="">All grade levels</option>
            {(grades.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
          {(filterDay !== "" || filterGrade !== "") && (
            <button type="button" className="text-xs text-brand hover:underline" onClick={() => { setFilterDay(""); setFilterGrade(""); }}>Clear filters</button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">{filtered.length} of {blocked.data?.length ?? 0}</span>
        </div>
      )}
      {!hasBlocks && <EmptyState icon={<Ban className="size-10" />} title="Nothing blocked" hint="Block specific day+period combos (e.g. Monday flag ceremony)." />}
      {hasBlocks && filtered.length === 0 && <p className="text-sm text-muted-foreground p-6 text-center">No blocked times match these filters.</p>}
      {filtered.length > 0 && <ListHeader template={BLOCK_COLS} labels={["Day", "Period", "Applies to", "Reason"]} />}
      {filtered.map((b) => {
        const slot = slots.data?.find((s) => s.id === b.timeSlotId);
        return (
          <ListRow key={b.id} template={BLOCK_COLS} cols={[`${DAY_FULL[b.dayOfWeek]}`, slot ? `${slot.label} (${slot.startTime}–${slot.endTime})` : "?", scopeLabel(b), b.reason ?? ""]}
            confirmLabel="this blocked time" onEdit={() => startEdit(b)} onDelete={() => del.mutate(b.id)} />
        );
      })}
      {adding && (
        <Modal open onClose={() => { setAdding(false); setEditId(null); }} title={editId != null ? "Edit blocked time" : "Block a slot"}
          footer={<><Button variant="outline" onClick={() => { setAdding(false); setEditId(null); }}>Cancel</Button>
            <Button disabled={!canSave || save.isPending} onClick={() => save.mutate(form)} className="bg-brand text-white hover:bg-brand-mid">{editId != null ? "Save" : "Block"}</Button></>}>
          <Field label="Day"><Select value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}>{days.map((d) => <option key={d} value={d}>{DAY_SHORT[d]}</option>)}</Select></Field>
          <Field label={editId != null ? "Period" : `Periods${form.timeSlotIds.length ? ` (${form.timeSlotIds.length} selected)` : ""}`}>
            {editId == null && (
              <div className="flex items-center justify-between mb-1.5">
                <button type="button" className="text-xs text-brand hover:underline" onClick={() => setForm({ ...form, timeSlotIds: form.timeSlotIds.length === schedSlots.length ? [] : schedSlots.map((s) => s.id) })}>
                  {form.timeSlotIds.length === schedSlots.length ? "Clear all" : "Select all"}
                </button>
              </div>
            )}
            <div className="max-h-44 overflow-y-auto rounded-lg border border-border p-2 space-y-1">
              {schedSlots.length === 0 && <p className="text-sm text-muted-foreground px-1">No periods yet.</p>}
              {schedSlots.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer px-1 py-0.5 rounded hover:bg-muted/50">
                  <input
                    type={editId != null ? "radio" : "checkbox"}
                    name="blocked-period"
                    className="size-4 accent-brand"
                    checked={form.timeSlotIds.includes(s.id)}
                    onChange={() => (editId != null ? setForm({ ...form, timeSlotIds: [s.id] }) : togglePeriod(s.id))}
                  />
                  <span>{s.label} <span className="text-muted-foreground ml-1">({s.startTime})</span></span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Scope">
            <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
              <option value="all">All sections</option>
              <option value="grade">By grade level</option>
              <option value="sections">Specific section(s)</option>
            </Select>
          </Field>
          {form.scope === "grade" && (
            <Field label="Grade level">
              <Select value={form.gradeLevelId ?? ""} onChange={(e) => setForm({ ...form, gradeLevelId: Number(e.target.value) })}>
                {(grades.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            </Field>
          )}
          {form.scope === "sections" && (
            <Field label="Sections">
              <div className="max-h-44 overflow-y-auto rounded-lg border border-border p-2 space-y-1">
                {(sections.data ?? []).length === 0 && <p className="text-sm text-muted-foreground px-1">No sections yet.</p>}
                {(sections.data ?? []).map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer px-1 py-0.5 rounded hover:bg-muted/50">
                    <input type="checkbox" className="size-4 accent-brand" checked={form.sectionIds.includes(s.id)} onChange={() => toggleSection(s.id)} />
                    <span>{s.name}<span className="text-muted-foreground ml-1">({grades.data?.find((g) => g.id === s.gradeLevelId)?.name})</span></span>
                  </label>
                ))}
              </div>
            </Field>
          )}
          <Field label="Reason"><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Flag ceremony, assembly…" /></Field>
        </Modal>
      )}
    </Card>
  );
}

// ---------------- SCHOOL YEARS / TERMS ----------------
function TermsTab() {
  const terms = useTerms();
  const act = useAct();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<(Partial<Term> & { copy?: "all" | "setup" | "empty" }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fmt = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { dateStyle: "medium" }) : "—");
  const dateBad = !!(editing?.startDate && editing?.endDate && editing.endDate < editing.startDate);

  async function save() {
    if (!editing) return;
    setErr(null);
    const body = { name: editing.name?.trim(), startDate: editing.startDate || null, endDate: editing.endDate || null, copy: editing.copy ?? "setup" };
    try {
      if (editing.id) await request("PUT", `/terms/${editing.id}`, body);
      else await request("POST", "/terms", body);
      await act("GET", "/terms", undefined, { invalidate: ["terms"], success: editing.id ? "Saved." : "Term added. Switch to it when you're ready." });
      setEditing(null);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
  }
  async function activate(t: Term) {
    if (!(await confirm({ title: `Switch to ${t.name}?`, message: "The schedule you have now is kept with the current term, and you can switch back at any time. Undo history is cleared when you switch.", confirmLabel: "Switch", destructive: false }))) return;
    await act("POST", `/terms/${t.id}/activate`, {}, { success: `Now working on ${t.name}.` });
  }
  async function remove(t: Term) {
    if (await confirm({ title: `Delete ${t.name}?`, message: "Its saved schedule and setup are deleted for good. This can't be undone.", confirmLabel: "Delete" }))
      await act("DELETE", `/terms/${t.id}`, undefined, { invalidate: ["terms"], success: "Term deleted." });
  }

  return (
    <Card>
      <div className="flex flex-wrap gap-3 justify-between items-center p-4 border-b border-border">
        <h3 className="font-display font-bold text-brand-forest">School Years & Terms</h3>
        <AddBtn onClick={() => { setErr(null); setEditing({ name: "", startDate: "", endDate: "", copy: "setup" }); }} label="New term" />
      </div>
      <p className="text-sm text-muted-foreground px-4 py-3 border-b border-border bg-muted/30">
        Keep each school year or semester separately. Start a new one from a copy of this one (setup only, or with the schedule), work on it, and switch back to look at an old one. Term dates are used for calendar files.
      </p>
      {(terms.data ?? []).map((t) => (
        <div key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border last:border-0">
          <div className="flex-1 min-w-[180px]">
            <p className="font-semibold text-brand-forest flex items-center gap-2">{t.name}{t.isActive && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand text-white">Current</span>}</p>
            <p className="text-sm text-muted-foreground">{fmt(t.startDate)} – {fmt(t.endDate)}</p>
          </div>
          {!t.isActive && <Button variant="outline" size="sm" onClick={() => activate(t)} disabled={!t.stored}><CheckCircle2 className="size-4" /> Switch to this</Button>}
          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => { setErr(null); setEditing(t); }}><Pencil className="size-4" /></Button>
          {!t.isActive && <Button size="icon-sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => remove(t)} className="text-destructive hover:text-destructive"><Trash2 className="size-4" /></Button>}
        </div>
      ))}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? "Edit term" : "New term"}
          footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={!editing.name?.trim() || dateBad} className="bg-brand text-white hover:bg-brand-mid">Save</Button></>}>
          <Field label="Name"><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="SY 2027–2028" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts"><Input type="date" value={editing.startDate ?? ""} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} /></Field>
            <Field label="Ends"><Input type="date" value={editing.endDate ?? ""} onChange={(e) => setEditing({ ...editing, endDate: e.target.value })} aria-invalid={dateBad} /></Field>
          </div>
          {dateBad && <p className="text-xs text-destructive -mt-2 mb-3">The term ends before it starts.</p>}
          {!editing.id && (
            <Field label="Start with">
              <Select value={editing.copy} onChange={(e) => setEditing({ ...editing, copy: e.target.value as any })}>
                <option value="setup">A copy of the setup (grades, sections, teachers, rooms, periods…), empty schedule</option>
                <option value="all">A full copy, including the schedule</option>
                <option value="empty">Nothing (start from scratch)</option>
              </Select>
            </Field>
          )}
          {err && <p role="alert" className="text-sm text-destructive font-medium">{err}</p>}
        </Modal>
      )}
    </Card>
  );
}

// ---------------- ACCOUNTS (server version, admins) ----------------
function AccountsTab() {
  const access = useAccess();
  const accounts = useAccounts(access.mode === "server" && access.isAdmin);
  const act = useAct();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<(Partial<Account> & { password?: string }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ROLE_TEXT: Record<string, string> = { admin: "Admin — everything, including accounts", editor: "Editor — can change schedules and setup", viewer: "Viewer — can only look and print" };

  async function save() {
    if (!editing) return;
    setErr(null);
    try {
      if (editing.id) await request("PUT", `/auth/users/${editing.id}`, { displayName: editing.displayName, role: editing.role, password: editing.password || undefined });
      else await request("POST", "/auth/users", { username: editing.username, displayName: editing.displayName, role: editing.role, password: editing.password });
      await act("GET", "/auth/users", undefined, { invalidate: ["accounts", "auth"], success: "Saved." });
      setEditing(null);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
  }
  async function remove(a: Account) {
    if (await confirm({ title: `Delete ${a.displayName}'s account?`, message: "They won't be able to sign in any more.", confirmLabel: "Delete" }))
      await act("DELETE", `/auth/users/${a.id}`, undefined, { invalidate: ["accounts"], success: "Account deleted." });
  }

  return (
    <Card>
      <div className="flex flex-wrap gap-3 justify-between items-center p-4 border-b border-border">
        <h3 className="font-display font-bold text-brand-forest">Accounts</h3>
        <AddBtn onClick={() => { setErr(null); setEditing({ username: "", displayName: "", role: "editor", password: "" }); }} label="Add person" />
      </div>
      <p className="text-sm text-muted-foreground px-4 py-3 border-b border-border bg-muted/30">Everyone signs in with their own account, so the activity log shows who changed what.</p>
      {(accounts.data ?? []).map((a) => (
        <div key={a.id} className="flex items-center gap-2 px-4 py-3 border-b border-border last:border-0">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-brand-forest truncate">{a.displayName}{a.id === access.user?.id && <span className="text-xs text-muted-foreground font-normal"> (you)</span>}</p>
            <p className="text-sm text-muted-foreground">{a.username} · <span className="capitalize">{a.role}</span></p>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${a.displayName}`} onClick={() => { setErr(null); setEditing({ ...a, password: "" }); }}><Pencil className="size-4" /></Button>
          {a.id !== access.user?.id && <Button size="icon-sm" variant="ghost" aria-label={`Delete ${a.displayName}`} onClick={() => remove(a)} className="text-destructive hover:text-destructive"><Trash2 className="size-4" /></Button>}
        </div>
      ))}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? `Edit ${editing.displayName}` : "Add person"}
          footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={!editing.displayName?.trim() || (!editing.id && (!editing.username?.trim() || (editing.password?.length ?? 0) < 8)) || (!!editing.password && editing.password.length < 8)} className="bg-brand text-white hover:bg-brand-mid">Save</Button></>}>
          <Field label="Name"><Input value={editing.displayName ?? ""} onChange={(e) => setEditing({ ...editing, displayName: e.target.value })} placeholder="Ms. Santos" autoFocus /></Field>
          {!editing.id && <Field label="Username" hint="Letters, numbers, dots or dashes"><Input value={editing.username ?? ""} onChange={(e) => setEditing({ ...editing, username: e.target.value })} autoCapitalize="none" /></Field>}
          <Field label="Role">
            <Select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as Account["role"] })}>
              {(["admin", "editor", "viewer"] as const).map((r) => <option key={r} value={r}>{ROLE_TEXT[r]}</option>)}
            </Select>
          </Field>
          <Field label={editing.id ? "New password (leave empty to keep)" : "Password (8+ characters)"} hint={editing.id ? "Setting one signs them out everywhere." : "Give it to them privately; they can change it after signing in."}>
            <Input type="password" autoComplete="new-password" value={editing.password ?? ""} onChange={(e) => setEditing({ ...editing, password: e.target.value })} />
          </Field>
          {err && <p role="alert" className="text-sm text-destructive font-medium">{err}</p>}
        </Modal>
      )}
    </Card>
  );
}

// ---------------- ACTIVITY LOG ----------------
function ActivityTab() {
  const [limit, setLimit] = useState(100);
  const audit = useAudit(limit);
  const [names, setNames] = useState<Record<string, string>>({});
  const rows = audit.data ?? [];
  // claude.ai version: people are stored as private ids; ask the platform for their names.
  useEffect(() => {
    const ids = [...new Set(rows.map((r) => r.user).filter((u): u is string => !!u && u.startsWith("u:")).map((u) => u.slice(2)))].filter((id) => !(id in names));
    if (!ids.length) return;
    viewerNames(ids).then((m) => setNames((cur) => ({ ...cur, ...m })));
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const who = (u: string | null) => (!u ? (HOSTED ? "Someone" : "System") : u.startsWith("u:") ? names[u.slice(2)] || "Someone with access" : u);
  const fmt = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <Card>
      <div className="p-4 border-b border-border">
        <h3 className="font-display font-bold text-brand-forest">Activity Log</h3>
        <p className="text-sm text-muted-foreground mt-0.5">Who changed what, newest first.</p>
      </div>
      {audit.isLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
      {!audit.isLoading && rows.length === 0 && <EmptyState icon={<ScrollText className="size-10" />} title="Nothing yet" hint="Changes will show up here." />}
      {rows.map((r) => (
        <div key={r.id} className="px-4 py-2.5 border-b border-border last:border-0 flex flex-col sm:flex-row sm:items-baseline gap-x-3">
          <span className="text-xs text-muted-foreground sm:w-40 shrink-0">{fmt(r.at)}</span>
          <span className="text-sm min-w-0"><b className="text-brand-forest">{who(r.user)}</b> · {r.action}{r.details ? <span className="text-muted-foreground"> — {r.details}</span> : null}</span>
        </div>
      ))}
      {rows.length >= limit && limit < 500 && <div className="p-3 text-center"><Button variant="outline" size="sm" onClick={() => setLimit((n) => Math.min(500, n + 200))}>Show more</Button></div>}
    </Card>
  );
}
