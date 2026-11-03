// Offer a generated file to the user.
//
// Inside a claude.ai artifact the page runs in a sandboxed frame where
// <a download> links do nothing, so files go through the platform's
// "downloads" capability, which shows the viewer a save prompt.
// Anywhere else (the self-hosted server, a plain static host) a normal
// browser download is used.

export type SaveOutcome = "saved" | "declined" | "failed";

type Downloads = { save(req: { filename: string; data: Blob | ArrayBuffer | ArrayBufferView | string }): Promise<unknown> };

/** True when the page is running inside the Claude artifact viewer. */
export function inClaudeViewer(): boolean {
  return typeof (window as any).claude?.use === "function";
}

let downloadsPromise: Promise<Downloads | null> | null = null;
function getDownloads(): Promise<Downloads | null> {
  if (!inClaudeViewer()) return Promise.resolve(null);
  downloadsPromise ??= (window as any).claude.use("downloads").catch(() => null);
  return downloadsPromise!;
}

function anchorDownload(filename: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// File types the claude.ai download prompt accepts; anything else is zipped first.
const VIEWER_TYPES = new Set("gif png jpg jpeg webp mp4 webm mov txt json md docx pptx epub csv ttf html svg pdf xlsx zip".split(" "));

export async function saveFile(filename: string, blob: Blob): Promise<SaveOutcome> {
  const dl = await getDownloads();
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase() ?? "";
  if (dl && !VIEWER_TYPES.has(ext)) {
    const { zipSync } = await import("fflate");
    const zipped = zipSync({ [filename]: new Uint8Array(await blob.arrayBuffer()) }, { level: 6 });
    filename = filename.replace(/\.[a-z0-9]+$/i, "") + ".zip";
    blob = new Blob([zipped as BlobPart], { type: "application/zip" });
  }
  if (!dl) {
    if (inClaudeViewer()) {
      notify("Downloads aren't available in this view. Open the scheduler in claude.ai to save files.", "error");
      return "failed";
    }
    anchorDownload(filename, blob);
    return "saved";
  }
  try {
    await dl.save({ filename, data: blob });
    return "saved";
  } catch (e: any) {
    const code = e?.code;
    if (code === "declined") return "declined";
    if (code === "rate_limited") notify("A save prompt is already open. Finish that one first, then try again.", "error");
    else notify(`Could not save ${filename}: ${e?.message ?? code ?? "unknown error"}`, "error");
    return "failed";
  }
}

// ---- tiny toast, independent of React so plain modules can use it ----
let toastEl: HTMLDivElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Show a short status message at the bottom of the screen. `sticky` keeps it up until the next call or hideNotice(). */
export function notify(message: string, kind: "info" | "error" = "info", sticky = false) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.setAttribute("role", "status");
    toastEl.className = "print:hidden";
    Object.assign(toastEl.style, {
      position: "fixed", left: "50%", bottom: "calc(env(safe-area-inset-bottom, 0px) + 60px)", transform: "translateX(-50%)", zIndex: "80",
      width: "max-content", maxWidth: "min(92vw, 460px)", boxSizing: "border-box", padding: "10px 14px", borderRadius: "10px", fontSize: "13px",
      lineHeight: "1.4", boxShadow: "0 8px 24px rgba(0,0,0,.18)", fontFamily: "inherit",
    } as CSSStyleDeclaration);
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.style.background = kind === "error" ? "#c0392b" : "#1e3d32";
  toastEl.style.color = "#ffffff";
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(hideNotice, kind === "error" ? 7000 : 3500);
}

export function hideNotice() {
  clearTimeout(toastTimer);
  if (toastEl) toastEl.hidden = true;
}
