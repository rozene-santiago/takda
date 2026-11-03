// Shared request plumbing for both builds: errors become exceptions with the
// server's message, and listeners hear about every successful change (to
// refresh undo/redo) and about expired sign-ins.
import { hc } from "hono/client";
import type { AppType } from "../../api";

type Listener = () => void;
const changed = new Set<Listener>();
const unauthorized = new Set<Listener>();
export const onApiChange = (fn: Listener) => { changed.add(fn); return () => { changed.delete(fn); }; };
export const onUnauthorized = (fn: Listener) => { unauthorized.add(fn); return () => { unauthorized.delete(fn); }; };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export function makeApi(baseFetch: typeof fetch, origin: string) {
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const res = await baseFetch(input, init);
    if (!res.ok) {
      let msg = `Something went wrong (${res.status}).`;
      try { const j = await res.clone().json(); if (j?.error) msg = j.error; } catch { /* not JSON */ }
      if (res.status === 401) unauthorized.forEach((f) => f());
      throw new ApiError(msg, res.status);
    }
    if (method !== "GET" && method !== "HEAD") changed.forEach((f) => f());
    return res;
  }) as typeof fetch;

  const client = hc<AppType>(origin, { fetch: wrapped });

  /** Untyped JSON request for newer endpoints: request("POST", "/tools/copy-day", {...}). */
  async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await wrapped(`${origin.replace(/\/$/, "")}/api${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  return { api: client.api, request };
}
