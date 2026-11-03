// Static, server-less build: the API + SQLite run inside the browser.
//   bunx vite build --config vite.hosted.config.ts   ->  dist-hosted/
// The output is plain static files you can put on any static host
// (GitHub Pages, Netlify, an S3 bucket, a USB stick...). Data is kept in the
// browser (IndexedDB), or in shared storage when opened as a claude.ai artifact.
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "path";

const r = (p: string) => path.resolve(__dirname, p);

// Redirect a few modules to their browser-only twins.
function hostedSwaps(): Plugin {
  const swaps: Record<string, string> = {
    [r("src/api/database/index.ts")]: r("src/api/database/browser.ts"),
    [r("src/web/lib/api.ts")]: r("src/web/lib/api.hosted.ts"),
    [r("src/web/components/save-status.tsx")]: r("src/web/components/save-status.hosted.tsx"),
  };
  return {
    name: "hosted-swaps",
    enforce: "pre",
    async resolveId(source, importer, opts) {
      if (!importer) return null;
      const res = await this.resolve(source, importer, { ...opts, skipSelf: true });
      if (res && swaps[res.id] && importer !== swaps[res.id]) return swaps[res.id];
      return null;
    },
  };
}

export default defineConfig({
  base: "./",
  define: { "import.meta.env.VITE_HOSTED": "true" },
  plugins: [hostedSwaps(), react(), tailwind()],
  resolve: { alias: { "@": r("src/web") } },
  build: { outDir: "dist-hosted", emptyOutDir: true, assetsInlineLimit: 0 },
});
