// Calendar files (.ics) for a teacher's weekly classes. Times are "floating"
// (no time zone), so calendar apps show them in the teacher's own local time.

export interface IcsClass {
  uid: string;
  day: number;          // 1 = Mon … 7 = Sun
  start: string;        // "07:30"
  end: string;          // "08:20"
  title: string;
  location?: string | null;
  description?: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const hm = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t) ?? ["", "0", "0"]; return `${pad(Number(m[1]))}${m[2]}00`; };
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

function fold(line: string): string {
  // Lines longer than 75 bytes continue on the next line with a leading space.
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const ch of line) {
    const l = new TextEncoder().encode(ch).length;
    if (curLen + l > (parts.length ? 74 : 75)) { parts.push(cur); cur = ""; curLen = 0; }
    cur += ch; curLen += l;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export function buildIcs(opts: { calendarName: string; classes: IcsClass[]; startDate?: string | null; endDate?: string | null; now?: Date }): string {
  const now = opts.now ?? new Date();
  // First week: the term start, or this week's Monday.
  let first: Date;
  if (opts.startDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.startDate)) first = new Date(opts.startDate + "T00:00:00");
  else { first = new Date(now.getFullYear(), now.getMonth(), now.getDate()); first.setDate(first.getDate() - ((first.getDay() + 6) % 7)); }
  const until = opts.endDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.endDate) ? `UNTIL=${opts.endDate.replace(/-/g, "")}T235959` : "COUNT=40";
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DLSU-D TAKDA//Class Scheduler//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(opts.calendarName)}`,
  ];
  for (const c of opts.classes) {
    const d = new Date(first);
    d.setDate(d.getDate() + ((c.day - 1 - ((d.getDay() + 6) % 7) + 7) % 7));
    lines.push(
      "BEGIN:VEVENT",
      `UID:${c.uid}@takda`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${ymd(d)}T${hm(c.start)}`,
      `DTEND:${ymd(d)}T${hm(c.end)}`,
      `RRULE:FREQ=WEEKLY;${until}`,
      `SUMMARY:${esc(c.title)}`,
      ...(c.location ? [`LOCATION:${esc(c.location)}`] : []),
      ...(c.description ? [`DESCRIPTION:${esc(c.description)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
