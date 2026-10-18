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
 *     Substrate's own namespace), or an address;
 *   - a session's Environment: none gives exactly the rules above; an
 *     `unrestricted` one keeps the HTTPS wildcard and, only when it installs
 *     apt packages, adds a cleartext port-80 rule for every apt archive; a
 *     `limited` one drops the wildcard for HTTPS rules naming its hosts, the
 *     runner's own (runnerPlatformHosts) and the operator's
 *     EGRESS_HTTPS_PLATFORM hosts, each host once, split into rules of at
 *     most 256 names, a cleartext host also a port-80 rule, and under
 *     HTTPS egress `none` it opens no HTTPS rule at all; an archive host
 *     the operator already lists on port 80 stays one rule;
 *   - egressDigest is equal for equal rules and differs for different ones.
 */
import { describe, expect, it } from "vitest";

import { APT_ARCHIVE_HOSTS } from "../../../domain/environment/package-manager-hosts.js";
import type {
  EnvironmentFacts,
  EnvironmentHost,
  EnvironmentPackageSet,
  SandboxDriverConfig,
} from "../../provisioner.js";
import type { SubstrateDriverSettings } from "../config.js";
import { buildEgressRules, egressDigest } from "../egress.js";

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
  serverRelease: "",
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
  platformHttpsHosts: [],
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

const noPackages: EnvironmentPackageSet = {
  apt: [],
  cargo: [],
  gem: [],
  go: [],
  npm: [],
  pip: [],
};

function unrestricted(apt: readonly string[] = []): EnvironmentFacts {
  return {
    id: "env_open",
    network: { mode: "unrestricted" },
    packages: { ...noPackages, apt },
  };
}

function limited(hosts: readonly EnvironmentHost[]): EnvironmentFacts {
  return {
    id: "env_limited",
    network: { mode: "limited", hosts },
    packages: noPackages,
  };
}

const lanes = [
  "http host.docker.internal:7234",
  "http host.docker.internal:7233",
];

describe("a session's Environment", () => {
  const open = { ...settings, httpsEgress: "all" as const };

  it("none gives exactly the rules a sandbox without one gets", () => {
    expect(shape(buildEgressRules(config, open, undefined))).toEqual([
      ...lanes,
      "https *:-",
    ]);
    expect(shape(buildEgressRules(config, settings, undefined))).toEqual(lanes);
  });

  it("unrestricted with apt packages: every apt archive over plain HTTP on port 80, and the HTTPS wildcard kept", () => {
    expect(APT_ARCHIVE_HOSTS.length).toBeGreaterThan(0);
    expect(
      shape(buildEgressRules(config, open, unrestricted(["ripgrep"]))),
    ).toEqual([
      ...lanes,
      ...APT_ARCHIVE_HOSTS.map((host) => `http ${host}:80`),
      "https *:-",
    ]);
  });

  it("an archive host the operator already lists on port 80 is one rule", () => {
    const archive = APT_ARCHIVE_HOSTS[0]!;
    const rules = shape(
      buildEgressRules(config, { ...open, extraHttpEgress: [{ host: archive, port: 80 }] }, unrestricted(["ripgrep"])),
    );
    expect(rules.filter((rule) => rule === `http ${archive}:80`)).toHaveLength(1);
  });

  it("unrestricted without apt packages: no archive lane, the rules a sandbox without one gets", () => {
    expect(
      shape(
        buildEgressRules(config, open, {
          ...unrestricted(),
          packages: { ...noPackages, npm: ["typescript"] },
        }),
      ),
    ).toEqual(shape(buildEgressRules(config, open)));
  });

  it("limited: no wildcard; HTTPS to its hosts, the runner's own and the operator's, each once; a cleartext host also on port 80", () => {
    const rules = buildEgressRules(
      { ...config, runnerSecretEnv: { ANTHROPIC_API_KEY: "sk" } },
      { ...open, platformHttpsHosts: ["vertex.example.com", "example.com"] },
      limited([
        { host: "example.com", cleartext: false },
        { host: "deb.debian.org", cleartext: true },
        // Also a platform host (ANTHROPIC_API_KEY's default).
        { host: "api.anthropic.com", cleartext: false },
      ]),
    );
    expect(shape(rules)).toEqual([
      ...lanes,
      "http deb.debian.org:80",
      "https example.com,deb.debian.org,api.anthropic.com,vertex.example.com:-",
    ]);
    expect(shape(rules).join(" ")).not.toContain("*");
  });

  it("limited with no hosts still opens the runner's own HTTPS hosts", () => {
    expect(
      shape(
        buildEgressRules(
          { ...config, runnerSecretEnv: { CURSOR_API_KEY: "c" } },
          open,
          limited([]),
        ),
      ),
    ).toEqual([
      ...lanes,
      "https api2.cursor.sh,api.cursor.com,api.cursor.sh:-",
    ]);
  });

  it("limited past 256 hostnames: split into rules of at most 256, every host kept in order", () => {
    const hosts = Array.from({ length: 300 }, (_, i) => ({
      host: `h${i}.example.com`,
      cleartext: false,
    }));
    const rules = buildEgressRules(config, open, limited(hosts));
    const https = rules.flatMap((rule) => (rule.https ? [rule.https] : []));
    expect(https.map((rule) => rule.hostnames.length)).toEqual([256, 44]);
    expect(https.flatMap((rule) => rule.hostnames)).toEqual(
      hosts.map(({ host }) => host),
    );
  });

  it("limited under HTTPS egress none: no HTTPS rule at all, only the cleartext lanes", () => {
    const rules = buildEgressRules(
      { ...config, runnerSecretEnv: { ANTHROPIC_API_KEY: "sk" } },
      { ...settings, httpsEgress: "none", platformHttpsHosts: ["vertex.example.com"] },
      limited([
        { host: "example.com", cleartext: false },
        { host: "deb.debian.org", cleartext: true },
      ]),
    );
    expect(rules.some((rule) => rule.https !== undefined)).toBe(false);
    expect(shape(rules)).toEqual([...lanes, "http deb.debian.org:80"]);
  });
});

describe("egressDigest", () => {
  const open = { ...settings, httpsEgress: "all" as const };

  it("is stable for equal rules and differs for different ones", () => {
    const a = limited([{ host: "example.com", cleartext: false }]);
    const b = limited([{ host: "example.org", cleartext: false }]);
    expect(egressDigest(buildEgressRules(config, open, a))).toBe(
      egressDigest(buildEgressRules(config, open, { ...a, id: "env_other" })),
    );
    expect(egressDigest(buildEgressRules(config, open, a))).not.toBe(
      egressDigest(buildEgressRules(config, open, b)),
    );
    expect(egressDigest(buildEgressRules(config, open))).not.toBe(
      egressDigest(buildEgressRules(config, settings)),
    );
    expect(egressDigest([])).toMatch(/^[0-9a-f]{64}$/);
  });
});
