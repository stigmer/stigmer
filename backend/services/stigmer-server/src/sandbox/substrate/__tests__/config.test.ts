/**
 * Pins the substrate driver's settings (config.ts): the required values,
 * the defaults (one idle window, 300 s), the router's CA, server name and
 * client certificate (only for an https:// router), the parsing of the
 * selector and the extra destinations, the platform HTTPS hosts
 * (EGRESS_HTTPS_PLATFORM, parseHosts: lower-cased, each once, a scheme,
 * port, path or pattern refused), and the settings Substrate 0.6 retired,
 * each refused at boot with where its job went.
 */
import { describe, expect, it } from "vitest";

import { newSubstrateSettingsFromEnv, parseHosts } from "../config.js";

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
      routerCaFile: "",
      routerServerName: "",
      routerClientCertFile: "",
      atespace: "stigmer",
      storageLocation: "gs://ate-snapshots/stigmer",
      workerSelector: { workload: "stigmer" },
      httpsEgress: "all",
      extraHttpEgress: [],
      platformHttpsHosts: [],
      suspendAfterSeconds: 300,
      sweepIntervalSeconds: 30,
    });
  });

  it("refuses each setting Substrate 0.6 retired, naming where its job went", () => {
    for (const [name, home] of [
      ["PAUSE_AFTER_SECONDS", /STIGMER_SANDBOX_SUBSTRATE_SUSPEND_AFTER_SECONDS/],
      ["SANDBOX_CONFIG", /WorkerPool's sandboxClasses/],
      ["NODE_AGENT_PRINCIPAL", /system role of its own/],
    ] as const) {
      const variable = `STIGMER_SANDBOX_SUBSTRATE_${name}`;
      expect(() =>
        newSubstrateSettingsFromEnv({ ...base, [variable]: "300" }),
      ).toThrow(new RegExp(`^${variable} is retired and nothing reads it`));
      expect(() =>
        newSubstrateSettingsFromEnv({ ...base, [variable]: "300" }),
      ).toThrow(home);
      // Set but empty is not set.
      expect(() =>
        newSubstrateSettingsFromEnv({ ...base, [variable]: " " }),
      ).not.toThrow();
    }
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

  it("reads the router's CA, server name and client certificate for an https:// router, and refuses any of them for an http:// one", () => {
    const tls = newSubstrateSettingsFromEnv({
      ...base,
      STIGMER_SANDBOX_SUBSTRATE_ROUTER_URL:
        "https://atenet-router.ate-system.svc",
      STIGMER_SANDBOX_SUBSTRATE_ROUTER_CA_FILE: " /var/run/ate/ca.pem ",
      STIGMER_SANDBOX_SUBSTRATE_ROUTER_SERVER_NAME:
        "atenet-router.ate-system.svc",
      STIGMER_SANDBOX_SUBSTRATE_ROUTER_CLIENT_CERT_FILE:
        "/var/run/podidentity/credential-bundle.pem",
    });
    expect(tls).toMatchObject({
      routerUrl: "https://atenet-router.ate-system.svc",
      routerCaFile: "/var/run/ate/ca.pem",
      routerServerName: "atenet-router.ate-system.svc",
      routerClientCertFile: "/var/run/podidentity/credential-bundle.pem",
    });
    for (const name of [
      "STIGMER_SANDBOX_SUBSTRATE_ROUTER_CA_FILE",
      "STIGMER_SANDBOX_SUBSTRATE_ROUTER_SERVER_NAME",
      "STIGMER_SANDBOX_SUBSTRATE_ROUTER_CLIENT_CERT_FILE",
    ]) {
      expect(() =>
        newSubstrateSettingsFromEnv({ ...base, [name]: "x" }),
      ).toThrow(
        new RegExp(
          `${name} applies only to an https:// router; STIGMER_SANDBOX_SUBSTRATE_ROUTER_URL is http://`,
        ),
      );
    }
  });

  it("refuses windows that are not positive whole seconds", () => {
    expect(() =>
      newSubstrateSettingsFromEnv({
        ...base,
        STIGMER_SANDBOX_SUBSTRATE_SWEEP_INTERVAL_SECONDS: "0",
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

describe("the platform HTTPS hosts (EGRESS_HTTPS_PLATFORM)", () => {
  it("are read lower-cased, each once, from the setting", () => {
    expect(
      newSubstrateSettingsFromEnv({
        ...base,
        STIGMER_SANDBOX_SUBSTRATE_EGRESS_HTTPS_PLATFORM:
          " Vertex.Example.com, proxy.example.com,vertex.example.com., ,",
      }).platformHttpsHosts,
    ).toEqual(["vertex.example.com", "proxy.example.com"]);
  });

  it("refuse a scheme, a port, a path or a pattern, naming the setting", () => {
    for (const entry of [
      "https://vertex.example.com",
      "vertex.example.com:443",
      "vertex.example.com/v1",
      "*.example.com",
      "*",
      "localhost",
    ]) {
      expect(() =>
        newSubstrateSettingsFromEnv({
          ...base,
          STIGMER_SANDBOX_SUBSTRATE_EGRESS_HTTPS_PLATFORM: `ok.example.com,${entry}`,
        }),
      ).toThrow(
        `STIGMER_SANDBOX_SUBSTRATE_EGRESS_HTTPS_PLATFORM entries are host names, with no scheme, port, path or pattern; got ${entry}`,
      );
    }
  });
});

describe("parseHosts", () => {
  it("lower-cases, drops a trailing dot and empty entries, and keeps each host once", () => {
    expect(parseHosts("")).toEqual([]);
    expect(parseHosts("A.Example.COM,b.example.com.,a.example.com")).toEqual([
      "a.example.com",
      "b.example.com",
    ]);
  });

  it("refuses anything that is not a bare host name", () => {
    for (const entry of [
      "http://a.example.com",
      "a.example.com:8443",
      "a.example.com/path",
      "*.example.com",
      "-a.example.com",
    ]) {
      expect(() => parseHosts(entry)).toThrow(/no scheme, port, path or pattern/);
    }
  });
});
