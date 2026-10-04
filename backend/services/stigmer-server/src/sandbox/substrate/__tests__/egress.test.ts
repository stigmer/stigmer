/**
 * Pins every actor's egress rules (egress.ts):
 *
 *   - the runner's lanes and the operator's extra destinations as cleartext
 *     rules, and the HTTPS wildcard only when HTTPS egress is on;
 *   - an https:// backend endpoint is a boot throw, whatever the HTTPS
 *     setting (Substrate's gateway can carry TLS only by intercepting it;
 *     Temporal's TLS is its connection settings, refused in driver.ts);
 *   - an https:// public MCP endpoint, a hosted server's public address,
 *     adds no rule: the HTTPS wildcard carries it when HTTPS egress is on,
 *     and nothing does when it is off;
 *   - no rule ever names Substrate's own services: a configured destination
 *     that is the router, the Control API, or anything under `ate-system`
 *     is a boot throw, and so is a pattern, a single-label name (resolved in
 *     Substrate's own namespace), or an address.
 */
import { describe, expect, it } from "vitest";

import type { SandboxDriverConfig } from "../../provisioner.js";
import type { SubstrateDriverSettings } from "../config.js";
import { buildEgressRules } from "../egress.js";

const config: SandboxDriverConfig = {
  backendEndpoint: "http://host.docker.internal:7234",
  mcpPublicEndpoint: "",
  temporalAddress: "host.docker.internal:7233",
  temporalNamespace: "default",
  temporalConnectionEnv: {},
  runnerImage: `r@sha256:${"a".repeat(64)}`,
  runnerCommand: "",
  kubernetesNamespace: "",
  runnerEnv: {},
  runnerSecretEnv: {},
};

const settings: SubstrateDriverSettings = {
  apiEndpoint: "https://api.ate-system.svc:443",
  apiServerName: "",
  apiCaFile: "",
  apiTokenFile: "/unused",
  routerUrl: "http://127.0.0.1:18200",
  routerCaFile: "",
  routerServerName: "",
  atespace: "stigmer",
  storageLocation: "gs://b/p",
  workerSelector: { workload: "stigmer" },
  sandboxConfigName: "gvisor-default",
  httpsEgress: "none",
  extraHttpEgress: [],
  pauseAfterSeconds: 300,
  suspendAfterSeconds: 1800,
  sweepIntervalSeconds: 60,
};

function shape(rules: ReturnType<typeof buildEgressRules>) {
  return rules.map((r) =>
    r.http
      ? `http ${r.http.hostnames.join(",")}:${r.http.ports?.numbers.join(",") ?? "-"}`
      : `https ${r.https?.hostnames.join(",")}:${r.https?.ports?.numbers.join(",") ?? "-"}`,
  );
}

describe("the rules", () => {
  it("allow the runner's plain lanes, once each, and nothing else when HTTPS egress is off", () => {
    expect(shape(buildEgressRules(config, settings))).toEqual([
      "http host.docker.internal:7234",
      "http host.docker.internal:7233",
    ]);
  });

  it("add the operator's destinations and, with HTTPS egress on, the wildcard", () => {
    const rules = buildEgressRules(
      {
        ...config,
        backendEndpoint: "http://stigmer.stigmer.svc:7234",
        temporalAddress: "temporal.temporal.svc:7233",
        mcpPublicEndpoint: "http://stigmer.stigmer.svc:7234",
      },
      {
        ...settings,
        httpsEgress: "all",
        extraHttpEgress: [{ host: "fake-model.example", port: 18555 }],
      },
    );
    expect(shape(rules)).toEqual([
      "http stigmer.stigmer.svc:7234",
      "http temporal.temporal.svc:7233",
      "http fake-model.example:18555",
      "https *:-",
    ]);
  });
});

