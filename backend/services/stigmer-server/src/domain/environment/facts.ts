/**
 * An Environment as a sandbox gets it, and whether this server's sandboxes
 * can serve it.
 *
 * environmentFactsOf turns the stored row into the seam's facts
 * (sandbox/provisioner.ts EnvironmentFacts): under `limited`, the host list
 * is expanded once here, so every driver enforces the same list: the listed
 * hosts, Managed Agents' package-manager hosts plus Debian's archive when
 * allowed (package-manager-hosts.ts), and the hosts of the agent tree's MCP
 * servers when allowed, each host once, the archives also on plain HTTP.
 *
 * unservableReason is the one sentence a refusal says when the server's
 * sandbox driver cannot do what the Environment asks
 * (SandboxProvisioner.environmentSupport). It is asked when the Environment
 * is saved, when a conversation using it is made, and at each turn
 * (domain/run/environment-admission.ts), because an operator can change the
 * driver after the save.
 */
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";

import type {
  EnvironmentFacts,
  EnvironmentHost,
  EnvironmentPackageSet,
  EnvironmentSupport,
} from "../../sandbox/provisioner.js";
import type { SandboxLane } from "../../sandbox/lane.js";
import { normalizeHost } from "./hosts.js";
import { PACKAGE_MANAGER_HOSTS } from "./package-manager-hosts.js";

/** A driver that states nothing can do neither. */
export const NO_ENVIRONMENT_SUPPORT: EnvironmentSupport = { limitedNetworking: false, packages: false };

/** What the deployment's sandboxes can do with an Environment: nothing when no sandbox lane is composed. */
export function environmentSupportOf(lane: SandboxLane): EnvironmentSupport {
  return lane.enabled ? (lane.provisioner.environmentSupport ?? NO_ENVIRONMENT_SUPPORT) : NO_ENVIRONMENT_SUPPORT;
}

/** Whether the Environment limits networking: `limited` alone; unset reads as unrestricted. */
export function isLimited(environment: Environment): boolean {
  return environment.spec?.networking?.type === NetworkingType.limited;
}

/** The Environment's packages, every manager present. */
export function packagesOf(environment: Environment): EnvironmentPackageSet {
  const p = environment.spec?.packages;
  return {
    apt: [...(p?.apt ?? [])],
    cargo: [...(p?.cargo ?? [])],
    gem: [...(p?.gem ?? [])],
    go: [...(p?.go ?? [])],
    npm: [...(p?.npm ?? [])],
    pip: [...(p?.pip ?? [])],
  };
}

/** Whether the Environment installs anything. */
export function hasPackages(environment: Environment): boolean {
  const p = packagesOf(environment);
  return p.apt.length + p.cargo.length + p.gem.length + p.go.length + p.npm.length + p.pip.length > 0;
}

/** The slug a refusal names the Environment by, else its id. */
export function environmentName(environment: Environment): string {
  return environment.metadata?.slug || environment.metadata?.id || "";
}

/** Why this server's sandboxes cannot serve the Environment, or `undefined` when they can. */
export function unservableReason(support: EnvironmentSupport, environment: Environment): string | undefined {
  const name = environmentName(environment);
  if (isLimited(environment) && !support.limitedNetworking) {
    return `environment '${name}' limits networking to listed hosts, which this server's sandboxes cannot enforce; use unrestricted networking, or a server whose sandboxes run on a driver that limits networking`;
  }
  if (hasPackages(environment) && !support.packages) {
    return `environment '${name}' installs packages, which this server's sandboxes cannot do; remove its packages, or use a server whose sandboxes run on a driver that installs them`;
  }
  return undefined;
}

/**
 * The facts a sandbox gets for the Environment. `mcpHosts` are the agent
 * tree's MCP server hosts, read only for a `limited` Environment that
 * allows them.
 */
export function environmentFactsOf(environment: Environment, mcpHosts: readonly string[]): EnvironmentFacts {
  const id = environment.metadata?.id ?? "";
  const packages = packagesOf(environment);
  const networking = environment.spec?.networking;
  if (!isLimited(environment) || networking === undefined) {
    return { id, network: { mode: "unrestricted" }, packages };
  }
  const hosts = new Map<string, EnvironmentHost>();
  const add = (host: string, cleartext: boolean): void => {
    const name = normalizeHost(host);
    const known = hosts.get(name);
    hosts.set(name, { host: name, cleartext: cleartext || (known?.cleartext ?? false) });
  };
  for (const host of networking.allowedHosts) {
    add(host, false);
  }
  if (networking.allowPackageManagers) {
    for (const entry of PACKAGE_MANAGER_HOSTS) {
      add(entry.host, entry.cleartext);
    }
  }
  if (networking.allowMcpServers) {
    for (const host of mcpHosts) {
      add(host, false);
    }
  }
  return { id, network: { mode: "limited", hosts: [...hosts.values()] }, packages };
}
