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
 *  - telemetry, when the runner's settings say so (`otel-export.ts`), under
 *    the runner's service name with this process's role on the resource
 *    (`otel.ts`), exported to the runner's local proxy, which forwards it
 *    to the operator's collector with a login this process never holds
 *    (`agent-proxy/otlp-forward.ts`). The host reads no telemetry setting
 *    of its own: until the runner's configuration arrives it exports
 *    nothing, and then exactly what the runner decided.
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
 *
 * Shape: {@link runAgentHostProcess} is the whole of it over injected
 * process facts, which the tests drive in-process; {@link runAgentHost} is
 * only the process boundary, booted under plain Node by
 * `scripts/verify-agent-host-boot.mjs`.
 */

import { Socket } from "node:net";

import { HARNESS_ADAPTERS } from "../harness-adapters.js";
import type { HarnessRow } from "../harness/registry.js";
import { initMetrics, initTracing } from "../otel.js";
import { TELEMETRY_OFF, adoptTelemetrySettings, type TelemetryLane } from "../otel-export.js";
import { supplyExecutionFingerprintKeys } from "../shared/fingerprint-secret.js";
import { routeModelCallsThroughLanes } from "../shared/model-lanes.js";
import { routeRegistryThrough } from "../shared/registry-endpoint.js";
import { captureRunnerSecrets } from "../shared/runner-credential-store.js";
import { streamChannel, type LineChannel } from "./channel.js";
import { serveAgentHost } from "./host.js";
import { AGENT_HOST_CHANNEL_FD } from "./protocol.js";

/** The bound on the adapters' shutdown once the channel has closed. */
export const SHUTDOWN_GRACE_MS = 10_000;

/** The process role this host reports on its telemetry resource. */
const PROCESS_ROLE = "agent-host";

/** What the host process needs of its process: the channel, the adapters, telemetry, the way out. */
export interface AgentHostProcess {
  readonly channel: LineChannel;
  readonly rows: readonly HarnessRow[];
  /** Start telemetry through the runner's local proxy, on the settings already adopted; resolves to its flush, `null` when nothing is exported. */
  readonly initTelemetry: (lane: TelemetryLane) => Promise<(() => Promise<void>) | null>;
  readonly exit: (code: number) => void;
  readonly log: (message: string) => void;
  readonly shutdownGraceMs?: number;
}

/** Serve the runner until the channel closes, then shut the adapters down and exit. */
export async function runAgentHostProcess(host: AgentHostProcess): Promise<void> {
  captureRunnerSecrets();
  adoptTelemetrySettings(TELEMETRY_OFF);
  const telemetry: { flush: (() => Promise<void>) | null } = { flush: null };
  const server = serveAgentHost(host.channel, host.rows, {
    onConfigured: async (config) => {
      // The Cursor SDK's whole backend is the Cursor lane. The SDK reads this
      // on import and again per call, so it stays set; the shells and hooks
      // the runner's code starts leave it out (`shared/shell-env.ts`), and
      // only commands the SDK starts itself inherit it.
      if (config.cursorEndpoint !== null) process.env.CURSOR_BACKEND_URL = config.cursorEndpoint;
      routeRegistryThrough(config.proxyEndpoint, config.token);
      if (!config.platformProxied) routeModelCallsThroughLanes(config.proxyEndpoint, config.token);
      adoptTelemetrySettings(config.telemetry);
      try {
        telemetry.flush = await host.initTelemetry({ endpoint: config.proxyEndpoint, token: config.token });
      } catch (err) {
        // Telemetry is never a reason to refuse a turn.
        host.log(`[agent-host] telemetry not started: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
  supplyExecutionFingerprintKeys((executionId) => server.fingerprintKey(executionId));

  const reason = await server.closed;
  host.log(`[agent-host] channel closed (${reason.message}); shutting down`);
  await withinGrace(
    (async () => {
      for (const row of [...server.booted].reverse()) {
        try {
          await row.adapter.shutdown();
        } catch (err) {
          host.log(`[agent-host] ${row.adapter.name} shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      await telemetry.flush?.();
    })(),
    host.shutdownGraceMs ?? SHUTDOWN_GRACE_MS,
  );
  host.exit(0);
}

/** The process boundary: fd 3, the real adapter table, the real telemetry and `process.exit`. */
export async function runAgentHost(): Promise<void> {
  /* v8 ignore start -- @preserve: the process boundary; its logic is runAgentHostProcess (tested in-process) and scripts/verify-agent-host-boot.mjs boots this under plain Node */
  // The host shares the runner's process group, so a daemon's stop or a
  // terminal's Ctrl-C reaches it too. It ignores both and exits when its pipe
  // closes: the runner drains its turns first and shuts the harnesses down,
  // and a runner that dies outright closes the pipe with it.
  process.on("SIGTERM", () => {});
  process.on("SIGINT", () => {});
  // Set only so Electron would run this entry as Node (`supervisor.ts`
  // `agentHostCommand`); the processes an agent starts here never see it.
  if (process.versions.electron !== undefined) delete process.env.ELECTRON_RUN_AS_NODE;
  const socket = new Socket({ fd: AGENT_HOST_CHANNEL_FD, readable: true, writable: true });
  await runAgentHostProcess({
    channel: streamChannel(socket, socket),
    rows: HARNESS_ADAPTERS,
    initTelemetry: async (lane) => {
      const tracing = await initTracing("stigmer-runner", { processRole: PROCESS_ROLE, lane });
      const metrics = await initMetrics("stigmer-runner", { processRole: PROCESS_ROLE, lane });
      if (!tracing && !metrics) return null;
      return async () => {
        await metrics?.();
        await tracing?.();
      };
    },
    exit: (code) => process.exit(code),
    log: (message) => console.log(message),
  });
  /* v8 ignore stop */
}

function withinGrace(work: Promise<void>, graceMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, graceMs);
    timer.unref();
    void work.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
