// Server build: talks to the API over HTTP (same origin, session cookie).
import { makeApi } from "./api-core";

const { api, request } = makeApi(((input: RequestInfo | URL, init?: RequestInit) => fetch(input, { credentials: "same-origin", ...init })) as typeof fetch, "/");

export { api, request };
export const HOSTED = false;
export function setViewerTag(_tag: string | null) { /* server build: the session identifies the user */ }
