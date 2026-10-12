/**
 * The self-hosted Enterprise server's settings of its own
 * (editions/enterprise-config.ts): the license key from
 * `STIGMER_LICENSE_KEY`, trimmed, with an unset or blank variable read as
 * no key; the egress posture from `STIGMER_OUTBOUND_EGRESS`, strict
 * unless the operator says relaxed, any other value refused; and the one
 * reading the entry makes, which reads the egress posture only when a key
 * is present, so a keyless server ignores a typo in it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LICENSE_KEY_VARIABLE,
  OUTBOUND_EGRESS_VARIABLE,
  readEgressPosture,
  readEnterpriseSettings,
  readLicenseKey,
} from "../enterprise-config.js";

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
    expect(readEnterpriseSettings()).toEqual({ licenseKey: "eyJ.from.process", egress: "relaxed" });
  });
});
