/**
 * Pins how the agent-sandbox driver is selected at boot:
 *
 *   - `agent-sandbox` is a built-in name; the removed `kubernetes` name is
 *     an unknown driver, refused with the list of the known ones;
 *   - the driver refuses to start without the server's and Temporal's
 *     in-cluster addresses, before it reads any kubeconfig, refuses a
 *     malformed idle window, and otherwise builds over the kubeconfig the
 *     client resolves, with the idle sweep as its background work.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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

const cleanups: Array<() => void> = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

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

  it("builds the driver over the kubeconfig the client resolves, as kubectl would, with the idle sweep as its background work", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-sandbox-kubeconfig-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "config");
    writeFileSync(
      path,
      [
        "apiVersion: v1",
        "kind: Config",
        // Port 1 on the loopback refuses at once: no real cluster is reached.
        "clusters: [{name: c, cluster: {server: 'https://127.0.0.1:1'}}]",
        "users: [{name: u, user: {token: t}}]",
        "contexts: [{name: x, context: {cluster: c, user: u}}]",
        "current-context: x",
      ].join("\n"),
    );
    vi.stubEnv("KUBECONFIG", path);
    const provisioner = newAgentSandboxProvisioner({ config, logger });
    expect(typeof provisioner.ensureSessionSandbox).toBe("function");
    expect(typeof provisioner.startBackground).toBe("function");
    // Its sweep starts and stops; the kubeconfig names no reachable
    // cluster, so the pass fails, is logged, and the sweep stays stoppable.
    const lines: string[] = [];
    const recording = createLogger({
      level: "info",
      pretty: false,
      write: (line) => lines.push(line),
    });
    const handle = provisioner.startBackground?.({
      sessions: {
        activity: async () => ({ busy: false, lastActiveAt: undefined }),
        recentActivity: async () => ({ busy: false, lastActiveAt: undefined }),
        sessionIds: async function* () {},
      },
      logger: recording,
    });
    await vi.waitFor(() =>
      expect(lines.join("\n")).toContain(
        "agent-sandbox idle sweep pass failed",
      ),
    );
    await handle?.stop();
  });

  it("refuses a malformed idle window at boot, naming the variable", () => {
    vi.stubEnv("STIGMER_SANDBOX_AGENT_SANDBOX_SUSPEND_AFTER_SECONDS", "soon");
    expect(() => newAgentSandboxProvisioner({ config, logger })).toThrowError(
      "STIGMER_SANDBOX_AGENT_SANDBOX_SUSPEND_AFTER_SECONDS must be a positive whole number of seconds; got soon",
    );
  });
});
