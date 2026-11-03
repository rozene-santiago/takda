// Server version: serves the built web app (dist/) and, through handler.ts,
// the API with logins and roles. Start with `bun src/server.ts` after `bunx vite build`.
import { ready } from "./api/database";
import { handleRequest } from "./handler";

const port = Number(process.env.PORT ?? 3000);
const distDir = `${import.meta.dir}/../dist`;
const indexPath = `${distDir}/index.html`;

await ready;
const server = Bun.serve({
  port,
  async fetch(request, srv) {
    const handled = await handleRequest(request, srv.requestIP(request)?.address ?? "");
    if (handled) return handled;
    const url = new URL(request.url);

    const filePath = getStaticFilePath(url.pathname);
    const file = Bun.file(filePath);
    if (await file.exists()) return new Response(file);

    const index = Bun.file(indexPath);
    if (await index.exists()) return new Response(index, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    return new Response("Build output not found. Run `bun run build` first.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },
});

console.log(`Web server listening on http://localhost:${server.port}`);

function getStaticFilePath(pathname: string) {
  const cleanPath = decodeURIComponent(pathname).replace(/^\/+/, "").replaceAll("..", "");
  return cleanPath ? `${distDir}/${cleanPath}` : indexPath;
}
