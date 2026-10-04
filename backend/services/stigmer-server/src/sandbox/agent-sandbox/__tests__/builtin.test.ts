/**
 * Pins how the agent-sandbox driver is selected at boot:
 *
 *   - `agent-sandbox` is a built-in name; the removed `kubernetes` name is
 *     an unknown driver, refused with the list of the known ones;
 *   - the driver refuses to start without the server's and Temporal's
 *     in-cluster addresses, before it reads any kubeconfig.
 */
import { describe, expect, it } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import { builtInSandboxProvisionerFactories } from "../../builtins.js";
import {
  newSandboxProvisioner,
  type SandboxDriverConfig,
} from "../../provisioner.js";
import { newAgentSandboxProvisioner } from "../builtin.js";

const logger = createLogger({ level: "error", pretty: false, write: () => {} });

const config: SandboxDriverConfig = {
  backendEndpoint: "http://stigmer-server.stigmer.svc:7234",
  mcpPublicEndpoint: "",
  temporalAddress: "temporal.stigmer.svc:7233",
  temporalNamespace: "stigmer",
  temporalConnectionEnv: {},
  runnerImage: "ghcr.io/stigmer/runner:latest",
  runnerCommand: "stigmer-runner",
  kubernetesNamespace: "stigmer-sandboxes",
  runnerEnv: {},
  runnerSecretEnv: {},
  serverRelease: "",
};

describe("selecting the agent-sandbox driver", () => {
  it("is the built-in behind agent-sandbox, and kubernetes is refused as an unknown driver", () => {
    const builtIns = builtInSandboxProvisionerFactories();
    expect(builtIns.get("agent-sandbox")).toBe(newAgentSandboxProvisioner);
    expect(() =>
      newSandboxProvisioner(
        "kubernetes",
        { config, logger },
        builtIns,
        new Map(),
      ),
    ).toThrowError(
      "unknown sandbox provisioner type 'kubernetes' — known types: 'agent-sandbox', 'docker', 'local-process', 'substrate'",
    );
  });

  it("refuses to start without the in-cluster addresses of the server and Temporal", () => {
    expect(() =>
      newAgentSandboxProvisioner({
        config: { ...config, backendEndpoint: "" },
        logger,
      }),
    ).toThrowError(
      "sandbox provisioner 'agent-sandbox' requires STIGMER_SANDBOX_BACKEND_ENDPOINT — a pod cannot reach the server on this process's localhost",
    );
    expect(() =>
      newAgentSandboxProvisioner({
        config: { ...config, temporalAddress: "" },
        logger,
      }),
    ).toThrowError(
      "sandbox provisioner 'agent-sandbox' requires STIGMER_SANDBOX_TEMPORAL_ADDRESS (or TEMPORAL_HOST_PORT) reachable from inside the cluster",
    );
  });
});
