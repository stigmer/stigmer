/**
 * Pins the lexical cron/timezone validation matrix against Go's
 * cron_test.go — the shared rejection matrix is pinned by unit tests in
 * both editions (and in the cloud Java edition), because every message is
 * cross-edition byte contract.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  isLoadableTimeZone,
  validateScheduleCron,
  validateScheduleTimeZone,
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

describe("validateScheduleCron — accepted grammar", () => {
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
    expect(() => validateScheduleCron(cron)).not.toThrow();
  });

  it("accepts fields separated by runs of whitespace (Go strings.Fields)", () => {
    expect(() => validateScheduleCron("0  9   *  *  *")).not.toThrow();
  });
});

describe("validateScheduleCron — rejection matrix (byte-pinned copy)", () => {
  it("rejects a CRON_TZ= prefix", () => {
    const err = refusal(() => validateScheduleCron("CRON_TZ=UTC 0 9 * * *"));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(
      "spec.cron must not carry a timezone prefix (CRON_TZ=/TZ=) — spec.time_zone is the single timezone authority",
    );
  });

  it("rejects a TZ= prefix", () => {
    const err = refusal(() => validateScheduleCron("TZ=UTC 0 9 * * *"));
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("rejects a trailing comment", () => {
    const err = refusal(() => validateScheduleCron("0 9 * * * # daily"));
    expect(err.rawMessage).toBe("spec.cron must not contain a comment (#)");
  });

  it("rejects @every intervals", () => {
    const err = refusal(() => validateScheduleCron("@every 5m"));
    expect(err.rawMessage).toBe(
      "spec.cron must be a calendar expression — @every intervals are not supported",
    );
  });

  it.each(["@annually", "@midnight", "@reboot"])(
    "rejects the nonstandard shorthand %j with the supported list",
    (cron) => {
      const err = refusal(() => validateScheduleCron(cron));
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
    const err = refusal(() => validateScheduleCron(cron));
    expect(err.rawMessage).toBe(
      `spec.cron must have exactly 5 fields (minute hour day-of-month month day-of-week); got ${count}`,
    );
  });

  it("rejects '?' via the field character set", () => {
    const err = refusal(() => validateScheduleCron("? 9 * * *"));
    expect(err.rawMessage).toBe(
      `spec.cron field "?" contains unsupported characters — allowed: digits, names, '*', ',', '-', '/'`,
    );
  });

  it("rejects '1#3' via the comment check (the '#' rule fires first, as in Go)", () => {
    const err = refusal(() => validateScheduleCron("1#3 9 * * *"));
    expect(err.rawMessage).toBe("spec.cron must not contain a comment (#)");
  });

  it("accepts bare letters like 'L' lexically (Go's charset allows name letters; Temporal refuses downstream at artifact create)", () => {
    // Deliberate Go-parity: the character class exists for month/day NAMES
    // (Jan, MON) and incidentally passes single letters — the lexical
    // validator is a grammar restriction, not a cron parser (DD-009 C-4).
    expect(() => validateScheduleCron("L 9 * * *")).not.toThrow();
    expect(() => validateScheduleCron("W 9 * * *")).not.toThrow();
  });
});

describe("validateScheduleTimeZone", () => {
  it.each(["UTC", "Asia/Kolkata", "America/New_York", "Europe/Berlin"])(
    "accepts the IANA zone %j",
    (zone) => {
      expect(() => validateScheduleTimeZone(zone)).not.toThrow();
    },
  );

  it("accepts the empty zone (Go LoadLocation('') is UTC)", () => {
    expect(() => validateScheduleTimeZone("")).not.toThrow();
  });

  it("rejects 'Local' explicitly (nondeterministic across replicas; Java never resolves it)", () => {
    const err = refusal(() => validateScheduleTimeZone("Local"));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(
      'spec.time_zone "Local" is not a valid IANA time zone (e.g. "Asia/Kolkata")',
    );
  });

  it.each(["Not/AZone", "Mars/Olympus", "gibberish"])(
    "rejects the unknown zone %j with the byte-pinned copy",
    (zone) => {
      const err = refusal(() => validateScheduleTimeZone(zone));
      expect(err.rawMessage).toBe(
        `spec.time_zone "${zone}" is not a valid IANA time zone (e.g. "Asia/Kolkata")`,
      );
    },
  );

  it("rejects a case variant of a canonical zone (Go's tzdata lookup is case-sensitive)", () => {
    // ICU resolves "america/new_york" case-insensitively; Go's file lookup
    // does not — the canonical-set guard restores Go's refusal (cron.ts
    // isLoadableTimeZone). Case variants of ALIAS names (e.g.
    // "asia/kolkata" where ICU's canonical is Asia/Calcutta) remain a
    // disclosed residual divergence — the guard can only see ICU's
    // canonical list.
    expect(isLoadableTimeZone("america/new_york")).toBe(false);
    expect(() => validateScheduleTimeZone("america/new_york")).toThrow();
  });

  it("accepts genuine alias/link zones as Go does", () => {
    // "US/Pacific" is a tzdata link and "Asia/Kolkata" an ICU alias of
    // Asia/Calcutta; Go's tzdata and ICU both resolve them.
    expect(isLoadableTimeZone("US/Pacific")).toBe(true);
    expect(isLoadableTimeZone("Asia/Kolkata")).toBe(true);
  });
});
