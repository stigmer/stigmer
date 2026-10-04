/**
 * The built-in sandbox driver assembly — the name → factory table the
 * composition root hands to newSandboxProvisioner, one entry per tier of
 * the isolation ladder: a process, a Docker container, an agent-sandbox
 * Sandbox on Kubernetes, then Agent Substrate. Kept separate from
 * provisioner.ts so the contract module never imports driver
 * implementations (extensions compile against the contract alone through
 * the exports map).
 */
import { newAgentSandboxProvisioner } from "./agent-sandbox/builtin.js";
import { newDockerSandboxProvisioner } from "./docker.js";
import { newLocalProcessSandboxProvisioner } from "./local-process.js";
import type { SandboxProvisionerFactory } from "./provisioner.js";
import { newSubstrateSandboxProvisioner } from "./substrate/builtin.js";

export function builtInSandboxProvisionerFactories(): ReadonlyMap<
  string,
  SandboxProvisionerFactory
> {
  return new Map<string, SandboxProvisionerFactory>([
    ["local-process", newLocalProcessSandboxProvisioner],
    ["docker", newDockerSandboxProvisioner],
    ["agent-sandbox", newAgentSandboxProvisioner],
    ["substrate", newSubstrateSandboxProvisioner],
  ]);
}
