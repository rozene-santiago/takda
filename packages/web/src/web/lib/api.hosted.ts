// Hosted build: the API runs inside the page (no server). Swapped in for
// ./api.ts by vite.hosted.config.ts.
import app from "../../api";
import { markDirty } from "../../api/database/browser";
import { makeApi } from "./api-core";

// Who is making changes (claude.ai viewer id), for the activity log.
let viewerTag: string | null = null;
export function setViewerTag(tag: string | null) { viewerTag = tag; }

const inPageFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://local");
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (viewerTag) headers.set("x-takda-user", viewerTag);
  const req = new Request(url, { ...init, method: init?.method ?? (input instanceof Request ? input.method : "GET"), headers, body: init?.body ?? (input instanceof Request ? await input.text() || undefined : undefined) });
  const res = await app.fetch(req);
  if (req.method !== "GET" && req.method !== "HEAD" && res.ok) markDirty();
  return res;
};

const { api, request } = makeApi(inPageFetch as typeof fetch, "http://local/");

export { api, request };
export const HOSTED = true;
