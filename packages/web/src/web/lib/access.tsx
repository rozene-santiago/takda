// Who is using the app and what they may do.
//  - Server version: signed-in account with a role (admin / editor / viewer).
//  - claude.ai version: the platform's sharing decides; people who can only
//    view the page get a read-only app.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request, setViewerTag, HOSTED } from "./api";
import { onUnauthorized } from "./api-core";
import type { AuthStatus, Account } from "./types";

export interface Access {
  loading: boolean;
  mode: "server" | "local";
  needsSetup: boolean;
  user: Account | null;
  readOnly: boolean;
  reason: "viewer" | "shared-view" | null;
  isAdmin: boolean;
  emailEnabled: boolean;
}

const Ctx = createContext<Access>({ loading: true, mode: "local", needsSetup: false, user: null, readOnly: false, reason: null, isAdmin: true, emailEnabled: false });
export const useAccess = () => useContext(Ctx);

let claudeUser: any = null;
/** claude.ai version: names for the opaque viewer ids stored in the activity log. */
export async function viewerNames(ids: string[]): Promise<Record<string, string>> {
  if (!claudeUser || !ids.length) return {};
  try {
    if (typeof claudeUser.profiles !== "function") return {};
    const ps = await claudeUser.profiles(ids);
    const out: Record<string, string> = {};
    for (const id of ids) out[id] = ps[id]?.name || "";
    return out;
  } catch { return {}; }
}

export function AccessProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["auth"], queryFn: () => request<AuthStatus>("GET", "/auth/status"), retry: false, staleTime: 60_000 });
  const [sharedView, setSharedView] = useState(false);

  useEffect(() => onUnauthorized(() => { qc.invalidateQueries({ queryKey: ["auth"] }); }), [qc]);

  // claude.ai: who is viewing, and can they change shared data?
  useEffect(() => {
    if (!HOSTED) return;
    const c = (window as any).claude;
    if (!c?.use) return;
    let alive = true;
    c.use("user").then(async (u: any) => {
      if (!alive || !u) return;
      claudeUser = u;
      const call = async (fn: string, ...args: unknown[]) => { try { return typeof u[fn] === "function" ? await u[fn](...args) : null; } catch { return null; } };
      const [id, canWrite] = await Promise.all([call("id"), call("can", "data.write")]);
      if (!alive) return;
      if (id) setViewerTag(`u:${id}`);
      if (canWrite === false) setSharedView(true);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const d = status.data;
  const user = d?.user ?? null;
  const viewer = d?.mode === "server" && user?.role === "viewer";
  const value: Access = {
    loading: status.isLoading,
    mode: d?.mode ?? "local",
    needsSetup: !!d?.needsSetup,
    user,
    readOnly: viewer || sharedView,
    reason: viewer ? "viewer" : sharedView ? "shared-view" : null,
    isAdmin: d?.mode !== "server" || user?.role === "admin",
    emailEnabled: !!d?.email,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
