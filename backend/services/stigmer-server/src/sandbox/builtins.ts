/**
 * The built-in sandbox driver assembly — the name → factory table the
 * composition root hands to newSandboxProvisioner, one entry per tier of
 * DD-002's isolation ladder. Kept separate from provisioner.ts so the
 * contract module never imports driver implementations (extensions
 * compile against the contract alone through the exports map).
 */
import { newDockerSandboxProvisioner } from "./docker.js";
import { newKubernetesSandboxProvisioner } from "./kubernetes.js";
import { newLocalProcessSandboxProvisioner } from "./local-process.js";
import type { SandboxProvisionerFactory } from "./provisioner.js";

export function builtInSandboxProvisionerFactories(): ReadonlyMap<
  string,
  SandboxProvisionerFactory
> {
  return new Map<string, SandboxProvisionerFactory>([
    ["local-process", newLocalProcessSandboxProvisioner],
    ["docker", newDockerSandboxProvisioner],
    ["kubernetes", newKubernetesSandboxProvisioner],
  ]);
}
