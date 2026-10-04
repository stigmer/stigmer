/**
 * The agent-sandbox driver as the server composes it: the built-in factory
 * behind SANDBOX_PROVISIONER_TYPE=agent-sandbox. It needs agent-sandbox
 * installed in the cluster (its core manifest is enough: the driver uses
 * the `Sandbox` resource alone) and a namespace, STIGMER_SANDBOX_K8S_NAMESPACE,
 * where the server may read, list, create, patch and delete Sandboxes and
 * create and replace Secrets.
 *
 * Its background work is the idle sweep (sweep.ts), which the composition
 * root starts and stops (provisioner.ts, startBackground), on the windows
 * its own settings name (config.ts). The settings are read, and refused
 * when malformed, when the driver is built, so a bad value fails the boot.
 *
 * A pod cannot reach this process's localhost, so the server's and
 * Temporal's in-cluster addresses are required at boot.
 */
import { KubeConfig } from "@kubernetes/client-node";

import type { SandboxProvisionerFactory } from "../provisioner.js";
import { newAgentSandboxSettingsFromEnv } from "./config.js";
import { newAgentSandboxDriverOverGateway } from "./driver.js";
import { newAgentSandboxClientGateway } from "./gateway.js";
import { startAgentSandboxSweep } from "./sweep.js";

export const newAgentSandboxProvisioner: SandboxProvisionerFactory = ({
  config,
  logger,
}) => {
  if (config.backendEndpoint === "") {
    throw new Error(
      "sandbox provisioner 'agent-sandbox' requires STIGMER_SANDBOX_BACKEND_ENDPOINT — a pod cannot reach the server on this process's localhost",
    );
  }
  if (config.temporalAddress === "") {
    throw new Error(
      "sandbox provisioner 'agent-sandbox' requires STIGMER_SANDBOX_TEMPORAL_ADDRESS (or TEMPORAL_HOST_PORT) reachable from inside the cluster",
    );
  }
  const settings = newAgentSandboxSettingsFromEnv();
  const kubeConfig = new KubeConfig();
  // The in-cluster service account or the operator's kubeconfig, in the
  // client's standard order: what kubectl would use.
  kubeConfig.loadFromDefault();
  const driver = newAgentSandboxDriverOverGateway({
    gateway: newAgentSandboxClientGateway(
      kubeConfig,
      config.kubernetesNamespace,
    ),
    config,
    logger,
  });
  return {
    ...driver.provisioner,
    startBackground: (context) =>
      startAgentSandboxSweep({
        driver: driver.internals,
        settings,
        sessions: context.sessions,
        logger: context.logger,
      }),
  };
};
