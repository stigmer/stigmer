import { describe, it, expect } from "vitest";
import {
  cadenceToCron,
  cronToCadence,
  describeCadence,
  formatTime,
  validateCron,
  validateTimeZone,
  type CadencePreset,
} from "../cadence";

// ---------------------------------------------------------------------------
// Preset → cron → preset round-trips
// ---------------------------------------------------------------------------

describe("cadenceToCron / cronToCadence round-trips", () => {
  const cases: readonly { preset: CadencePreset; cron: string }[] = [
    { preset: { kind: "hourly", minute: 0 }, cron: "0 * * * *" },
    { preset: { kind: "hourly", minute: 45 }, cron: "45 * * * *" },
    { preset: { kind: "daily", hour: 9, minute: 0 }, cron: "0 9 * * *" },
    { preset: { kind: "daily", hour: 0, minute: 0 }, cron: "0 0 * * *" },
    { preset: { kind: "daily", hour: 23, minute: 59 }, cron: "59 23 * * *" },
    {
      preset: { kind: "weekly", days: [1], hour: 9, minute: 30 },
      cron: "30 9 * * 1",
    },
    {
      preset: { kind: "weekly", days: [1, 3, 5], hour: 8, minute: 15 },
      cron: "15 8 * * 1,3,5",
    },
    {
      preset: { kind: "weekly", days: [0, 6], hour: 10, minute: 0 },
      cron: "0 10 * * 0,6",
    },
    {
      preset: { kind: "monthly", day: 1, hour: 9, minute: 0 },
      cron: "0 9 1 * *",
    },
    {
      preset: { kind: "monthly", day: 31, hour: 6, minute: 30 },
      cron: "30 6 31 * *",
    },
  ];

  for (const { preset, cron } of cases) {
    it(`${JSON.stringify(preset)} ⇄ "${cron}"`, () => {
      expect(cadenceToCron(preset)).toBe(cron);
      expect(cronToCadence(cron)).toEqual(preset);
    });
  }

  it("generated cron always passes the platform's lexical validation", () => {
    for (const { preset } of cases) {
      expect(validateCron(cadenceToCron(preset))).toBeNull();
    }
  });

  it("canonicalizes weekly day order and duplicates", () => {
    expect(
      cadenceToCron({ kind: "weekly", days: [5, 1, 3, 1], hour: 9, minute: 0 }),
    ).toBe("0 9 * * 1,3,5");
  });

  it("returns custom cron verbatim", () => {
    expect(cadenceToCron({ kind: "custom", cron: "0 9 * * MON-FRI" })).toBe(
      "0 9 * * MON-FRI",
    );
  });
});

describe("cronToCadence recognition boundaries", () => {
  it("maps calendar shorthands to their preset equivalents", () => {
    expect(cronToCadence("@hourly")).toEqual({ kind: "hourly", minute: 0 });
    expect(cronToCadence("@daily")).toEqual({ kind: "daily", hour: 0, minute: 0 });
    expect(cronToCadence("@weekly")).toEqual({
      kind: "weekly",
      days: [0],
      hour: 0,
      minute: 0,
    });
    expect(cronToCadence("@monthly")).toEqual({
      kind: "monthly",
      day: 1,
      hour: 0,
      minute: 0,
    });
  });

  it("sorts unordered day lists into canonical form", () => {
    // The builder emits sorted lists, but a hand-written spec may not.
    expect(cronToCadence("0 9 * * 5,1")).toEqual({
      kind: "weekly",
      days: [1, 5],
      hour: 9,
      minute: 0,
    });
  });

  it("tolerates surrounding and duplicate whitespace", () => {
    expect(cronToCadence("  0  9 * * *  ")).toEqual({
      kind: "daily",
      hour: 9,
      minute: 0,
    });
  });

  const fallsBackToCustom = [
    "@yearly", // valid, but no preset arm can express it
    "*/5 * * * *", // steps
    "0 9 * * MON-FRI", // names and ranges
    "0 9 1,15 * *", // multiple days of month
    "0 9-17 * * *", // hour ranges
    "60 * * * *", // out-of-range minute
    "0 24 * * *", // out-of-range hour
    "0 9 0 * *", // out-of-range day of month
    "0 9 * * 7", // out-of-range day of week
    "0 9 * * 1,1", // duplicate days
    "not a cron",
  ];

  for (const cron of fallsBackToCustom) {
    it(`"${cron}" round-trips as custom with the raw string intact`, () => {
      expect(cronToCadence(cron)).toEqual({ kind: "custom", cron });
    });
  }
});

// ---------------------------------------------------------------------------
// Plain-English summaries
// ---------------------------------------------------------------------------

