// The Repeat panel's schedule helper (ui/src/lib/schedule.js): local choices
// to cron in UTC and back, in a time zone ahead of UTC and one behind it.
import { describe as group, expect, test } from "bun:test";
import { describe, toCron } from "../ui/src/lib/schedule.js";
import { scheduleOk } from "../vb_hooks/lib/arena.ts";

const inZone = (tz: string, fn: () => void) => {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try { fn(); } finally { process.env.TZ = before; }
};

group("repeat schedules", () => {
  test("UTC: the cron is the choice itself", () => inZone("UTC", () => {
    expect(toCron({ every: "day", time: "07:30" })).toBe("30 7 * * *");
    expect(toCron({ every: "week", day: 1, time: "09:00" })).toBe("0 9 * * 1");
    expect(toCron({ every: "month", date: 15, time: "18:05" })).toBe("5 18 15 * *");
    expect(describe("0 9 * * 1")).toBe("every Monday at 09:00");
  }));

  test("Johannesburg (UTC+2): early Monday becomes Sunday in UTC, and reads back as chosen", () => inZone("Africa/Johannesburg", () => {
    const cron = toCron({ every: "week", day: 1, time: "01:00" });
    expect(cron).toBe("0 23 * * 0");
    expect(scheduleOk(cron)).toBe(true);
    expect(describe(cron)).toBe("every Monday at 01:00");
    expect(() => toCron({ every: "month", date: 1, time: "01:00" })).toThrow(/outside the 1st to the 28th/);
    expect(describe(toCron({ every: "month", date: 2, time: "01:00" }))).toBe("every month on day 2 at 01:00");
  }));

  test("Kolkata (UTC+5:30): early Friday becomes Thursday 21:30 in UTC", () => inZone("Asia/Kolkata", () => {
    const cron = toCron({ every: "week", day: 5, time: "03:00" });
    expect(cron).toBe("30 21 * * 4");
    expect(describe(cron)).toBe("every Friday at 03:00");
    expect(describe(toCron({ every: "day", time: "00:15" }))).toBe("every day at 00:15");
    for (const c of [toCron({ every: "day", time: "23:59" }), cron]) expect(scheduleOk(c)).toBe(true);
  }));

  test("Los Angeles (behind UTC): a late monthly date past the 28th in UTC is refused", () => inZone("America/Los_Angeles", () => {
    expect(() => toCron({ every: "month", date: 28, time: "22:00" })).toThrow(/outside the 1st to the 28th/);
    expect(describe(toCron({ every: "week", day: 6, time: "20:00" }))).toBe("every Saturday at 20:00");
  }));
});
