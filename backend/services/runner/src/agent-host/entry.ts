/**
 * The agent host process: the runner's own entry started as `main.js
 * agent-host` by the runner's supervisor (`supervisor.ts`), serving the
 * runner over the pipe on fd 3 until that pipe closes.
 *
 * What this process installs for the engines it runs, and the runner's
 * process never does:
 *
 *  - the model registry's route through the runner's local proxy
 *    (`shared/registry-endpoint.ts`), and on a runner that calls its
 *    providers directly, the provider lanes (`shared/model-lanes.ts`);
 *  - the per-turn approval-receipt keys the runner hands it
 *    (`shared/fingerprint-secret.ts`);
 *  - telemetry, when the operator configured an exporter, under the
 *    runner's service name with this process's role on the resource
 *    (`otel.ts`), so the engines' spans and the setup timings they record
 *    keep reaching the backend they always reached.
 *
 * `main.ts` has already guarded the pipes and installed the rejection and
 * exception handlers before it hands over, as it does for every mode. The
 * secret capture runs here too: the runner starts the host with an
 * environment that holds none of its secrets, and the capture keeps that
 * true even for a host started some other way.
 *
 * The host exits when its channel closes, after giving every booted
 * adapter its shutdown (bounded, because an exit is the point): the runner
 * closes the channel when it is done with the host, and its death closes
 * it too, so a runner killed outright leaves no host behind.
 */

import { Socket } from "node:net";

import { HARNESS_ADAPTERS } from "../harness-adapters.js";
import { initMetrics, initTracing } from "../otel.js";
import { supplyExecutionFingerprintKeys } from "../shared/fingerprint-secret.js";
import { routeModelCallsThroughLanes } from "../shared/model-lanes.js";
import { routeRegistryThrough } from "../shared/registry-endpoint.js";
import { captureRunnerSecrets } from "../shared/runner-credential-store.js";
import { streamChannel } from "./channel.js";
import { serveAgentHost } from "./host.js";
import { AGENT_HOST_CHANNEL_FD } from "./protocol.js";

/** The bound on the adapters' shutdown once the channel has closed. */
const SHUTDOWN_GRACE_MS = 10_000;

/** The process role this host reports on its telemetry resource. */
const PROCESS_ROLE = "agent-host";

export async function runAgentHost(): Promise<never> {
  captureRunnerSecrets();
  const otelShutdown = await initTracing("stigmer-runner", PROCESS_ROLE);
  const metricsShutdown = await initMetrics("stigmer-runner", PROCESS_ROLE);

  const socket = new Socket({ fd: AGENT_HOST_CHANNEL_FD, readable: true, writable: true });
  const server = serveAgentHost(streamChannel(socket, socket), HARNESS_ADAPTERS, {
    onConfigured: (config) => {
      routeRegistryThrough(config.proxyEndpoint, config.token);
      if (!config.platformProxied) routeModelCallsThroughLanes(config.proxyEndpoint, config.token);
    },
  });
  supplyExecutionFingerprintKeys((executionId) => server.fingerprintKey(executionId));

  const reason = await server.closed;
  console.log(`[agent-host] channel closed (${reason.message}); shutting down`);
  await withinGrace(
    (async () => {
      for (const row of [...server.booted].reverse()) {
        try {
          await row.adapter.shutdown();
        } catch (err) {
          console.warn(`[agent-host] ${row.adapter.name} shutdown failed: ${err instanceof Error ? err.message : err}`);
        }
      }
      await metricsShutdown?.();
      await otelShutdown?.();
    })(),
  );
  process.exit(0);
}

function withinGrace(work: Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, SHUTDOWN_GRACE_MS);
    timer.unref();
    void work.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
