import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Settings2, ArrowUp, ArrowDown, Eye, EyeOff, RotateCcw, Lock, Unlock, KeyRound, Menu, X, LogOut, CalendarRange, Eye as EyeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useConflicts, useSettings, useUpdateSettings, useLock, useUnlock, useChangeLockPassword, useTerms } from "@/lib/hooks";
import { useAccess } from "@/lib/access";
import { request } from "@/lib/api";
import { notify } from "@/lib/save-file";
import { openSetupTab } from "@/lib/nav";
import { useQueryClient } from "@tanstack/react-query";
import { resolveNavConfig, resolveNavConfigFull, navMetaFor, DEFAULT_NAV_CONFIG } from "@/lib/nav";
import type { TabConfigItem } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/primitives";
import { SidebarBackupButton } from "./save-status";

// Menus hidden while in lockdown (read-only) mode.
const LOCK_HIDDEN_KEYS = new Set(["allocations", "teachers", "setup", "loads"]);

export function Layout({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { data } = useConflicts();
  const settings = useSettings();
  const [arrange, setArrange] = useState(false);
  const [lockModal, setLockModal] = useState(false);
  const errors = data?.conflicts.filter((c) => c.severity === "error").length ?? 0;
  const access = useAccess();
  const lockdown = !!settings.data?.locked;
  const locked = lockdown || access.readOnly;
  const terms = useTerms();
  const activeTerm = terms.data?.find((t) => t.isActive);
  const [pwModal, setPwModal] = useState(false);
  const qc = useQueryClient();
  const signOut = async () => {
    try { await request("POST", "/auth/logout"); } catch { /* already signed out */ }
    await qc.invalidateQueries({ queryKey: ["auth"] });
  };

  let nav = resolveNavConfig(settings.data?.tabConfig);
  if (locked) nav = nav.filter((n) => !LOCK_HIDDEN_KEYS.has(n.key));

  // Below the lg breakpoint the sidebar becomes a drawer opened from the top bar.
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { setDrawer(false); }, [loc]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);
  const current = nav.find((n) => n.to === loc);

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Top bar (phones & tablets) */}
      <header className="lg:hidden fixed inset-x-0 top-0 z-30 bg-brand-forest text-white pt-[env(safe-area-inset-top,0px)]">
        <div className="h-14 flex items-center gap-2 pr-[max(12px,env(safe-area-inset-right,0px))] pl-[max(8px,env(safe-area-inset-left,0px))]">
          <button onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}
            className="size-10 grid place-items-center rounded-lg hover:bg-white/10 transition">
            <Menu className="size-5" />
          </button>
          <img src={import.meta.env.BASE_URL + "logo-crest-white.png"} alt="" className="h-7 w-auto" />
          <p className="font-display font-extrabold text-base tracking-tight truncate">DLSU-D TAKDÁ</p>
          {current && <p className="text-sm text-white/60 truncate hidden sm:block">· {current.label}</p>}
          {errors > 0 && (
            <Link to="/" className="ml-auto shrink-0 flex items-center gap-1 text-[11px] font-bold bg-destructive text-white rounded-full px-2 py-1" title="Schedule conflicts">
              {errors} conflict{errors !== 1 && "s"}
            </Link>
          )}
          {locked && (access.readOnly
            ? <EyeIcon className={cn("size-4 text-brand-lime shrink-0", errors > 0 ? "ml-1" : "ml-auto")} aria-label="View only" />
            : <Lock className={cn("size-4 text-brand-lime shrink-0", errors > 0 ? "ml-1" : "ml-auto")} aria-label="Locked" />)}
        </div>
      </header>

      {/* Drawer backdrop */}
      {drawer && <div className="lg:hidden fixed inset-0 z-[56] bg-black/40 animate-in fade-in" onClick={() => setDrawer(false)} />}

      {/* Sidebar */}
      <aside className={cn(
        "w-72 max-w-[85vw] lg:w-60 shrink-0 bg-brand-forest text-white flex flex-col fixed inset-y-0 left-0 z-[57] lg:z-30 transition-transform duration-200 ease-out",
        "pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] lg:pl-0",
        drawer ? "translate-x-0 shadow-2xl" : "-translate-x-full lg:translate-x-0",
      )} aria-label="Main menu">
        <div className="px-5 py-6 flex items-center gap-2.5">
          <img src={import.meta.env.BASE_URL + "logo-crest-white.png"} alt="DLSU-D" className="h-10 w-auto" />
          <div className="min-w-0 flex-1">
            <p className="font-display font-extrabold text-lg leading-none tracking-tight">DLSU-D TAKDÁ</p>
            <p className="text-[11px] text-white/50 mt-0.5">DLSU-D Basic Education Class Scheduler</p>
          </div>
          <button onClick={() => setDrawer(false)} aria-label="Close menu"
            className="lg:hidden -mr-2 size-9 grid place-items-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition">
            <X className="size-5" />
          </button>
        </div>
        {activeTerm && (
          <div className="px-5 -mt-3 mb-1">
            {locked ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-lime/90"><CalendarRange className="size-3.5" />{activeTerm.name}</span>
            ) : (
              <Link to="/setup" onClick={() => openSetupTab("terms")} title="Change term"
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-lime/90 hover:text-brand-lime rounded px-1.5 py-0.5 -ml-1.5 hover:bg-white/8">
                <CalendarRange className="size-3.5" />{activeTerm.name}
              </Link>
            )}
          </div>
        )}
        <nav className="flex-1 px-3 space-y-1 mt-2 overflow-y-auto">
          {nav.map(({ key, to, label, icon: Icon }) => {
            const active = loc === to;
            return (
              <Link key={key} to={to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition",
                  active ? "bg-white/15 text-white" : "text-white/65 hover:text-white hover:bg-white/8",
                )}>
                <Icon className="size-[18px]" />
                {label}
                {to === "/" && errors > 0 && (
                  <span className="ml-auto text-[11px] font-bold bg-destructive text-white rounded-full px-1.5 py-0.5">{errors}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 pb-2 space-y-1">
          <SidebarBackupButton onOpen={() => setDrawer(false)} />
          {!locked && (
            <button onClick={() => { setDrawer(false); setArrange(true); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold text-white/55 hover:text-white hover:bg-white/8 transition">
              <Settings2 className="size-[18px]" />
              Arrange menu
            </button>
          )}
          {!access.readOnly && (
            <button onClick={() => { setDrawer(false); setLockModal(true); }}
              className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition",
                lockdown ? "bg-brand-lime/20 text-brand-lime hover:bg-brand-lime/30" : "text-white/55 hover:text-white hover:bg-white/8")}>
              {lockdown ? <Lock className="size-[18px]" /> : <Unlock className="size-[18px]" />}
              {lockdown ? "Locked — tap to unlock" : "Lock changes"}
            </button>
          )}
        </div>
        {access.mode === "server" && access.user && (
          <div className="mx-3 mb-2 rounded-lg bg-white/5 px-3 py-2.5">
            <p className="text-sm font-semibold truncate">{access.user.displayName}</p>
            <p className="text-[11px] text-white/50 capitalize">{access.user.role}</p>
            <div className="flex gap-1 mt-1.5 -ml-1.5">
              <button onClick={() => { setDrawer(false); setPwModal(true); }} className="text-[12px] text-white/70 hover:text-white rounded px-1.5 py-1 hover:bg-white/8 inline-flex items-center gap-1"><KeyRound className="size-3.5" />Password</button>
              <button onClick={signOut} className="text-[12px] text-white/70 hover:text-white rounded px-1.5 py-1 hover:bg-white/8 inline-flex items-center gap-1"><LogOut className="size-3.5" />Sign out</button>
            </div>
          </div>
        )}
        <div className="px-5 py-4 border-t border-white/10">
          <p className="text-[11px] text-white/40">© Copyright 2026. All Rights Reserved. | rozene.santiago</p>
          <p className="text-[10px] text-white/35 mt-0.5">ver. 3.00 build 10.28.2026</p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 lg:ml-60 min-h-screen pt-[calc(3.5rem+env(safe-area-inset-top,0px))] lg:pt-0 pb-14 lg:pb-0 pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] lg:pl-0">
        {locked && (
          <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] lg:top-0 z-20 flex items-center gap-2 bg-brand-forest text-white px-4 sm:px-6 py-2 text-sm font-semibold border-t border-white/10 lg:border-t-0">
            {access.readOnly ? <EyeIcon className="size-4 text-brand-lime shrink-0" /> : <Lock className="size-4 text-brand-lime shrink-0" />}
            <span className="min-w-0">
              {access.reason === "viewer" ? "View-only account — you can look at schedules but not change them."
                : access.reason === "shared-view" ? "View only — ask the owner for edit access to make changes."
                : <><span className="hidden sm:inline">Lockdown mode — schedule is read-only. Editing menus and actions are disabled.</span><span className="sm:hidden">Locked — read-only</span></>}
            </span>
            {!access.readOnly && <button onClick={() => setLockModal(true)} className="ml-auto shrink-0 underline underline-offset-2 hover:text-brand-lime">Unlock</button>}
          </div>
        )}
        {children}
      </main>

      {arrange && <ArrangeMenu onClose={() => setArrange(false)} stored={settings.data?.tabConfig} />}
      {lockModal && <LockModal onClose={() => setLockModal(false)} locked={lockdown} hasPassword={!!settings.data?.hasLockPassword} />}
      {pwModal && <PasswordModal onClose={() => setPwModal(false)} />}
    </div>
  );
}

function LockModal({ onClose, locked, hasPassword }: { onClose: () => void; locked: boolean; hasPassword: boolean }) {
  const lock = useLock();
  const unlock = useUnlock();
  const changePw = useChangeLockPassword();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [nextPw, setNextPw] = useState("");

  const doLock = () => {
    setErr(null);
    if (!pw) return setErr("Enter a password.");
    if (!hasPassword && pw !== confirm) return setErr("Passwords don't match.");
    lock.mutate(pw, { onSuccess: onClose, onError: (e) => setErr((e as Error).message) });
  };
  const doUnlock = () => {
    setErr(null);
    if (!pw) return setErr("Enter the password.");
    unlock.mutate(pw, { onSuccess: onClose, onError: (e) => setErr((e as Error).message) });
  };
  const doChange = () => {
    setErr(null);
    if (!nextPw) return setErr("Enter a new password.");
    changePw.mutate({ current: curPw || undefined, next: nextPw },
      { onSuccess: () => { setChanging(false); setCurPw(""); setNextPw(""); setErr(null); }, onError: (e) => setErr((e as Error).message) });
  };

  const busy = lock.isPending || unlock.isPending || changePw.isPending;
  const inputCls = "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand";

  return (
    <Modal open onClose={onClose}
      title={locked ? "Unlock changes" : "Lock changes"}
      footer={
        <>
          {!changing && (locked
            ? <Button variant="outline" onClick={() => setChanging(true)} className="mr-auto gap-1.5"><KeyRound className="size-4" /> Change password</Button>
            : hasPassword ? <Button variant="outline" onClick={() => setChanging(true)} className="mr-auto gap-1.5"><KeyRound className="size-4" /> Change password</Button> : null)}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {changing
            ? <Button onClick={doChange} disabled={busy} className="bg-brand text-white hover:bg-brand-mid">Save password</Button>
            : locked
              ? <Button onClick={doUnlock} disabled={busy} className="bg-brand text-white hover:bg-brand-mid gap-1.5"><Unlock className="size-4" /> Unlock</Button>
              : <Button onClick={doLock} disabled={busy} className="bg-brand text-white hover:bg-brand-mid gap-1.5"><Lock className="size-4" /> Lock</Button>}
        </>
      }>
      {changing ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Set a new lockdown password.</p>
          {hasPassword && (
            <div>
              <label className="text-xs font-semibold text-brand-forest">Current password</label>
              <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} className={inputCls} autoFocus />
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-brand-forest">New password</label>
            <input type="password" value={nextPw} onChange={(e) => setNextPw(e.target.value)} className={inputCls} />
          </div>
        </div>
      ) : locked ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Enter the password to exit lockdown mode and re-enable editing.</p>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" className={inputCls} autoFocus
            onKeyDown={(e) => e.key === "Enter" && doUnlock()} />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Lockdown mode makes all data <strong>read-only</strong>. It hides Allocations, Teachers, Setup and the Arrange menu, and greys out auto-fill, clear and delete.
          </p>
          <div>
            <label className="text-xs font-semibold text-brand-forest">{hasPassword ? "Password" : "Create a password"}</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" className={inputCls} autoFocus
              onKeyDown={(e) => hasPassword && e.key === "Enter" && doLock()} />
          </div>
          {!hasPassword && (
            <div>
              <label className="text-xs font-semibold text-brand-forest">Confirm password</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" className={inputCls}
                onKeyDown={(e) => e.key === "Enter" && doLock()} />
            </div>
          )}
        </div>
      )}
      {err && <p className="text-sm text-destructive mt-3 font-medium">{err}</p>}
    </Modal>
  );
}

