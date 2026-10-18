/**
 * Pins an Environment as a sandbox gets it (../facts.ts).
 *
 * What it pins:
 *   - environmentSupportOf: a disabled lane can do nothing, a provisioner
 *     that states no environmentSupport can do nothing, and one that states
 *     it is taken at its word;
 *   - unservableReason: limited networking without limitedNetworking
 *     support is the "cannot enforce" sentence, packages without packages
 *     support the "installs packages" sentence, each naming the
 *     Environment by its slug; what the support covers, and an
 *     unrestricted Environment with no packages, is servable anywhere;
 *   - environmentFactsOf: an Environment with no networking, or
 *     unrestricted, is unrestricted with its packages; a limited one expands
 *     to its listed hosts (normalized), the package-manager hosts only when
 *     allow_package_managers (the apt archives cleartext), and the MCP hosts
 *     handed in only when allow_mcp_servers, each host once, a cleartext
 *     lane kept when any source asks for it.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";

import type { SandboxLane } from "../../../sandbox/lane.js";
import type { EnvironmentHost, EnvironmentSupport, SandboxProvisioner } from "../../../sandbox/provisioner.js";
import type { RunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import {
  NO_ENVIRONMENT_SUPPORT,
  environmentFactsOf,
  environmentSupportOf,
  hasPackages,
  isLimited,
  unservableReason,
} from "../facts.js";
import { APT_ARCHIVE_HOSTS, PACKAGE_MANAGER_HOSTS } from "../package-manager-hosts.js";

function unused(): never {
  throw new Error("the Environment facts never drive the sandbox");
}

function laneStating(support: EnvironmentSupport | undefined): SandboxLane {
  const provisioner: SandboxProvisioner = {
    ...(support === undefined ? {} : { environmentSupport: support }),
    ensureSessionSandbox: async () => unused(),
    deprovisionSessionSandbox: async () => unused(),
    createConnectSandbox: async () => unused(),
    deprovisionConnectSandbox: async () => unused(),
    probe: async () => unused(),
  };
  const credentials: RunnerCredentialProvider = {
    isEnabled: () => unused(),
    mint: () => unused(),
    verify: () => unused(),
  };
  return { enabled: true, provisioner, credentials };
}

const FULL: EnvironmentSupport = { limitedNetworking: true, packages: true };

function environment(spec: {
  networking?: {
    type: NetworkingType;
    allowedHosts?: string[];
    allowPackageManagers?: boolean;
    allowMcpServers?: boolean;
  };
  packages?: { apt?: string[]; npm?: string[]; pip?: string[] };
}): Environment {
  return create(EnvironmentSchema, {
    metadata: { id: "env_01box", org: "org_1", slug: "box" },
    spec,
  });
}

const EMPTY_PACKAGES = { apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] };

describe("environmentSupportOf", () => {
  it("answers nothing for a disabled lane", () => {
    expect(environmentSupportOf({ enabled: false })).toEqual(NO_ENVIRONMENT_SUPPORT);
    expect(NO_ENVIRONMENT_SUPPORT).toEqual({ limitedNetworking: false, packages: false });
  });

  it("answers nothing for a provisioner that states no support, and what one states otherwise", () => {
    expect(environmentSupportOf(laneStating(undefined))).toEqual(NO_ENVIRONMENT_SUPPORT);
    expect(environmentSupportOf(laneStating(FULL))).toEqual(FULL);
    expect(environmentSupportOf(laneStating({ limitedNetworking: true, packages: false }))).toEqual({
      limitedNetworking: true,
      packages: false,
    });
  });
});

describe("unservableReason", () => {
  const limited = environment({ networking: { type: NetworkingType.limited, allowedHosts: ["api.github.com"] } });
  const packaged = environment({ networking: { type: NetworkingType.unrestricted }, packages: { npm: ["typescript"] } });

  it("refuses limited networking a driver cannot enforce, naming the Environment", () => {
    const reason = unservableReason({ limitedNetworking: false, packages: true }, limited);
    expect(reason).toContain("environment 'box'");
    expect(reason).toContain("which this server's sandboxes cannot enforce");
    expect(isLimited(limited)).toBe(true);
  });

  it("refuses packages a driver cannot install, naming the Environment", () => {
    const reason = unservableReason({ limitedNetworking: true, packages: false }, packaged);
    expect(reason).toContain("environment 'box' installs packages");
    expect(reason).toContain("which this server's sandboxes cannot do");
    expect(hasPackages(packaged)).toBe(true);
  });

  it("names an Environment with no slug by its id", () => {
    const unnamed = create(EnvironmentSchema, {
      metadata: { id: "env_01noslug" },
      spec: { networking: { type: NetworkingType.limited } },
    });
    expect(unservableReason(NO_ENVIRONMENT_SUPPORT, unnamed)).toContain("environment 'env_01noslug'");
  });

  it("serves what the support covers, and an unrestricted Environment without packages anywhere", () => {
    expect(unservableReason(FULL, limited)).toBeUndefined();
    expect(unservableReason(FULL, packaged)).toBeUndefined();
    expect(unservableReason(NO_ENVIRONMENT_SUPPORT, environment({}))).toBeUndefined();
    expect(
      unservableReason(NO_ENVIRONMENT_SUPPORT, environment({ networking: { type: NetworkingType.unrestricted } })),
    ).toBeUndefined();
  });
});

describe("environmentFactsOf", () => {
  function byHost(hosts: readonly EnvironmentHost[]): Map<string, boolean> {
    return new Map(hosts.map((entry) => [entry.host, entry.cleartext]));
  }

  it("reads an Environment with no networking, or unrestricted networking, as unrestricted, with its packages", () => {
    expect(environmentFactsOf(environment({ packages: { apt: ["jq"] } }), ["mcp.example.com"])).toEqual({
      id: "env_01box",
      network: { mode: "unrestricted" },
      packages: { ...EMPTY_PACKAGES, apt: ["jq"] },
    });
    expect(
      environmentFactsOf(environment({ networking: { type: NetworkingType.unrestricted } }), []),
    ).toEqual({ id: "env_01box", network: { mode: "unrestricted" }, packages: EMPTY_PACKAGES });
  });

  it("expands a limited Environment to its listed hosts alone when it allows nothing more", () => {
    const facts = environmentFactsOf(
      environment({
        networking: { type: NetworkingType.limited, allowedHosts: ["API.GitHub.com.", "*.example.com"] },
      }),
      ["mcp.linear.app"],
    );
    expect(facts.network).toEqual({
      mode: "limited",
      hosts: [
        { host: "api.github.com", cleartext: false },
        { host: "*.example.com", cleartext: false },
      ],
    });
  });

  it("adds the package-manager hosts only when allowed, the apt archives on plain HTTP too", () => {
    const facts = environmentFactsOf(
      environment({
        networking: {
          type: NetworkingType.limited,
          allowedHosts: ["deb.debian.org", "api.github.com"],
          allowPackageManagers: true,
        },
        packages: { apt: ["jq"] },
      }),
      [],
    );
    expect(facts.network.mode).toBe("limited");
    const hosts = facts.network.mode === "limited" ? facts.network.hosts : [];
    const seen = byHost(hosts);
    // Each host once: the listed api.github.com and deb.debian.org are not repeated by the package list.
    expect(hosts).toHaveLength(seen.size);
    expect(seen.size).toBe(PACKAGE_MANAGER_HOSTS.length);
    for (const archive of APT_ARCHIVE_HOSTS) {
      expect(seen.get(archive), archive).toBe(true);
    }
    expect(seen.get("registry.npmjs.org")).toBe(false);
    expect(seen.get("api.github.com")).toBe(false);
    expect(facts.packages.apt).toEqual(["jq"]);
  });

  it("adds the MCP hosts only when allowed, each once", () => {
    const withoutMcp = environmentFactsOf(
      environment({ networking: { type: NetworkingType.limited, allowedHosts: ["api.github.com"] } }),
      ["mcp.linear.app"],
    );
    expect(withoutMcp.network).toEqual({ mode: "limited", hosts: [{ host: "api.github.com", cleartext: false }] });

    const withMcp = environmentFactsOf(
      environment({
        networking: { type: NetworkingType.limited, allowedHosts: ["api.github.com"], allowMcpServers: true },
      }),
      ["mcp.linear.app", "API.github.com", "mcp.linear.app"],
    );
    expect(withMcp.network).toEqual({
      mode: "limited",
      hosts: [
        { host: "api.github.com", cleartext: false },
        { host: "mcp.linear.app", cleartext: false },
      ],
    });
  });

  it("leaves out the package-manager hosts of a limited Environment that does not allow them", () => {
    const facts = environmentFactsOf(
      environment({ networking: { type: NetworkingType.limited, allowedHosts: [] } }),
      [],
    );
    expect(facts.network).toEqual({ mode: "limited", hosts: [] });
  });
});
