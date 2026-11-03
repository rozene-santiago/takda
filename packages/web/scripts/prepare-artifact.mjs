// Turns dist-hosted/ (from `bun run build:hosted`) into files the claude.ai
// artifact host accepts:
//   1. packs pdf.js .bcmap / .pfb support files into JSON bundles (the host
//      serves no generic binary types) and drops the .icc profile;
//   2. replaces raw ESC bytes inside scripts with the equivalent \x1b escape
//      (the host refuses text files that contain terminal escape bytes);
//   3. rewrites index.html as page content (the host adds the <html>/<head>
//      skeleton itself) and drops files the artifact doesn't use.
// Usage: node scripts/prepare-artifact.mjs [dist-hosted]
import fs from "node:fs";
import path from "node:path";

const dist = path.resolve(process.argv[2] ?? "dist-hosted");
const rel = (p) => path.relative(dist, p);

// 1. pdf.js support files
for (const [dir, ext] of [["cmaps", ".bcmap"], ["standard_fonts", ".pfb"]]) {
  const d = path.join(dist, "pdfjs", dir);
  if (!fs.existsSync(d)) continue;
  const bundle = {};
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith(ext)) continue;
    bundle[f] = fs.readFileSync(path.join(d, f)).toString("base64");
    fs.rmSync(path.join(d, f));
  }
  fs.writeFileSync(path.join(dist, "pdfjs", `${dir}.json`), JSON.stringify(bundle));
  console.log(`packed ${Object.keys(bundle).length} ${ext} files -> pdfjs/${dir}.json`);
}
for (const f of ["pdfjs/iccs/CGATS001Compat-v2-micro.icc"]) fs.rmSync(path.join(dist, f), { force: true });

// 2. raw ESC bytes in scripts
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const file of walk(dist).filter((f) => /\.(m?js|css)$/.test(f))) {
  const buf = fs.readFileSync(file);
  if (!buf.includes(0x1b)) continue;
  const out = [];
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x1b) {
      let k = 0;
      for (let j = i - 1; j >= 0 && buf[j] === 0x5c; j--) k++;
      if (k % 2) throw new Error(`${rel(file)}: escaped ESC byte at ${i}; fix by hand`);
      out.push(...Buffer.from("\\x1b"));
      n++;
    } else out.push(buf[i]);
  }
  fs.writeFileSync(file, Buffer.from(out));
  console.log(`escaped ${n} ESC byte(s) in ${rel(file)}`);
}

// 3. index.html -> page content
const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "Class Scheduler";
const keep = [...html.matchAll(/<link [^>]*(?:fonts\.googleapis|fonts\.gstatic|rel="stylesheet")[^>]*>/g)].map((m) => m[0]);
const scripts = [...html.matchAll(/<script [^>]*><\/script>/g)].map((m) => m[0]);
const page = [`<title>${title.split(" - ")[0].trim()}</title>`, ...keep, `<div id="root"></div>`, ...scripts].join("\n") + "\n";
fs.writeFileSync(path.join(dist, "index.html"), page);
for (const f of ["favicon.ico", "og-image.png", "logo-crest-green.png", ".gitkeep"]) fs.rmSync(path.join(dist, f), { force: true });
console.log("index.html rewritten as page content");