describe("describeCadence", () => {
  it("describes each preset", () => {
    expect(describeCadence({ kind: "hourly", minute: 5 })).toBe(
      "Every hour at minute 5",
    );
    expect(describeCadence({ kind: "daily", hour: 9, minute: 0 })).toBe(
      "Every day at 09:00",
    );
    expect(
      describeCadence({ kind: "weekly", days: [1], hour: 9, minute: 30 }),
    ).toBe("Every Monday at 09:30");
    expect(
      describeCadence({ kind: "weekly", days: [1, 3, 5], hour: 9, minute: 0 }),
    ).toBe("Every Monday, Wednesday and Friday at 09:00");
    expect(
      describeCadence({
        kind: "weekly",
        days: [0, 1, 2, 3, 4, 5, 6],
        hour: 9,
        minute: 0,
      }),
    ).toBe("Every day at 09:00");
    expect(
      describeCadence({ kind: "monthly", day: 15, hour: 9, minute: 0 }),
    ).toBe("On day 15 of every month at 09:00");
  });

  it("appends the time zone when provided", () => {
    expect(
      describeCadence({ kind: "daily", hour: 9, minute: 0 }, "Asia/Kolkata"),
    ).toBe("Every day at 09:00 (Asia/Kolkata)");
  });

  it("formats times zero-padded on a 24-hour clock", () => {
    expect(formatTime(0, 0)).toBe("00:00");
    expect(formatTime(9, 5)).toBe("09:05");
    expect(formatTime(23, 59)).toBe("23:59");
  });
});

// ---------------------------------------------------------------------------
// Lexical cron validation — mirrors cron_test.go's rejection matrix.
// The wording is the user-facing contract, pinned byte-identically in
// the Go and Java editions; a change on any side must change all three.
// ---------------------------------------------------------------------------

describe("validateCron", () => {
  const accepted = [
    "0 9 * * *",
    "*/5 * * * *",
    "0 0 1,15 * *",
    "30 8 * * MON-FRI",
    "0 12 * Jan,Apr *",
    "15 8-17 * * 0-6/2",
    "@hourly",
    "@daily",
    "@weekly",
    "@monthly",
    "@yearly",
    "  0 9 * * *  ",
  ];

  for (const cron of accepted) {
    it(`accepts "${cron}"`, () => {
      expect(validateCron(cron)).toBeNull();
    });
  }

  const rejected: readonly { cron: string; message: string }[] = [
    {
      cron: "CRON_TZ=America/New_York 0 9 * * *",
      message:
        "spec.cron must not carry a timezone prefix (CRON_TZ=/TZ=) — spec.time_zone is the single timezone authority",
    },
    {
      cron: "TZ=UTC 0 9 * * *",
      message:
        "spec.cron must not carry a timezone prefix (CRON_TZ=/TZ=) — spec.time_zone is the single timezone authority",
    },
    {
      cron: "@every 30s",
      message:
        "spec.cron must be a calendar expression — @every intervals are not supported",
    },
    {
      cron: "@annually",
      message:
        'spec.cron shorthand "@annually" is not supported — use @hourly, @daily, @weekly, @monthly, or @yearly, or a 5-field cron expression',
    },
    {
      cron: "@midnight",
      message:
        'spec.cron shorthand "@midnight" is not supported — use @hourly, @daily, @weekly, @monthly, or @yearly, or a 5-field cron expression',
    },
    {
      cron: "0 9 * * * # fee reminders",
      message: "spec.cron must not contain a comment (#)",
    },
    {
      cron: "0 9 * * * 2027",
      message:
        "spec.cron must have exactly 5 fields (minute hour day-of-month month day-of-week); got 6",
    },
    {
      cron: "* * * * * * *",
      message:
        "spec.cron must have exactly 5 fields (minute hour day-of-month month day-of-week); got 7",
    },
    {
      cron: "0 9 *",
      message:
        "spec.cron must have exactly 5 fields (minute hour day-of-month month day-of-week); got 3",
    },
    {
      cron: "   ",
      message:
        "spec.cron must have exactly 5 fields (minute hour day-of-month month day-of-week); got 0",
    },
    {
      cron: "0 9 ? * *",
      message:
        `spec.cron field "?" contains unsupported characters — allowed: digits, names, '*', ',', '-', '/'`,
    },
  ];

  for (const { cron, message } of rejected) {
    it(`rejects "${cron}" with the server's exact wording`, () => {
      expect(validateCron(cron)).toBe(message);
    });
  }
});

describe("validateTimeZone", () => {
  for (const zone of ["UTC", "Asia/Kolkata", "America/New_York", "Europe/Berlin"]) {
    it(`accepts "${zone}"`, () => {
      expect(validateTimeZone(zone)).toBeNull();
    });
  }

  for (const zone of ["Not/AZone", "Local"]) {
    it(`rejects "${zone}" with the server's exact wording`, () => {
      expect(validateTimeZone(zone)).toBe(
        `spec.time_zone "${zone}" is not a valid IANA time zone (e.g. "Asia/Kolkata")`,
      );
    });
  }
});
