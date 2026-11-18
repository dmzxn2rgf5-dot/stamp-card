export const DAY = 86_400_000;

/** Milliseconds the given time zone is ahead of UTC at `date`. */
export function tzOffset(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** UTC timestamp of local midnight `daysAgo` days before `now` in `tz`. */
export function startOfDay(tz: string, now = Date.now(), daysAgo = 0): number {
  const local = now + tzOffset(tz, new Date(now));
  const localMidnight = local - (((local % DAY) + DAY) % DAY) - daysAgo * DAY;
  // Resolve offset at that midnight (handles clock changes).
  const guess = localMidnight - tzOffset(tz, new Date(localMidnight));
  return localMidnight - tzOffset(tz, new Date(guess));
}

/** Local Monday 00:00 of the current week. */
export function startOfWeek(tz: string, now = Date.now()): number {
  const local = new Date(now + tzOffset(tz, new Date(now)));
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  return startOfDay(tz, now, daysSinceMonday);
}

/** YYYY-MM-DD in the given zone. */
export function localDate(tz: string, ts: number): string {
  return new Date(ts + tzOffset(tz, new Date(ts))).toISOString().slice(0, 10);
}

export function localTime(tz: string, ts: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }).format(ts);
}
