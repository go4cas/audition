// Repeat schedules (docs/PHASE-2A.md, part 2): the Repeat panel's plain
// choices to a five-field cron in UTC, and back to words in local time.
// Vaultbase runs cron in UTC; people pick a local day and time.

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (n) => String(n).padStart(2, "0");

// The offset from UTC is this month's. Vaultbase runs cron in UTC only, so
// where clocks change, a repeat moves by an hour with them (docs/PHASE-2A.md).
const anchor = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); };

/** A local date at the chosen time: in the anchor month, on the chosen weekday or date. */
function localAt({ every, day, date, time }) {
  const [h, m] = String(time || "07:00").split(":").map(Number);
  const a = anchor();
  // Days 8 to 14 of the month hold every weekday once, away from the month's edges.
  if (every === "week") return new Date(a.getFullYear(), a.getMonth(), 8 + ((Number(day) - new Date(a.getFullYear(), a.getMonth(), 8).getDay() + 7) % 7), h, m);
  if (every === "month") return new Date(a.getFullYear(), a.getMonth(), Number(date), h, m);
  return new Date(a.getFullYear(), a.getMonth(), 10, h, m);
}

/**
 * { every: "day" | "week" | "month", day: 0-6, date: 1-28, time: "HH:MM" } in
 * local time, to cron in UTC. Throws when a monthly date moves outside 1 to 28
 * in UTC (pick another date or time).
 */
export function toCron(choice) {
  const d = localAt(choice);
  const m = d.getUTCMinutes(), h = d.getUTCHours();
  if (choice.every === "week") return `${m} ${h} * * ${d.getUTCDay()}`;
  if (choice.every === "month") {
    const a = anchor();
    const utcDate = d.getUTCMonth() === a.getMonth() ? d.getUTCDate() : d < a ? 0 : 29;
    if (utcDate < 1 || utcDate > 28) throw new Error("That date and time falls outside the 1st to the 28th in UTC. Pick another date or time.");
    return `${m} ${h} ${utcDate} * *`;
  }
  return `${m} ${h} * * *`;
}

/** A cron made by toCron, in words and local time: "every Monday at 09:00". */
export function describe(cron) {
  const p = String(cron || "").trim().split(/\s+/);
  if (p.length !== 5) return "";
  const [m, h, dom, , dow] = p.map((x) => (x === "*" ? null : Number(x)));
  const a = anchor(), y = a.getFullYear(), mo = a.getMonth();
  let utc;
  if (dow != null) utc = new Date(Date.UTC(y, mo, 8 + ((dow - new Date(Date.UTC(y, mo, 8)).getUTCDay() + 7) % 7), h, m));
  else if (dom != null) utc = new Date(Date.UTC(y, mo, dom, h, m));
  else utc = new Date(Date.UTC(y, mo, 10, h, m));
  const at = `at ${pad(utc.getHours())}:${pad(utc.getMinutes())}`;
  if (dow != null) return `every ${DAYS[utc.getDay()]} ${at}`;
  if (dom != null) return `every month on day ${utc.getDate()} ${at}`;
  return `every day ${at}`;
}