function ArrangeMenu({ onClose, stored }: { onClose: () => void; stored?: { key: string; visible: boolean }[] | null }) {
  const update = useUpdateSettings();
  const [items, setItems] = useState<TabConfigItem[]>(() => resolveNavConfigFull(stored));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };
  const toggle = (i: number) => {
    if (items[i].key === "index") return; // Schedule always visible
    const next = items.slice();
    next[i] = { ...next[i], visible: !next[i].visible };
    setItems(next);
  };
  const reset = () => setItems(DEFAULT_NAV_CONFIG.map((d) => ({ ...d })));
  const save = () => update.mutate({ tabConfig: items }, { onSuccess: onClose });

  const visibleCount = items.filter((i) => i.visible).length;

  return (
    <Modal open onClose={onClose} title="Arrange sidebar menu"
      footer={
        <>
          <Button variant="outline" onClick={reset} className="mr-auto gap-1.5"><RotateCcw className="size-4" /> Reset</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={update.isPending} className="bg-brand text-white hover:bg-brand-mid">Save</Button>
        </>
      }>
      <p className="text-sm text-muted-foreground mb-3">
        Reorder items and show/hide them in the sidebar. Order &amp; visibility sync with the mobile app. Schedule always stays visible.
      </p>
      <div className="space-y-1.5">
        {items.map((it, i) => {
          const meta = navMetaFor(it.key);
          if (!meta) return null;
          const Icon = meta.icon;
          const locked = it.key === "index";
          return (
            <div key={it.key}
              className={cn("flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 bg-white",
                !it.visible && "opacity-55")}>
              <Icon className="size-[18px] text-brand shrink-0" />
              <span className="flex-1 font-semibold text-brand-forest truncate">{meta.label}</span>

              <div className="flex items-center gap-0.5">
                <button onClick={() => move(i, -1)} disabled={i === 0}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent" title="Move up">
                  <ArrowUp className="size-4" />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === items.length - 1}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent" title="Move down">
                  <ArrowDown className="size-4" />
                </button>
                <button onClick={() => toggle(i)} disabled={locked}
                  className={cn("p-1.5 rounded-md ml-1", locked ? "text-muted-foreground/40 cursor-not-allowed" : it.visible ? "text-brand hover:bg-brand-sage/20" : "text-muted-foreground hover:bg-muted")}
                  title={locked ? "Always visible" : it.visible ? "Hide" : "Show"}>
                  {it.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-3">{visibleCount} of {items.length} shown</p>
    </Modal>
  );
}

export { PageHeader, UndoRedo, Page } from "./page";

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setErr(null); setBusy(true);
    try { await request("POST", "/auth/password", { current, next }); notify("Password changed."); onClose(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };
  const inputCls = "w-full rounded-lg border border-border px-3 py-2 text-base sm:text-sm outline-none focus:border-brand";
  return (
    <Modal open onClose={onClose} title="Change your password"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !current || next.length < 8} className="bg-brand text-white hover:bg-brand-mid">Save password</Button></>}>
      <div className="space-y-3">
        <div><label htmlFor="pw-current" className="text-xs font-semibold text-brand-forest">Current password</label><input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputCls} autoFocus /></div>
        <div><label htmlFor="pw-next" className="text-xs font-semibold text-brand-forest">New password (8+ characters)</label><input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputCls} /></div>
        {err && <p className="text-sm text-destructive font-medium">{err}</p>}
      </div>
    </Modal>
  );
}