describe("a runner lane over TLS", () => {
  it("is a boot throw, whatever the HTTPS setting, until Substrate forwards TLS untouched", () => {
    for (const httpsEgress of ["all", "none"] as const) {
      expect(() =>
        buildEgressRules(
          { ...config, backendEndpoint: "https://stigmer.example.com" },
          { ...settings, httpsEgress },
        ),
      ).toThrow(
        /STIGMER_SANDBOX_BACKEND_ENDPOINT is a TLS lane \(stigmer\.example\.com:443\)/,
      );
    }
  });
});

describe("an https:// public MCP endpoint", () => {
  it("adds no rule: the HTTPS wildcard carries it when HTTPS egress is on, and nothing when it is off", () => {
    const hosted = { ...config, mcpPublicEndpoint: "https://api.stigmer.ai" };
    expect(
      shape(buildEgressRules(hosted, { ...settings, httpsEgress: "all" })),
    ).toEqual([
      "http host.docker.internal:7234",
      "http host.docker.internal:7233",
      "https *:-",
    ]);
    expect(
      shape(buildEgressRules(hosted, { ...settings, httpsEgress: "none" })),
    ).toEqual([
      "http host.docker.internal:7234",
      "http host.docker.internal:7233",
    ]);
  });

  it("is still read as a URL, so a malformed one is a boot throw", () => {
    expect(() =>
      buildEgressRules(
        { ...config, mcpPublicEndpoint: "https://[bad" },
        settings,
      ),
    ).toThrow(/STIGMER_SANDBOX_MCP_PUBLIC_ENDPOINT is not a URL/);
  });
});

describe("what no rule may name", () => {
  it("Substrate's router and Control API, by their configured hosts", () => {
    expect(() =>
      buildEgressRules(
        { ...config, backendEndpoint: "http://api.ate-system.svc:443" },
        settings,
      ),
    ).toThrow(/Substrate's own services/);
    expect(() =>
      buildEgressRules(config, {
        ...settings,
        routerUrl: "http://router.example",
        extraHttpEgress: [{ host: "router.example", port: 80 }],
      }),
    ).toThrow(/Substrate's own services/);
  });

  it("anything under ate-system, however it is spelled", () => {
    for (const host of [
      "atenet-router.ate-system",
      "atenet-router.ate-system.svc",
      "atenet-router.ate-system.svc.cluster.local",
      "atenet-router.ate-system.svc.cluster.local.",
    ]) {
      expect(() =>
        buildEgressRules(config, {
          ...settings,
          extraHttpEgress: [{ host, port: 80 }],
        }),
      ).toThrow(/Substrate's own services/);
    }
  });

  it("a pattern, which would admit Substrate's services, wherever it is given", () => {
    for (const host of ["*", "*.svc", "*.ate-system.svc.cluster.local"]) {
      expect(() =>
        buildEgressRules(config, {
          ...settings,
          extraHttpEgress: [{ host, port: 80 }],
        }),
      ).toThrow(/names the pattern/);
    }
    expect(() =>
      buildEgressRules(
        { ...config, mcpPublicEndpoint: "http://*.example.com" },
        settings,
      ),
    ).toThrow(/STIGMER_SANDBOX_MCP_PUBLIC_ENDPOINT names the pattern/);
  });

  it("a single-label name, which the gateway resolves among Substrate's own services", () => {
    for (const host of ["atenet-router", "api", "localhost", "localhost."]) {
      expect(() =>
        buildEgressRules(config, {
          ...settings,
          extraHttpEgress: [{ host, port: 80 }],
        }),
      ).toThrow(/single-label name/);
    }
    expect(() =>
      buildEgressRules(
        { ...config, temporalAddress: "temporal:7233" },
        settings,
      ),
    ).toThrow(
      /STIGMER_SANDBOX_TEMPORAL_ADDRESS names temporal, a single-label/,
    );
  });

  it("an address instead of a host", () => {
    expect(() =>
      buildEgressRules(
        { ...config, backendEndpoint: "http://10.0.0.5:7234" },
        settings,
      ),
    ).toThrow(/names the address 10\.0\.0\.5/);
    expect(() =>
      buildEgressRules({ ...config, backendEndpoint: "http://[bad" }, settings),
    ).toThrow(/is not a URL or host:port/);
  });
});
