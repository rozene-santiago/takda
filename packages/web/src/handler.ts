// Request handling for the server version: logins and roles, teacher share
// links (/s/<token>) and the API. Used by server.ts (production) and by the
// Vite dev plugin (`bun run dev`), so both behave the same.
//   admin  – everything, including user accounts
//   editor – can change schedules and setup
//   viewer – can look, not change
// The first person to open a fresh install creates the admin account.
import { eq, lt } from "drizzle-orm";
import app from "./api";
import { db, ready } from "./api/database";
import * as schema from "./api/database/schema";
import { hashPassword, verifyPassword, randomToken } from "./api/lib/crypto";
import { teacherWeek, teacherPage, teacherIcs, smtpConfigured, sendTeacherEmails } from "./server-share";

const COOKIE = "takda_session";
const SESSION_MS = 30 * 24 * 3600 * 1000;
const ROLES = ["admin", "editor", "viewer"] as const;
type Role = (typeof ROLES)[number];
type User = typeof schema.users.$inferSelect;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
const publicUser = (u: User) => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role as Role });

function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}
function isHttps(req: Request) {
  return new URL(req.url).protocol === "https:" || (req.headers.get("x-forwarded-proto") ?? "").includes("https");
}
function sessionCookie(req: Request, token: string, maxAgeSec: number) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isHttps(req) ? "; Secure" : ""}`;
}
function baseUrl(req: Request): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return host ? `${isHttps(req) ? "https" : "http"}://${host}` : new URL(req.url).origin;
}

async function userCount() { return (await db.select({ id: schema.users.id }).from(schema.users)).length; }
async function currentUser(req: Request): Promise<User | null> {
  const token = getCookie(req, COOKIE);
  if (!token) return null;
  const s = (await db.select().from(schema.sessions).where(eq(schema.sessions.token, token)))[0];
  if (!s || s.expiresAt < Date.now()) return null;
  return (await db.select().from(schema.users).where(eq(schema.users.id, s.userId)))[0] ?? null;
}
async function startSession(req: Request, user: User) {
  const token = randomToken(32);
  await db.insert(schema.sessions).values({ token, userId: user.id, expiresAt: Date.now() + SESSION_MS });
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, Date.now()));
  return json({ user: publicUser(user) }, 200, { "Set-Cookie": sessionCookie(req, token, SESSION_MS / 1000) });
}
async function log(user: string | null, action: string, details = "") {
  await db.insert(schema.auditLog).values({ at: Date.now(), user, action, details });
}

// Slow down password guessing: 5 failures in 10 minutes locks that name/address for 5 minutes.
const failures = new Map<string, { count: number; first: number; until: number }>();
function blocked(key: string) { const f = failures.get(key); return !!f && f.until > Date.now(); }
function fail(key: string) {
  const now = Date.now();
  const f = failures.get(key);
  if (!f || now - f.first > 10 * 60_000) { failures.set(key, { count: 1, first: now, until: 0 }); return; }
  f.count++;
  if (f.count >= 5) f.until = now + 5 * 60_000;
}

