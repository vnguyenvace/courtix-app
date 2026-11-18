// Time helpers. The club's time zone (e.g. Asia/Bangkok) decides what "today"
// and "9:00" mean, whatever time zone the server runs in.

function wallClockParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Minutes the zone is ahead of UTC at a given instant (Bangkok = 420). */
function offsetMinutes(instant: Date, timeZone: string) {
  const p = wallClockParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** Club-local date ("2026-11-14") and time ("09:00") to a real instant. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const naive = new Date(`${date}T${time.slice(0, 5)}:00Z`);
  let utc = new Date(naive.getTime() - offsetMinutes(naive, timeZone) * 60000);
  // Second pass corrects for daylight-saving edges (not needed in Thailand, harmless elsewhere).
  utc = new Date(naive.getTime() - offsetMinutes(utc, timeZone) * 60000);
  return utc;
}

/** Today's date in the club's time zone, as "YYYY-MM-DD". */
export function todayIn(timeZone: string): string {
  const p = wallClockParts(new Date(), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isValidDate(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** "HH:MM" of an instant in the club's zone. */
export function localTime(instant: string | Date, timeZone: string): string {
  const p = wallClockParts(new Date(instant), timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Slot start times between opening and closing, e.g. ["07:00", "08:00", ...]. */
export function slotTimes(opensAt: string, closesAt: string, slotMinutes: number): string[] {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const out: string[] = [];
  for (let m = toMin(opensAt); m + slotMinutes <= toMin(closesAt); m += slotMinutes) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

export function formatDate(date: string | null, locale = "en-GB"): string {
  if (!date) return "—";
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatLongDay(date: string, locale = "en-GB"): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

export function formatMoney(amount: number | null | undefined, currency = "THB"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount ?? 0));
}
