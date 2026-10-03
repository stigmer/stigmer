/**
 * Pins the substrate driver's settings (config.ts): the required values,
 * the defaults, the parsing of the selector and the extra destinations,
 * and the two rules the idle windows must keep (a pause before a suspend;
 * no pause longer than a paused runner can sleep and renew).
 */
import { describe, expect, it } from "vitest";

import { newSubstrateSettingsFromEnv, validateWindows } from "../config.js";

const base: NodeJS.ProcessEnv = {
  STIGMER_SANDBOX_SUBSTRATE_API_ENDPOINT: "https://api.ate-system.svc:443",
  STIGMER_SANDBOX_SUBSTRATE_API_TOKEN_FILE: "/var/run/secrets/ate/token",
  STIGMER_SANDBOX_SUBSTRATE_ROUTER_URL: "http://atenet-router.ate-system.svc//",
  STIGMER_SANDBOX_SUBSTRATE_ATESPACE: "stigmer",
  STIGMER_SANDBOX_SUBSTRATE_STORAGE_LOCATION: "gs://ate-snapshots/stigmer",
  STIGMER_SANDBOX_SUBSTRATE_WORKER_SELECTOR: "workload=stigmer",
};

describe("newSubstrateSettingsFromEnv", () => {
  it("reads the required values and the defaults", () => {
    expect(newSubstrateSettingsFromEnv(base)).toEqual({
      apiEndpoint: "https://api.ate-system.svc:443",
      apiServerName: "",
      apiCaFile: "",
      apiTokenFile: "/var/run/secrets/ate/token",
      routerUrl: "http://atenet-router.ate-system.svc",
      atespace: "stigmer",
      storageLocation: "gs://ate-snapshots/stigmer",
      workerSelector: { workload: "stigmer" },
      sandboxConfigName: "gvisor-default",
      httpsEgress: "all",
      extraHttpEgress: [],
      pauseAfterSeconds: 300,
      suspendAfterSeconds: 1800,
      sweepIntervalSeconds: 60,
    });
  });

  it("names each missing required value", () => {
    for (const key of Object.keys(base)) {
      const env = { ...base, [key]: "" };
      expect(() => newSubstrateSettingsFromEnv(env)).toThrow(key);
    }
  });

  it("parses the selector and the extra destinations, and refuses malformed ones", () => {
    const settings = newSubstrateSettingsFromEnv({
      ...base,
      STIGMER_SANDBOX_SUBSTRATE_WORKER_SELECTOR:
        "workload=stigmer, tier=shared",
      STIGMER_SANDBOX_SUBSTRATE_EGRESS_HTTP:
        "Fake-Model.example:18555,host.docker.internal:7234",
      STIGMER_SANDBOX_SUBSTRATE_EGRESS_HTTPS: "none",
    });
    expect(settings.workerSelector).toEqual({
      workload: "stigmer",
      tier: "shared",
    });
    expect(settings.extraHttpEgress).toEqual([
      { host: "fake-model.example", port: 18555 },
      { host: "host.docker.internal", port: 7234 },
    ]);
    expect(settings.httpsEgress).toBe("none");
    expect(() =>
      newSubstrateSettingsFromEnv({
        ...base,
        STIGMER_SANDBOX_SUBSTRATE_WORKER_SELECTOR: "workload",
      }),
    ).toThrow(/key=value/);
    expect(
      newSubstrateSettingsFromEnv({
        ...base,
        STIGMER_SANDBOX_SUBSTRATE_WORKER_SELECTOR: "workload=stigmer,,",
      }).workerSelector,
    ).toEqual({ workload: "stigmer" });
    expect(() =>
      newSubstrateSettingsFromEnv({
        ...base,
        STIGMER_SANDBOX_SUBSTRATE_WORKER_SELECTOR: " , ",
      }),
    ).toThrow(/names no label/);
    expect(() =>
      newSubstrateSettingsFromEnv({
        ...base,
        STIGMER_SANDBOX_SUBSTRATE_EGRESS_HTTP: "host",
      }),
    ).toThrow(/host:port/);
    expect(() =>
      newSubstrateSettingsFromEnv({
        ...base,
        STIGMER_SANDBOX_SUBSTRATE_EGRESS_HTTPS: "some",
      }),
    ).toThrow(/all or none/);
  });

  it("refuses a Control API that is not TLS and a router that is not a URL", () => {
    expect(() =>
      newSubstrateSettingsFromEnv({
        ...base,
        STIGMER_SANDBOX_SUBSTRATE_API_ENDPOINT: "http://api:80",
      }),
    ).toThrow(/https:\/\//);
    expect(() =>
      newSubstrateSettingsFromEnv({
        ...base,
        STIGMER_SANDBOX_SUBSTRATE_ROUTER_URL: "router:80",
      }),
    ).toThrow(/http:\/\//);
  });

  it("refuses windows that are not positive whole seconds", () => {
    expect(() =>
      newSubstrateSettingsFromEnv({
        ...base,
        STIGMER_SANDBOX_SUBSTRATE_PAUSE_AFTER_SECONDS: "0",
      }),
    ).toThrow(/positive whole number/);
    expect(() =>
      newSubstrateSettingsFromEnv({
        ...base,
        STIGMER_SANDBOX_SUBSTRATE_SUSPEND_AFTER_SECONDS: "1.5",
      }),
    ).toThrow(/positive whole number/);
  });
});

describe("validateWindows", () => {
  it("accepts the shipped windows and the proof's short ones", () => {
    expect(() =>
      validateWindows({ pauseAfterSeconds: 300, suspendAfterSeconds: 1800 }),
    ).not.toThrow();
    expect(() =>
      validateWindows({ pauseAfterSeconds: 60, suspendAfterSeconds: 180 }),
    ).not.toThrow();
  });

  it("refuses a suspend before the pause, and a pause longer than 30 minutes", () => {
    expect(() =>
      validateWindows({ pauseAfterSeconds: 600, suspendAfterSeconds: 600 }),
    ).toThrow(/must be less than/);
    expect(() =>
      validateWindows({
        pauseAfterSeconds: 300,
        suspendAfterSeconds: 300 + 30 * 60 + 1,
      }),
    ).toThrow(/keep a sandbox paused for 1801 s/);
  });
});
