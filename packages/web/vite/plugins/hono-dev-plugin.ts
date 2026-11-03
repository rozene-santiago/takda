// Dev server: answers /api/* and teacher share links (/s/*) with the same
// handler the production server uses (src/handler.ts), so logins, roles and
// share links work in `bun run dev` too. Vite serves everything else.
import type { Plugin, ViteDevServer } from "vite";

export default function honoDevPlugin(): Plugin {
  return {
    name: "hono-dev-server",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api") && !req.url?.startsWith("/s/")) return next();

        try {
          const request = await toWebRequest(req);
          const handleRequest = await loadHandler(server);
          const response = await handleRequest(request, req.socket.remoteAddress ?? "");
          if (!response) return next();

          res.statusCode = response.status;
          response.headers.forEach((value: string, key: string) => { if (key !== "set-cookie") res.setHeader(key, value); });
          const cookies = response.headers.getSetCookie?.() ?? [];
          if (cookies.length) res.setHeader("set-cookie", cookies);
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          server.ssrFixStacktrace(err as Error);
          console.error("[hono-dev]", err);
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
      });
    },
  };
}

async function loadHandler(server: ViteDevServer): Promise<(req: Request, peerIp: string) => Promise<Response | null>> {
  const mod = await server.ssrLoadModule("/src/handler.ts");
  return mod.handleRequest;
}

function toWebRequest(req: import("http").IncomingMessage): Request {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val) headers.set(key, Array.isArray(val) ? val.join(", ") : val);
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url.href, {
    method: req.method,
    headers,
    body: hasBody ? (req as unknown as ReadableStream) : undefined,
    duplex: hasBody ? "half" : undefined, // needed for streaming request bodies
  } as RequestInit);
}
