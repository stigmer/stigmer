/**
 * The runner's settings for serving many organizations from one process
 * (`runner-serves.ts`), as the boot reads them.
 *
 * What these pin:
 *  - `STIGMER_RUNNER_SERVES` is `all` unset, takes `all` or `computerless`,
 *    and stops the boot with a sentence on anything else;
 *  - `STIGMER_TURN_MEMORY_MB` is 512 unset, takes a whole number of at least
 *    128, and stops the boot with a sentence on anything else;
 *  - `loadConfig` carries both, and refuses a bad value before anything
 *    else boots;
 *  - a runner that serves only conversations without a computer refuses to
 *    boot without the payload key that opens its turns' sealed credentials;
 *  - it reaches Temporal at the explicit address or the server's own door,
 *    never by discovery, and refuses to boot when it has neither;
 *  - in the cloud it requires a credential on every activity that acts for
 *    a turn, and nowhere else;
 *  - it refuses a conversation with a computer, naming the setting.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../config.js";
import { computerlessCoordinates, mapOptionsToConfig } from "../runner.js";
import {
  DEFAULT_TURN_MEMORY_MB,
  credentialRequiredActivities,
  parseRunnerServes,
  parseTurnMemoryMb,
  refusalForServes,
  servesBootRefusal,
} from "../runner-serves.js";

describe("STIGMER_RUNNER_SERVES", () => {
  it("serves every conversation when unset or empty", () => {
    expect(parseRunnerServes(undefined)).toBe("all");
    expect(parseRunnerServes("")).toBe("all");
  });

  it("takes the two settings it knows", () => {
    expect(parseRunnerServes("all")).toBe("all");
    expect(parseRunnerServes("computerless")).toBe("computerless");
  });

  it("stops the boot on any other value, naming both", () => {
    for (const raw of ["Computerless", "computer-less", "none", " all"]) {
      expect(() => parseRunnerServes(raw)).toThrow(`STIGMER_RUNNER_SERVES=${JSON.stringify(raw)} is not a setting this runner knows`);
    }
    expect(() => parseRunnerServes("nope")).toThrow(/"all".*"computerless"/);
  });
});

describe("STIGMER_TURN_MEMORY_MB", () => {
  it("is 512 when unset or empty", () => {
    expect(DEFAULT_TURN_MEMORY_MB).toBe(512);
    expect(parseTurnMemoryMb(undefined)).toBe(512);
    expect(parseTurnMemoryMb("")).toBe(512);
  });

  it("takes a whole number of megabytes of at least 128", () => {
    expect(parseTurnMemoryMb("128")).toBe(128);
    expect(parseTurnMemoryMb("2048")).toBe(2048);
  });

  it("stops the boot on anything else, naming what it bounds", () => {
    for (const raw of ["127", "0", "-512", "512.5", "1e3", "512MB", "lots", " 512"]) {
      expect(() => parseTurnMemoryMb(raw), raw).toThrow(`STIGMER_TURN_MEMORY_MB=${JSON.stringify(raw)} is not a whole number of megabytes of at least 128`);
    }
  });
});

describe("loadConfig", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { HOME: originalEnv.HOME, PATH: originalEnv.PATH, WORKSPACE_ROOT_DIR: "/tmp/test-workspace" };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("carries both settings, at their defaults when unset", () => {
    expect(loadConfig()).toMatchObject({ serves: "all", turnMemoryMb: 512 });
    process.env.STIGMER_RUNNER_SERVES = "computerless";
    process.env.STIGMER_TURN_MEMORY_MB = "256";
    expect(loadConfig()).toMatchObject({ serves: "computerless", turnMemoryMb: 256 });
  });

  it("refuses a value it does not know", () => {
    process.env.STIGMER_RUNNER_SERVES = "shared";
    expect(() => loadConfig()).toThrow(/STIGMER_RUNNER_SERVES/);
    process.env.STIGMER_RUNNER_SERVES = "all";
    process.env.STIGMER_TURN_MEMORY_MB = "64";
    expect(() => loadConfig()).toThrow(/STIGMER_TURN_MEMORY_MB/);
  });
});

describe("a runner that serves only conversations without a computer", () => {
  it("refuses to boot without the payload key, naming it", () => {
    expect(servesBootRefusal("computerless", undefined)).toMatch(/^STIGMER_RUNNER_SERVES=computerless needs STIGMER_PAYLOAD_ENCRYPTION_KEY/);
    expect(servesBootRefusal("computerless", "")).not.toBeNull();
    expect(servesBootRefusal("computerless", "a2V5")).toBeNull();
    expect(servesBootRefusal("all", undefined), "a runner that serves every conversation needs none").toBeNull();
  });

  it("reaches Temporal at the explicit address, else the server's own door, never by discovery", () => {
    expect(computerlessCoordinates({ temporalAddress: "temporal.internal:7233" }, "https://api.stigmer.example")).toEqual({
      temporalAddress: "temporal.internal:7233",
      temporalNamespace: "default",
    });
    expect(computerlessCoordinates({}, "https://api.stigmer.example")).toEqual({ temporalAddress: "api.stigmer.example:443", temporalNamespace: "default" });
    expect(computerlessCoordinates({ temporalNamespace: "shared" }, "http://stigmer-server:7234")).toEqual({
      temporalAddress: "stigmer-server:7234",
      temporalNamespace: "shared",
    });
  });

  it("refuses to boot when no address is set and the backend endpoint names no server door", () => {
    expect(() => computerlessCoordinates({ temporalAddress: "  " }, "unix:///run/stigmer.sock")).toThrow(
      "STIGMER_RUNNER_SERVES=computerless reaches Temporal through the Stigmer server or at TEMPORAL_SERVICE_ADDRESS, and the backend endpoint unix:///run/stigmer.sock names no server door; set TEMPORAL_SERVICE_ADDRESS",
    );
  });

  it("requires a credential on every activity that acts for a turn, in the cloud only", () => {
    expect([...credentialRequiredActivities("computerless", "cloud")].sort()).toEqual(["ExecuteClaude", "ExecuteDeepAgent", "GenerateSessionSubject"]);
    expect(credentialRequiredActivities("computerless", "local").size).toBe(0);
    expect(credentialRequiredActivities("all", "cloud").size).toBe(0);
  });

  it("refuses a conversation with a computer, naming the setting, and serves one without", () => {
    expect(refusalForServes("computerless", true)).toMatch(/^This conversation has a computer, and this runner serves only conversations without one \(STIGMER_RUNNER_SERVES=computerless\)/);
    expect(refusalForServes("computerless", false)).toBeUndefined();
    expect(refusalForServes("all", true)).toBeUndefined();
  });

  it("is what the static root's options map to, at the defaults when unset", () => {
    const refs = (): [{ current: null }, { current: null }] => [{ current: null }, { current: null }];
    const base = { taskQueue: "q", temporalAddress: "localhost:7233", stigmerEndpoint: "http://localhost:7234" };
    expect(mapOptionsToConfig(base, ...refs())).toMatchObject({ serves: "all", turnMemoryMb: 512 });
    expect(mapOptionsToConfig({ ...base, serves: "computerless", turnMemoryMb: 300 }, ...refs())).toMatchObject({ serves: "computerless", turnMemoryMb: 300 });
  });
});
