/**
 * The self-hosted Enterprise server's settings of its own
 * (editions/enterprise-config.ts): the license key from
 * `STIGMER_LICENSE_KEY`, trimmed, with an unset or blank variable read as
 * no key; the egress posture from `STIGMER_OUTBOUND_EGRESS`, strict
 * unless the operator says relaxed, any other value refused; and the one
 * reading the entry makes, which reads the egress posture only when a key
 * is present, so a keyless server ignores a typo in it; and the access
 * history's window from `STIGMER_ACCESS_HISTORY_RETENTION_DAYS`, unset or
 * blank keeping everything, a whole number of days of at least 1, any
 * other value refused, read only with a key as the egress posture is; and
 * who may create an organization from `STIGMER_ORGANIZATION_CREATORS`,
 * unset, blank or `anyone` meaning anyone signed in, otherwise account ids
 * trimmed and collapsed, any entry that is not one refused by name, read
 * only with a key.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCESS_HISTORY_RETENTION_VARIABLE,
  LICENSE_KEY_VARIABLE,
  ORGANIZATION_CREATORS_VARIABLE,
  OUTBOUND_EGRESS_VARIABLE,
  readAccessHistoryRetentionDays,
  readEgressPosture,
  readEnterpriseSettings,
  readLicenseKey,
  readOrganizationCreators,
} from "../enterprise-config.js";

const ALICE = "ida_0123456789abcdefghjkmnpqrs";
const BOB = "ida_tvwxyz0123456789abcdefghjk";

describe("readLicenseKey", () => {
  it("reads the key from STIGMER_LICENSE_KEY, trimmed", () => {
    expect(LICENSE_KEY_VARIABLE).toBe("STIGMER_LICENSE_KEY");
    expect(readLicenseKey({ STIGMER_LICENSE_KEY: "  eyJ.a.b \n" })).toBe("eyJ.a.b");
  });

  it.each([
    ["unset", {}],
    ["empty", { STIGMER_LICENSE_KEY: "" }],
    ["blank", { STIGMER_LICENSE_KEY: " \t\n" }],
  ])("reads no key when the variable is %s", (_name, env) => {
    expect(readLicenseKey(env)).toBeUndefined();
  });

  it("reads the process's environment by default", () => {
    const before = process.env[LICENSE_KEY_VARIABLE];
    try {
      process.env[LICENSE_KEY_VARIABLE] = "eyJ.from.process";
      expect(readLicenseKey()).toBe("eyJ.from.process");
    } finally {
      if (before === undefined) {
        delete process.env[LICENSE_KEY_VARIABLE];
      } else {
        process.env[LICENSE_KEY_VARIABLE] = before;
      }
    }
  });
});

describe("readEgressPosture", () => {
  it.each([
    ["unset", {}],
    ["empty", { STIGMER_OUTBOUND_EGRESS: "" }],
    ["strict", { STIGMER_OUTBOUND_EGRESS: " strict " }],
  ])("is strict when the variable is %s", (_name, env) => {
    expect(OUTBOUND_EGRESS_VARIABLE).toBe("STIGMER_OUTBOUND_EGRESS");
    expect(readEgressPosture(env)).toBe("strict");
  });

  it("is relaxed only when the operator writes relaxed", () => {
    expect(readEgressPosture({ STIGMER_OUTBOUND_EGRESS: "relaxed" })).toBe("relaxed");
  });

  it.each(["open", "RELAXED", "off"])("refuses %s rather than guessing", (value) => {
    expect(() => readEgressPosture({ STIGMER_OUTBOUND_EGRESS: value })).toThrow(
      `STIGMER_OUTBOUND_EGRESS must be "strict" or "relaxed"; it is "${value}"`,
    );
  });
});

describe("readAccessHistoryRetentionDays", () => {
  it.each([
    ["unset", {}],
    ["empty", { STIGMER_ACCESS_HISTORY_RETENTION_DAYS: "" }],
    ["blank", { STIGMER_ACCESS_HISTORY_RETENTION_DAYS: " \t" }],
  ])("keeps everything when the variable is %s", (_name, env) => {
    expect(ACCESS_HISTORY_RETENTION_VARIABLE).toBe("STIGMER_ACCESS_HISTORY_RETENTION_DAYS");
    expect(readAccessHistoryRetentionDays(env)).toBeUndefined();
  });

  it.each([
    ["365", 365],
    [" 30 ", 30],
    ["1", 1],
    ["0400", 400],
  ])("reads %j as that many days", (value, days) => {
    expect(readAccessHistoryRetentionDays({ STIGMER_ACCESS_HISTORY_RETENTION_DAYS: value })).toBe(days);
  });

  it.each(["0", "-5", "365d", "1y", "1.5", "1e3", "99999999999999999999"])(
    "refuses %s rather than guessing",
    (value) => {
      expect(() => readAccessHistoryRetentionDays({ STIGMER_ACCESS_HISTORY_RETENTION_DAYS: value })).toThrow(
        `STIGMER_ACCESS_HISTORY_RETENTION_DAYS must be a whole number of days, at least 1, or unset to keep the access history for good; it is "${value}"`,
      );
    },
  );
});

describe("readOrganizationCreators", () => {
  it.each([
    ["unset", {}],
    ["empty", { STIGMER_ORGANIZATION_CREATORS: "" }],
    ["blank", { STIGMER_ORGANIZATION_CREATORS: " \t" }],
    ["anyone", { STIGMER_ORGANIZATION_CREATORS: " anyone " }],
  ])("leaves creation to anyone signed in when the variable is %s", (_name, env) => {
    expect(ORGANIZATION_CREATORS_VARIABLE).toBe("STIGMER_ORGANIZATION_CREATORS");
    expect(readOrganizationCreators(env)).toBeUndefined();
  });

  it("reads one account id", () => {
    expect(readOrganizationCreators({ STIGMER_ORGANIZATION_CREATORS: ALICE })).toEqual(new Set([ALICE]));
  });

  it("trims each entry and collapses duplicates", () => {
    expect(
      readOrganizationCreators({ STIGMER_ORGANIZATION_CREATORS: ` ${ALICE} ,\n${BOB},${ALICE} ` }),
    ).toEqual(new Set([ALICE, BOB]));
  });

  it.each([
    ["an email", "admin@acme.example"],
    ["a subject", "auth0|abc123"],
    ["an upper-case id", ALICE.toUpperCase()],
    ["an id one character short", ALICE.slice(0, -1)],
    ["an id outside Crockford's alphabet", "ida_0123456789abcdefghjkmnpqri"],
    ["another kind's id", "org_0123456789abcdefghjkmnpqrs"],
  ])("refuses %s, naming the entry", (_name, entry) => {
    expect(() => readOrganizationCreators({ STIGMER_ORGANIZATION_CREATORS: `${ALICE},${entry}` })).toThrow(
      `STIGMER_ORGANIZATION_CREATORS must be "anyone" or comma-separated account ids (ida_ and 26 characters, as stigmer auth whoami prints them); "${entry}" is not one`,
    );
  });

  it.each([`${ALICE},,${BOB}`, `${ALICE},`, `,${ALICE}`])("refuses an empty entry in %j", (value) => {
    expect(() => readOrganizationCreators({ STIGMER_ORGANIZATION_CREATORS: value })).toThrow(
      `STIGMER_ORGANIZATION_CREATORS has an empty entry; it is "${value}"`,
    );
  });

  it("refuses anyone inside a list rather than reading the list as open", () => {
    expect(() => readOrganizationCreators({ STIGMER_ORGANIZATION_CREATORS: `${ALICE}, anyone` })).toThrow(
      `STIGMER_ORGANIZATION_CREATORS is either "anyone" or a list of account ids, not both; it is "${ALICE}, anyone"`,
    );
  });
});

describe("readEnterpriseSettings", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never reads the egress variable without a key, so a typo in it cannot refuse the boot", () => {
    expect(readEnterpriseSettings({ STIGMER_OUTBOUND_EGRESS: "bogus" })).toEqual({ licenseKey: undefined });
    expect(readEnterpriseSettings({ STIGMER_LICENSE_KEY: " ", STIGMER_OUTBOUND_EGRESS: "bogus" })).toEqual({
      licenseKey: undefined,
    });
  });

  it("never reads the retention variable without a key, and reads it with one", () => {
    expect(readEnterpriseSettings({ STIGMER_ACCESS_HISTORY_RETENTION_DAYS: "1y" })).toEqual({
      licenseKey: undefined,
    });
    expect(
      readEnterpriseSettings({ STIGMER_LICENSE_KEY: "eyJ.a.b", STIGMER_ACCESS_HISTORY_RETENTION_DAYS: "365" }),
    ).toEqual({ licenseKey: "eyJ.a.b", egress: "strict", accessHistoryRetentionDays: 365 });
    expect(() =>
      readEnterpriseSettings({ STIGMER_LICENSE_KEY: "eyJ.a.b", STIGMER_ACCESS_HISTORY_RETENTION_DAYS: "1y" }),
    ).toThrow(`STIGMER_ACCESS_HISTORY_RETENTION_DAYS must be a whole number of days, at least 1`);
  });

  it("never reads the creators variable without a key, and reads it with one", () => {
    expect(readEnterpriseSettings({ STIGMER_ORGANIZATION_CREATORS: "admin@acme.example" })).toEqual({
      licenseKey: undefined,
    });
    expect(readEnterpriseSettings({ STIGMER_LICENSE_KEY: "eyJ.a.b", STIGMER_ORGANIZATION_CREATORS: ALICE })).toEqual({
      licenseKey: "eyJ.a.b",
      egress: "strict",
      organizationCreators: new Set([ALICE]),
    });
    expect(readEnterpriseSettings({ STIGMER_LICENSE_KEY: "eyJ.a.b", STIGMER_ORGANIZATION_CREATORS: "anyone" })).toEqual({
      licenseKey: "eyJ.a.b",
      egress: "strict",
    });
    expect(() =>
      readEnterpriseSettings({ STIGMER_LICENSE_KEY: "eyJ.a.b", STIGMER_ORGANIZATION_CREATORS: "admin@acme.example" }),
    ).toThrow(`"admin@acme.example" is not one`);
  });

  it("reads the egress posture with a key, and refuses an unknown value", () => {
    expect(readEnterpriseSettings({ STIGMER_LICENSE_KEY: "eyJ.a.b", STIGMER_OUTBOUND_EGRESS: "relaxed" })).toEqual({
      licenseKey: "eyJ.a.b",
      egress: "relaxed",
    });
    expect(readEnterpriseSettings({ STIGMER_LICENSE_KEY: "eyJ.a.b" })).toEqual({ licenseKey: "eyJ.a.b", egress: "strict" });
    expect(() =>
      readEnterpriseSettings({ STIGMER_LICENSE_KEY: "eyJ.a.b", STIGMER_OUTBOUND_EGRESS: "bogus" }),
    ).toThrow(`STIGMER_OUTBOUND_EGRESS must be "strict" or "relaxed"; it is "bogus"`);
  });

  it("reads the process's environment by default", () => {
    vi.stubEnv(LICENSE_KEY_VARIABLE, "eyJ.from.process");
    vi.stubEnv(OUTBOUND_EGRESS_VARIABLE, "relaxed");
    vi.stubEnv(ACCESS_HISTORY_RETENTION_VARIABLE, "90");
    vi.stubEnv(ORGANIZATION_CREATORS_VARIABLE, BOB);
    expect(readEnterpriseSettings()).toEqual({
      licenseKey: "eyJ.from.process",
      egress: "relaxed",
      accessHistoryRetentionDays: 90,
      organizationCreators: new Set([BOB]),
    });
  });
});
