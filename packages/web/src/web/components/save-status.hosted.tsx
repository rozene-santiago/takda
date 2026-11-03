// Hosted build only: small save indicator + backup download/restore, and a
// bridge that refreshes all data when another device saves.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { zipSync, unzipSync } from "fflate";
import { getSaveState, onSaveState, onRemoteChange, exportBytes, importBytes, ready } from "../../api/database/browser";
import { saveFile, notify } from "../lib/save-file";
import { useConfirm } from "../lib/confirm";
import { Modal } from "./ui/primitives";
import { Button } from "./ui/button";
import { DatabaseBackup, Download, Upload } from "lucide-react";
import { useLocked } from "../lib/hooks";

const SQLITE_MAGIC = "SQLite format 3\u0000";
function isSqlite(b: Uint8Array | undefined): b is Uint8Array {
  if (!b || b.length < 100) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) if (b[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  return true;
}

const LABEL: Record<string, string> = {
  loading: "Loading…",
  saved: "All changes saved",
  saving: "Saving…",
  "local-only": "Saved in this browser only",
  error: "Not saved",
};

/** Download / restore actions shared by the corner badge and the menu dialog. */
function useBackupActions(onDone: () => void) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  // The backup is the raw SQLite file, zipped (the artifact download prompt
  // accepts .zip but not .db). The same .db works with the self-hosted server.
  const download = async () => {
    const zipped = zipSync({ "scheduler.db": exportBytes() }, { level: 6 });
    const outcome = await saveFile(`class-scheduler-backup-${new Date().toISOString().slice(0, 10)}.zip`, new Blob([zipped as BlobPart], { type: "application/zip" }));
    if (outcome === "saved") onDone();
  };
  const restore = async (f: File) => {
    let bytes: Uint8Array = new Uint8Array(await f.arrayBuffer());
    try {
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        const files = unzipSync(bytes);
        const name = Object.keys(files).find((n) => isSqlite(files[n]));
        if (!name) throw new Error("That zip file has no scheduler database inside.");
        bytes = files[name];
      }
      if (!isSqlite(bytes)) throw new Error("That file isn't a scheduler backup. Choose the .zip (or .db) file made by Download backup.");
    } catch (e: any) {
      notify(e?.message ?? "Could not read that file.", "error");
      return;
    }
    const ok = await confirm({
      title: "Restore from backup?",
      message: `Everything currently in the scheduler will be replaced with the contents of "${f.name}". Download a backup first if you might need the current data.`,
      confirmLabel: "Replace all data",
    });
    if (!ok) return;
    importBytes(bytes);
    await qc.invalidateQueries();
    onDone();
    notify("Backup restored.");
  };
  return { download, restore };
}

const ACCEPT = ".zip,.db,.sqlite,application/zip,application/octet-stream";
const dotColor = (state: string) => state === "saved" ? "#16a34a" : state === "error" ? "#dc2626" : state === "local-only" ? "#d97706" : "#64748b";

export function SaveStatus() {
  const qc = useQueryClient();
  const s = useSyncExternalStore(onSaveState, getSaveState, getSaveState);
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { download, restore } = useBackupActions(() => setOpen(false));
  const locked = useLocked();

  useEffect(() => onRemoteChange(() => qc.invalidateQueries()), [qc]);
  useEffect(() => { ready.then(() => qc.invalidateQueries()); }, [qc]);

  return (
    <div className="print:hidden" style={{ position: "fixed", right: "calc(env(safe-area-inset-right, 0px) + 12px)", bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)", zIndex: 35, fontSize: 12 }}>
      {open && (
        <div style={{ background: "white", color: "#1f2937", border: "1px solid #e5e7eb", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.15)", padding: 12, marginBottom: 8, width: 240, maxWidth: "calc(100vw - 24px)" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{LABEL[s.state]}</div>
          {s.detail && <div style={{ color: "#b91c1c", marginBottom: 6 }}>{s.detail}</div>}
          {s.state === "local-only" && <div style={{ color: "#6b7280", marginBottom: 6 }}>Shared storage isn't available here, so data is kept in this browser. Download a backup to be safe.</div>}
          <button onClick={download} style={btn}>Download backup (.zip)</button>
          {!locked && <button onClick={() => fileRef.current?.click()} style={btn}>Restore from backup…</button>}
          <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ""; }} />
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} title="Save status & backups"
        style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", background: "white", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 999, padding: "5px 10px", boxShadow: "0 2px 8px rgba(0,0,0,.08)", cursor: "pointer" }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: dotColor(s.state) }} />
        {LABEL[s.state]}
      </button>
    </div>
  );
}

/** Sidebar entry: save status plus a "Backup & restore" dialog in the middle of the screen. */
export function SidebarBackupButton({ onOpen }: { onOpen?: () => void }) {
  const s = useSyncExternalStore(onSaveState, getSaveState, getSaveState);
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { download, restore } = useBackupActions(() => setOpen(false));
  const locked = useLocked();
  return (
    <>
      <button onClick={() => { onOpen?.(); setOpen(true); }}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold text-white/55 hover:text-white hover:bg-white/8 transition text-left">
        <DatabaseBackup className="size-[18px] shrink-0" />
        <span className="min-w-0">
          <span className="block">Backup &amp; restore</span>
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-white/45">
            <span className="size-1.5 rounded-full shrink-0" style={{ background: dotColor(s.state) }} />{LABEL[s.state]}
          </span>
        </span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Backup & restore">
        <div className="space-y-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-brand-forest">
            <span className="size-2 rounded-full" style={{ background: dotColor(s.state) }} />{LABEL[s.state]}
          </p>
          {s.detail && <p className="text-destructive">{s.detail}</p>}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <p className="font-semibold text-foreground">Download backup</p>
            <p className="text-muted-foreground">Saves everything as a .zip file. Inside is <span className="font-mono text-xs">scheduler.db</span>, the same file the Windows / self-hosted version uses.</p>
            <Button onClick={download} className="bg-brand text-white hover:bg-brand-mid"><Download className="size-4" /> Download backup (.zip)</Button>
          </div>
          {!locked && <div className="rounded-lg border border-border p-3 space-y-2">
            <p className="font-semibold text-foreground">Restore from backup</p>
            <p className="text-muted-foreground">Replaces all current data with a .zip or .db backup. You'll be asked to confirm.</p>
            <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="size-4" /> Choose backup file…</Button>
            <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ""; }} />
          </div>}
          {locked && <p className="text-xs text-muted-foreground">Restoring is turned off while changes are locked or you have view-only access.</p>}
        </div>
      </Modal>
    </>
  );
}

const btn: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#f9fafb", marginTop: 6, cursor: "pointer" };