// The first (admin) account can only be created from this computer or the local
// network, not through a public tunnel, so a stranger can't claim a new install.
const peers = new WeakMap<Request, string>();
function fromLocalNetwork(req: Request): boolean {
  if (process.env.ALLOW_REMOTE_SETUP === "1") return true;
  if (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip")) return false;
  const ip = (peers.get(req) ?? "").replace(/^::ffff:/, "");
  return ip === "" || ip === "::1" || /^127\./.test(ip) || /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^f[cd][0-9a-f]{2}:/i.test(ip);
}

function validPassword(p: unknown) { return typeof p === "string" && p.length >= 8; }
function validUsername(u: unknown) { return typeof u === "string" && /^[a-zA-Z0-9._@-]{3,40}$/.test(u.trim()); }

async function handleAuth(req: Request, path: string): Promise<Response> {
  const method = req.method;
  const body: any = method === "GET" ? null : await req.json().catch(() => ({}));
  const me = await currentUser(req);

  if (path === "/api/auth/status") {
    return json({ mode: "server", needsSetup: (await userCount()) === 0, user: me ? publicUser(me) : null, email: smtpConfigured() });
  }
  if (path === "/api/auth/setup" && method === "POST") {
    if ((await userCount()) > 0) return json({ error: "Setup is already done. Sign in instead." }, 400);
    if (!fromLocalNetwork(req)) return json({ error: "For safety, create the admin account on the computer that runs the scheduler (open http://localhost:4200 there), or from a computer on the same network. Hosting it online? Set ALLOW_REMOTE_SETUP=1 on the server until the admin account exists." }, 403);
    if (!validUsername(body.username)) return json({ error: "Username: 3–40 letters, numbers, dots or dashes." }, 400);
    if (!validPassword(body.password)) return json({ error: "Use a password of at least 8 characters." }, 400);
    const [u] = await db.insert(schema.users).values({ username: body.username.trim().toLowerCase(), displayName: String(body.displayName || body.username).trim(), role: "admin", passwordHash: await hashPassword(body.password) }).returning();
    await log(u.displayName, "Created the admin account");
    return startSession(req, u);
  }
  if (path === "/api/auth/login" && method === "POST") {
    const username = String(body.username ?? "").trim().toLowerCase();
    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "local";
    const key = `${username}|${ip}`;
    if (blocked(key)) return json({ error: "Too many tries. Wait 5 minutes, then try again." }, 429);
    const u = (await db.select().from(schema.users).where(eq(schema.users.username, username)))[0];
    if (!u || !(await verifyPassword(String(body.password ?? ""), u.passwordHash))) {
      fail(key);
      return json({ error: "Wrong username or password." }, 401);
    }
    failures.delete(key);
    return startSession(req, u);
  }
  if (path === "/api/auth/logout" && method === "POST") {
    const token = getCookie(req, COOKIE);
    if (token) await db.delete(schema.sessions).where(eq(schema.sessions.token, token));
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(req, "", 0) });
  }
  if (!me) return json({ error: "Please sign in." }, 401);

  if (path === "/api/auth/password" && method === "POST") {
    if (!(await verifyPassword(String(body.current ?? ""), me.passwordHash))) return json({ error: "Your current password is wrong." }, 403);
    if (!validPassword(body.next)) return json({ error: "Use a password of at least 8 characters." }, 400);
    await db.update(schema.users).set({ passwordHash: await hashPassword(body.next) }).where(eq(schema.users.id, me.id));
    await log(me.displayName, "Changed own password");
    return json({ ok: true });
  }

  // ---- user management (admin) ----
  if (path.startsWith("/api/auth/users")) {
    if (me.role !== "admin") return json({ error: "Only admins can manage accounts." }, 403);
    const id = Number(path.split("/")[4]);
    const all = await db.select().from(schema.users);
    const admins = all.filter((u) => u.role === "admin");
    if (method === "GET") return json(all.map(publicUser));
    if (method === "POST") {
      if (!validUsername(body.username)) return json({ error: "Username: 3–40 letters, numbers, dots or dashes." }, 400);
      if (all.some((u) => u.username === body.username.trim().toLowerCase())) return json({ error: "That username is taken." }, 400);
      if (!ROLES.includes(body.role)) return json({ error: "Pick a role." }, 400);
      if (!validPassword(body.password)) return json({ error: "Use a password of at least 8 characters." }, 400);
      const [u] = await db.insert(schema.users).values({ username: body.username.trim().toLowerCase(), displayName: String(body.displayName || body.username).trim(), role: body.role, passwordHash: await hashPassword(body.password) }).returning();
      await log(me.displayName, "Added account", `${u.displayName} (${u.role})`);
      return json(publicUser(u), 201);
    }
    const target = all.find((u) => u.id === id);
    if (!target) return json({ error: "Account not found." }, 404);
    if (method === "PUT") {
      const set: any = {};
      if (body.displayName != null) set.displayName = String(body.displayName).trim();
      if (body.role != null) {
        if (!ROLES.includes(body.role)) return json({ error: "Pick a role." }, 400);
        if (target.role === "admin" && body.role !== "admin" && admins.length === 1) return json({ error: "Keep at least one admin." }, 400);
        set.role = body.role;
      }
      if (body.password) {
        if (!validPassword(body.password)) return json({ error: "Use a password of at least 8 characters." }, 400);
        set.passwordHash = await hashPassword(body.password);
        await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
      }
      const [u] = await db.update(schema.users).set(set).where(eq(schema.users.id, id)).returning();
      await log(me.displayName, "Edited account", `${u.displayName}${body.password ? " (password reset)" : ""}`);
      return json(publicUser(u));
    }
    if (method === "DELETE") {
      if (target.id === me.id) return json({ error: "You can't delete your own account." }, 400);
      if (target.role === "admin" && admins.length === 1) return json({ error: "Keep at least one admin." }, 400);
      await db.delete(schema.users).where(eq(schema.users.id, id));
      await log(me.displayName, "Deleted account", target.displayName);
      return json({ ok: true });
    }
  }
  return json({ error: "Not found" }, 404);
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  if (path.startsWith("/api/auth/")) return handleAuth(req, path);
  if (path === "/api/health") return app.fetch(req);

  if ((await userCount()) === 0) return json({ error: "Create the admin account first.", needsSetup: true }, 401);
  const me = await currentUser(req);
  if (!me) return json({ error: "Please sign in." }, 401);
  const writes = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (writes && me.role === "viewer") return json({ error: "Your account can view schedules but not change them." }, 403);

  if (path === "/api/email/teacher-schedules" && req.method === "POST") {
    if (!smtpConfigured()) return json({ error: "Email isn't set up on this server (SMTP settings)." }, 400);
    const body: any = await req.json().catch(() => ({}));
    const r = await sendTeacherEmails(Array.isArray(body.teacherIds) ? body.teacherIds : null, baseUrl(req));
    await log(me.displayName, "Emailed schedules", `${r.sent} sent${r.failed.length ? `, ${r.failed.length} failed` : ""}`);
    return json(r);
  }

  // Pass the signed-in name to the API for the activity log.
  const headers = new Headers(req.headers);
  headers.set("x-takda-user", me.displayName);
  return app.fetch(new Request(req, { headers }));
}

async function handleShare(url: URL, req: Request): Promise<Response> {
  const [, , token, file] = url.pathname.split("/");
  const t = token ? (await db.select().from(schema.teachers).where(eq(schema.teachers.shareToken, token)))[0] : undefined;
  if (!t) return new Response("This schedule link is no longer valid. Ask the scheduler for a new one.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const w = await teacherWeek(t.id);
  if (!w) return new Response("Not found", { status: 404 });
  if (file === "calendar.ics") {
    return new Response(teacherIcs(w), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="class-schedule.ics"`, "Cache-Control": "no-store" } });
  }
  return new Response(teacherPage(w, `${baseUrl(req)}/s/${token}/calendar.ics`), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" } });
}

/** Answer /api/* and /s/* requests; anything else returns null (static files are the caller's job).
 *  `peerIp` is the address of the computer that sent the request, used for the first-admin check. */
export async function handleRequest(request: Request, peerIp = ""): Promise<Response | null> {
  const url = new URL(request.url);
  const api = url.pathname.startsWith("/api");
  if (!api && !url.pathname.startsWith("/s/")) return null;
  await ready;
  peers.set(request, peerIp);
  return api ? handleApi(request, url) : handleShare(url, request);
}
