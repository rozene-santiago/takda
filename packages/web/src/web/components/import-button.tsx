// "Import" button for CSV or Excel files. The rows go to one of the API's
// import endpoints, which checks every row and reports the ones it skipped.
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/lib/confirm";
import { request } from "@/lib/api";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [], field = "", inQ = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // Excel's UTF-8 marker
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field); field = "";
        if (cur.some((x) => x.trim() !== "")) rows.push(cur);
        cur = [];
      } else field += c;
    }
  }
  if (field !== "" || cur.length) { cur.push(field); if (cur.some((x) => x.trim() !== "")) rows.push(cur); }
  return rows;
}

async function readRows(file: File): Promise<string[][]> {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
    return rows.map((r) => r.map((c) => String(c ?? ""))).filter((r) => r.some((c) => c.trim() !== ""));
  }
  return parseCsv(await file.text());
}

export function ImportButton({ endpoint, onRows, headerHints, itemLabel = "row", label = "Import", disabled }: {
  endpoint?: string;
  onRows?: (rows: string[][]) => Promise<{ added: number; errors: string[] }>;
  headerHints: string[];
  itemLabel?: string;
  label?: string;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const qc = useQueryClient();
  const info = (title: string, message: string) => confirm({ title, message, confirmLabel: "OK", destructive: false, hideCancel: true });

  const handle = async (file: File) => {
    setBusy(true);
    try {
      const all = await readRows(file);
      if (!all.length) { await info("Nothing imported", "The file appears to be empty."); return; }
      const first = all[0].map((c) => c.trim().toLowerCase());
      const hasHeader = headerHints.some((h) => first.some((f) => f.includes(h)));
      const rows = hasHeader ? all.slice(1) : all;
      const res = onRows ? await onRows(rows) : await request<{ added: number; errors: string[] }>("POST", endpoint!, { rows });
      await qc.invalidateQueries();
      const plural = res.added === 1 ? itemLabel : `${itemLabel}s`;
      const shown = res.errors.slice(0, 25);
      await info("Import complete", `Imported ${res.added} ${plural}.` + (res.errors.length ? `\n\n${res.errors.length} row${res.errors.length === 1 ? "" : "s"} need attention:\n${shown.join("\n")}${res.errors.length > shown.length ? `\n…and ${res.errors.length - shown.length} more` : ""}` : ""));
    } catch (e: any) {
      await info("Import failed", e?.message ?? "Unknown error.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = ""; }} />
      <Button variant="outline" disabled={disabled || busy} onClick={() => fileRef.current?.click()} title="CSV or Excel file">
        <Upload className="size-4" />{busy ? "Importing…" : label}
      </Button>
    </>
  );
}
