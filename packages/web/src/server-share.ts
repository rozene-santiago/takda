// Server version only: read-only schedule pages for teachers (no login,
// reached by a secret link), calendar files, and emailing schedules.
import { eq } from "drizzle-orm";
import { db } from "./api/database";
import * as schema from "./api/database/schema";
import { buildIcs, type IcsClass } from "./api/lib/ics";
import { sortSlots, toMinutes } from "./api/lib/scheduler";

const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export interface TeacherWeek {
  teacher: typeof schema.teachers.$inferSelect;
  days: { day: number; classes: { start: string; end: string; label: string; subject: string; section: string; room: string; entryId: number }[] }[];
  covering: { date: string; start: string; end: string; subject: string; section: string; room: string }[];
  term: { name: string; startDate: string | null; endDate: string | null } | null;
  schoolName: string;
}

export async function teacherWeek(teacherId: number): Promise<TeacherWeek | null> {
  const teacher = (await db.select().from(schema.teachers).where(eq(schema.teachers.id, teacherId)))[0];
  if (!teacher) return null;
  const [entries, slots, subjects, sections, rooms, settings, terms, subs] = await Promise.all([
    db.select().from(schema.scheduleEntries).where(eq(schema.scheduleEntries.teacherId, teacherId)),
    db.select().from(schema.timeSlots),
    db.select().from(schema.subjects),
    db.select().from(schema.sections),
    db.select().from(schema.rooms),
    db.select().from(schema.settings),
    db.select().from(schema.terms),
    db.select().from(schema.substitutions).where(eq(schema.substitutions.substituteTeacherId, teacherId)),
  ]);
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const name = <T extends { id: number; name: string }>(list: T[], id: number | null) => list.find((x) => x.id === id)?.name ?? "";
  const order = new Map(sortSlots(slots).map((s, i) => [s.id, i]));
  const activeDays = settings[0]?.activeDays ?? [1, 2, 3, 4, 5];
  const days = activeDays.map((day) => ({
    day,
    classes: entries
      .filter((e) => e.dayOfWeek === day)
      .sort((a, b) => (order.get(a.timeSlotId) ?? 0) - (order.get(b.timeSlotId) ?? 0))
      .map((e) => {
        const s = slotById.get(e.timeSlotId);
        return { start: s?.startTime ?? "", end: s?.endTime ?? "", label: s?.label ?? "", subject: name(subjects, e.subjectId), section: name(sections, e.sectionId), room: name(rooms, e.roomId), entryId: e.id };
      }),
  }));
  const today = new Date().toISOString().slice(0, 10);
  const covering = subs
    .filter((s) => s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || toMinutes(slotById.get(a.timeSlotId)?.startTime) - toMinutes(slotById.get(b.timeSlotId)?.startTime))
    .slice(0, 20)
    .map((s) => {
      const slot = slotById.get(s.timeSlotId);
      const sec = sections.find((x) => x.id === s.sectionId);
      return { date: s.date, start: slot?.startTime ?? "", end: slot?.endTime ?? "", subject: name(subjects, s.subjectId), section: sec?.name ?? "", room: name(rooms, sec?.homeroomId ?? null) };
    });
  const active = terms.find((t) => t.isActive);
  return { teacher, days, covering, term: active ? { name: active.name, startDate: active.startDate, endDate: active.endDate } : null, schoolName: settings[0]?.schoolName ?? "" };
}

export function teacherIcs(w: TeacherWeek): string {
  const classes: IcsClass[] = w.days.flatMap((d) => d.classes.map((c) => ({
    uid: `t${w.teacher.id}-e${c.entryId}`, day: d.day, start: c.start, end: c.end,
    title: `${c.subject} – ${c.section}`, location: c.room || null, description: c.label,
  })));
  return buildIcs({ calendarName: `${w.teacher.name} – classes`, classes, startDate: w.term?.startDate, endDate: w.term?.endDate });
}

function scheduleTable(w: TeacherWeek): string {
  return w.days.map((d) => `
    <section><h2>${DAYS[d.day]}</h2>${d.classes.length ? `<ul>${d.classes.map((c) => `
      <li><span class="t">${esc(c.start)}–${esc(c.end)}</span><span class="c"><b>${esc(c.subject)}</b> · ${esc(c.section)}${c.room ? ` · ${esc(c.room)}` : ""}</span></li>`).join("")}</ul>` : `<p class="none">No classes</p>`}</section>`).join("");
}

export function teacherPage(w: TeacherWeek, calendarUrl: string): string {
  const total = w.days.reduce((n, d) => n + d.classes.length, 0);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(w.teacher.name)} · Class schedule</title>
