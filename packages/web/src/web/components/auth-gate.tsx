// Server version: sign-in screen, and the one-time "create the admin account"
// screen on a fresh install. The claude.ai version has no accounts and
// passes straight through.
import { useState, type ReactNode, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LogIn, ShieldCheck } from "lucide-react";
import { useAccess } from "@/lib/access";
import { request } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function AuthGate({ children }: { children: ReactNode }) {
  const access = useAccess();
  if (access.mode !== "server") return <>{access.loading ? <Splash /> : children}</>;
  if (access.loading) return <Splash />;
  if (access.needsSetup) return <AuthScreen kind="setup" />;
  if (!access.user) return <AuthScreen kind="login" />;
  return <>{children}</>;
}

function Splash() {
  return <div className="min-h-dvh grid place-items-center bg-brand-cream text-muted-foreground text-sm">Loading…</div>;
}

function AuthScreen({ kind }: { kind: "login" | "setup" }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setup = kind === "setup";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (setup && password !== password2) { setErr("The two passwords don't match."); return; }
    setBusy(true);
    try {
      await request("POST", setup ? "/auth/setup" : "/auth/login", setup ? { username, displayName, password } : { username, password });
      await qc.invalidateQueries();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full h-11 rounded-lg border border-input bg-white px-3 text-base outline-none focus:border-brand-mid focus:ring-2 focus:ring-brand-mid/30";
  return (
    <div className="min-h-dvh grid place-items-center bg-brand-cream px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-sm bg-card rounded-2xl shadow-xl border border-border overflow-hidden">
        <div className="bg-brand-forest text-white px-6 py-5 flex items-center gap-3">
          <img src={import.meta.env.BASE_URL + "logo-crest-white.png"} alt="" className="h-10 w-auto" />
          <div>
            <p className="font-display text-xl font-extrabold tracking-tight">TAKDÁ</p>
            <p className="text-[11px] text-white/60">DLSU-D Basic Education Class Scheduler</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <h1 className="font-display text-lg font-bold text-brand-forest flex items-center gap-2">
              {setup ? <><ShieldCheck className="size-5" /> Create the admin account</> : <><LogIn className="size-5" /> Sign in</>}
            </h1>
            {setup && <p className="text-sm text-muted-foreground mt-1">This is a new install. The first account can add other people later (Setup → Accounts).</p>}
          </div>
          {setup && (
            <label className="block">
              <span className="block text-sm font-semibold mb-1">Your name</span>
              <input className={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Ms. Santos" autoComplete="name" />
            </label>
          )}
          <label className="block">
            <span className="block text-sm font-semibold mb-1">Username</span>
            <input className={input} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus required />
          </label>
          <label className="block">
            <span className="block text-sm font-semibold mb-1">Password{setup ? " (8+ characters)" : ""}</span>
            <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup ? "new-password" : "current-password"} required />
          </label>
          {setup && (
            <label className="block">
              <span className="block text-sm font-semibold mb-1">Password again</span>
              <input className={input} type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
            </label>
          )}
          {err && <p role="alert" className="text-sm font-medium text-destructive">{err}</p>}
          <Button type="submit" disabled={busy || !username || !password} className="w-full h-11 bg-brand text-white hover:bg-brand-mid text-base">
            {busy ? "Please wait…" : setup ? "Create account" : "Sign in"}
          </Button>
          {!setup && <p className="text-xs text-muted-foreground text-center">Forgot your password? Ask an admin to reset it.</p>}
        </div>
      </form>
    </div>
  );
}
