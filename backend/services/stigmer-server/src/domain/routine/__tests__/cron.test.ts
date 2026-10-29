/**
 * Pins the lexical cron/timezone validation matrix: every message is
 * cross-edition byte contract, and the time-zone arms answer what the
 * Temporal server's zone lookup would load.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  isLoadableTimeZone,
  validateRoutineCron,
  validateRoutineTimeZone,
} from "../cron.js";

function refusal(run: () => void): ConnectError {
  try {
    run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("validateRoutineCron — accepted grammar", () => {
  it.each([
    "* * * * *",
    "0 9 * * *",
    "*/5 * * * *",
    "0 9 * * MON-FRI",
    "30 8 1,15 * *",
    "0 0 1 Jan *",
    "@hourly",
    "@daily",
    "@weekly",
    "@monthly",
    "@yearly",
  ])("accepts %j", (cron) => {
    expect(() => validateRoutineCron(cron)).not.toThrow();
  });

  it("accepts fields separated by runs of whitespace", () => {
    expect(() => validateRoutineCron("0  9   *  *  *")).not.toThrow();
  });
});

describe("validateRoutineCron — rejection matrix (byte-pinned copy)", () => {
  it("rejects a CRON_TZ= prefix", () => {
    const err = refusal(() => validateRoutineCron("CRON_TZ=UTC 0 9 * * *"));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(
      "spec.cron must not carry a timezone prefix (CRON_TZ=/TZ=) — spec.time_zone is the single timezone authority",
    );
  });

  it("rejects a TZ= prefix", () => {
    const err = refusal(() => validateRoutineCron("TZ=UTC 0 9 * * *"));
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("rejects a trailing comment", () => {
    const err = refusal(() => validateRoutineCron("0 9 * * * # daily"));
    expect(err.rawMessage).toBe("spec.cron must not contain a comment (#)");
  });

  it("rejects @every intervals", () => {
    const err = refusal(() => validateRoutineCron("@every 5m"));
    expect(err.rawMessage).toBe(
      "spec.cron must be a calendar expression — @every intervals are not supported",
    );
  });

  it.each(["@annually", "@midnight", "@reboot"])(
    "rejects the nonstandard shorthand %j with the supported list",
    (cron) => {
      const err = refusal(() => validateRoutineCron(cron));
      expect(err.rawMessage).toBe(
        `spec.cron shorthand "${cron}" is not supported — use @hourly, @daily, @weekly, @monthly, or @yearly, or a 5-field cron expression`,
      );
    },
  );

  it.each([
    ["0 9 * *", 4],
    ["0 9 * * * *", 6],
    ["0 9 * * * * 2026", 7],
    ["", 0],
  ])("rejects %j with the field count %i", (cron, count) => {
    const err = refusal(() => validateRoutineCron(cron));
    expect(err.rawMessage).toBe(
      `spec.cron must have exactly 5 fields (minute hour day-of-month month day-of-week); got ${count}`,
    );
  });

  it("rejects '?' via the field character set", () => {
    const err = refusal(() => validateRoutineCron("? 9 * * *"));
    expect(err.rawMessage).toBe(
      `spec.cron field "?" contains unsupported characters — allowed: digits, names, '*', ',', '-', '/'`,
    );
  });

  it("rejects '1#3' via the comment check (the '#' rule fires first)", () => {
    const err = refusal(() => validateRoutineCron("1#3 9 * * *"));
    expect(err.rawMessage).toBe("spec.cron must not contain a comment (#)");
  });

  it("accepts bare letters like 'L' lexically (the charset allows name letters; Temporal refuses downstream at artifact create)", () => {
    // Deliberate: the character class exists for month/day NAMES
    // (Jan, MON) and incidentally passes single letters — the lexical
    // validator is a grammar restriction, not a cron parser.
    expect(() => validateRoutineCron("L 9 * * *")).not.toThrow();
    expect(() => validateRoutineCron("W 9 * * *")).not.toThrow();
  });
});

describe("validateRoutineTimeZone", () => {
  it.each(["UTC", "Asia/Kolkata", "America/New_York", "Europe/Berlin"])(
    "accepts the IANA zone %j",
    (zone) => {
      expect(() => validateRoutineTimeZone(zone)).not.toThrow();
    },
  );

  it("accepts the empty zone (UTC to Temporal)", () => {
    expect(() => validateRoutineTimeZone("")).not.toThrow();
  });

  it("rejects 'Local' explicitly (nondeterministic across replicas)", () => {
    const err = refusal(() => validateRoutineTimeZone("Local"));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(
      'spec.time_zone "Local" is not a valid IANA time zone (e.g. "Asia/Kolkata")',
    );
  });

  it.each(["Not/AZone", "Mars/Olympus", "gibberish"])(
    "rejects the unknown zone %j with the byte-pinned copy",
    (zone) => {
      const err = refusal(() => validateRoutineTimeZone(zone));
      expect(err.rawMessage).toBe(
        `spec.time_zone "${zone}" is not a valid IANA time zone (e.g. "Asia/Kolkata")`,
      );
    },
  );

  it("rejects a case variant of a canonical zone (the Temporal server's tzdata lookup is case-sensitive)", () => {
    // ICU resolves "america/new_york" case-insensitively; the Temporal
    // server's file lookup does not — the canonical-set guard keeps that
    // refusal (cron.ts isLoadableTimeZone). Case variants of ALIAS names
    // (e.g. "asia/kolkata" where ICU's canonical is Asia/Calcutta) are a
    // known gap — the guard can only see ICU's canonical list.
    expect(isLoadableTimeZone("america/new_york")).toBe(false);
    expect(() => validateRoutineTimeZone("america/new_york")).toThrow();
  });

  it("accepts genuine alias/link zones", () => {
    // "US/Pacific" is a tzdata link and "Asia/Kolkata" an ICU alias of
    // Asia/Calcutta; tzdata and ICU both resolve them.
    expect(isLoadableTimeZone("US/Pacific")).toBe(true);
    expect(isLoadableTimeZone("Asia/Kolkata")).toBe(true);
  });
});