<style>
:root{--bg:#f4f2ea;--card:#fff;--ink:#1a1a1a;--muted:#5b6660;--brand:#007041;--forest:#1e3d32;--line:#e3e1d8}
@media (prefers-color-scheme:dark){:root{--bg:#131a17;--card:#1c2622;--ink:#eef2ef;--muted:#a3b1aa;--brand:#3fbf86;--forest:#cfe7db;--line:#2c3933}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:720px;margin:0 auto;padding:20px max(16px,env(safe-area-inset-left)) 40px}
header h1{font-size:1.6rem;margin:0;color:var(--forest)}header p{margin:.25rem 0 0;color:var(--muted)}
.actions{margin:16px 0 8px;display:flex;gap:8px;flex-wrap:wrap}.btn{display:inline-block;background:var(--brand);color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:600}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 16px;margin-top:12px}
h2{font-size:1rem;margin:0 0 6px;color:var(--brand)}ul{list-style:none;margin:0;padding:0}li{display:flex;gap:12px;padding:8px 0;border-top:1px solid var(--line)}li:first-child{border-top:0}
.t{font-variant-numeric:tabular-nums;color:var(--muted);min-width:7.5em}.c{min-width:0}.none{color:var(--muted);margin:4px 0}
footer{color:var(--muted);font-size:.85rem;margin-top:24px}
</style></head><body><main>
<header><h1>${esc(w.teacher.name)}</h1><p>${esc(w.schoolName)}${w.term ? ` · ${esc(w.term.name)}` : ""} · ${total} class${total === 1 ? "" : "es"} a week</p></header>
<div class="actions"><a class="btn" href="${esc(calendarUrl)}">Add to my calendar</a></div>
${w.covering.length ? `<section><h2>Classes you're covering</h2><ul>${w.covering.map((c) => `<li><span class="t">${esc(c.date)}<br>${esc(c.start)}–${esc(c.end)}</span><span class="c"><b>${esc(c.subject)}</b> · ${esc(c.section)}${c.room ? ` · ${esc(c.room)}` : ""}</span></li>`).join("")}</ul></section>` : ""}
${scheduleTable(w)}
<footer>Read-only schedule. It updates automatically when the schedule changes.</footer>
</main></body></html>`;
}

export function teacherEmailHtml(w: TeacherWeek, pageUrl: string | null): string {
  const rows = w.days.map((d) => `<tr><td colspan="2" style="padding:10px 0 4px;font-weight:700;color:#007041">${DAYS[d.day]}</td></tr>${d.classes.length ? d.classes.map((c) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#555;white-space:nowrap">${esc(c.start)}–${esc(c.end)}</td><td style="padding:4px 0"><b>${esc(c.subject)}</b> · ${esc(c.section)}${c.room ? ` · ${esc(c.room)}` : ""}</td></tr>`).join("") : `<tr><td colspan="2" style="color:#888">No classes</td></tr>`}`).join("");
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1a1a1a">
<p>Hello ${esc(w.teacher.name)},</p><p>Here is your class schedule${w.term ? ` for ${esc(w.term.name)}` : ""}. The attached calendar file adds these classes to your calendar.</p>
${pageUrl ? `<p><a href="${esc(pageUrl)}">Open your schedule online</a> (always up to date).</p>` : ""}
<table style="border-collapse:collapse">${rows}</table>
<p style="color:#666;margin-top:16px">${esc(w.schoolName)}</p></div>`;
}

export const smtpConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_FROM);

export async function sendTeacherEmails(teacherIds: number[] | null, baseUrl: string | null): Promise<{ sent: number; skipped: string[]; failed: string[] }> {
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  const all = await db.select().from(schema.teachers);
  const list = teacherIds?.length ? all.filter((t) => teacherIds.includes(t.id)) : all;
  let sent = 0; const skipped: string[] = []; const failed: string[] = [];
  for (const t of list) {
    if (!t.email) { skipped.push(`${t.name} (no email)`); continue; }
    const w = await teacherWeek(t.id);
    if (!w) continue;
    let token = t.shareToken;
    if (!token && baseUrl) {
      token = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
      await db.update(schema.teachers).set({ shareToken: token }).where(eq(schema.teachers.id, t.id));
    }
    const pageUrl = baseUrl && token ? `${baseUrl}/s/${token}` : null;
    try {
      await transport.sendMail({
        from: process.env.SMTP_FROM, to: t.email, subject: `Your class schedule${w.term ? ` – ${w.term.name}` : ""}`,
        html: teacherEmailHtml(w, pageUrl),
        attachments: [{ filename: "class-schedule.ics", content: teacherIcs(w), contentType: "text/calendar" }],
      });
      sent++;
    } catch (e: any) {
      failed.push(`${t.name}: ${e?.message ?? e}`);
    }
  }
  return { sent, skipped, failed };
}
