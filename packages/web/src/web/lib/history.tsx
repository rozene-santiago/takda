// Undo / redo for every change (schedule and setup). The history is kept by
// the API in the database, so it survives a refresh and works on every page.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "./api";
import { onApiChange } from "./api-core";
import { notify } from "./save-file";
import type { HistoryState as Server } from "./types";

interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  busy: boolean;
  /** Kept for older call sites; history is now recorded automatically. */
  record: (_current?: unknown) => void;
}

const Ctx = createContext<HistoryState | null>(null);

export function HistoryProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["history"], queryFn: () => request<Server>("GET", "/history"), staleTime: 5_000 });
  const [busy, setBusy] = useState(false);

  // Any change through the API refreshes the undo state and activity log.
  useEffect(() => onApiChange(() => {
    qc.invalidateQueries({ queryKey: ["history"] });
    qc.invalidateQueries({ queryKey: ["audit"] });
  }), [qc]);

  const run = useCallback(async (kind: "undo" | "redo") => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await request<{ label: string }>("POST", `/history/${kind}`);
      await qc.invalidateQueries();
      notify(`${kind === "undo" ? "Undid" : "Redid"}: ${r.label}`);
    } catch (e: any) {
      notify(e?.message ?? String(e), "error");
    } finally {
      setBusy(false);
    }
  }, [busy, qc]);

  const undo = useCallback(() => run("undo"), [run]);
  const redo = useCallback(() => run("redo"), [run]);

  // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl+Y = redo (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) { e.preventDefault(); void undo(); }
      else if ((key === "z" && e.shiftKey) || key === "y") { e.preventDefault(); void redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const value = useMemo<HistoryState>(() => ({
    canUndo: !!q.data?.undo,
    canRedo: !!q.data?.redo,
    undoLabel: q.data?.undo?.label ?? null,
    redoLabel: q.data?.redo?.label ?? null,
    undo, redo, busy,
    record: () => {},
  }), [q.data, undo, redo, busy]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHistory() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useHistory must be used within HistoryProvider");
  return ctx;
}
