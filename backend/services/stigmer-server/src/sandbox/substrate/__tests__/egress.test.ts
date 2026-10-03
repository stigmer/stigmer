/**
 * Pins every actor's egress rules (egress.ts):
 *
 *   - the runner's lanes as cleartext rules when plain and HTTPS rules when
 *     TLS, the operator's extra destinations, and the HTTPS wildcard only
 *     when HTTPS egress is on;
 *   - no rule ever names Substrate's own services: a configured destination
 *     that is the router, the Control API, or anything under `ate-system`
 *     is a boot throw, and so is one given as an address.
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

  it("make a TLS lane an HTTPS rule, and add the operator's destinations and the wildcard", () => {
    const rules = buildEgressRules(
      {
        ...config,
        backendEndpoint: "https://stigmer.example.com",
        temporalAddress: "temporal.example.com:7233",
        temporalConnectionEnv: { STIGMER_TEMPORAL_TLS: "true" },
        mcpPublicEndpoint: "https://stigmer.example.com",
      },
      {
        ...settings,
        httpsEgress: "all",
        extraHttpEgress: [{ host: "fake-model.example", port: 18555 }],
      },
    );
    expect(shape(rules)).toEqual([
      "https stigmer.example.com:443",
      "https temporal.example.com:7233",
      "http fake-model.example:18555",
      "https *:-",
    ]);
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
