/**
 * The agent host's server: the real harness adapters (`harness-adapters.ts`)
 * driven over the pipe by the runner's remote adapters (`remote-adapter.ts`).
 *
 * One host serves every remote harness of one runner process, as one
 * adapter object serves every turn of its harness in-process
 * (`harness/types.ts`): `boot` boots a harness's real adapter, `runTurn`
 * decodes the input (`codec.ts`), runs the adapter against a host sink
 * (`host-sink.ts`) inside the execution's context, and answers with the
 * settlement. The settlement always carries the adapter-owned fields, even
 * when the adapter broke its contract and threw, so the runtime settles
 * over the rows the engine produced, as it does in-process.
 *
 * The adapters boot with a `Config` built from the runner's (`HostConfigWire`):
 * the runner's non-secret settings, every endpoint the adapters dial
 * pointed at the runner's local proxy (the Cursor SDK's at its Cursor
 * lane), and the host's own token in every credential slot. The Temporal and control-plane coordinates are inert:
 * the host dials neither, and an accidental dial reaches the proxy, which
 * serves no such lane.
 *
 * What is process-wide — the model registry's route, the provider lanes,
 * the receipt-key source — is the host process's to install
 * (`entry.ts`, {@link AgentHostServerHooks.onConfigured}); this server
 * touches no module state, so the tests can serve a host inside the
 * runner's own process without rerouting the runner.
 *
 * A message for a turn this host has not started, or has already settled,
 * is answered with an error or dropped: the runner minted the id and owns
 * the turn's lifetime.
 */

import { harnessRowFor, type HarnessRow } from "../harness/registry.js";
import type { Config } from "../config.js";
import type { TurnOutcome } from "../harness/types.js";
import { runWithExecutionContext } from "../shared/execution-context.js";
import type { ArtifactStorage } from "../shared/artifact-storage.js";
import { Peer, type LineChannel } from "./channel.js";
import { decodeTurnInput, encodeAdapterProjection, encodeCasSnapshot } from "./codec.js";
import { HostTurn, type HostPeer } from "./host-sink.js";
import {
  AGENT_HOST_PROTOCOL_VERSION,
  toWireError,
  type HostCalls,
  type HostNotices,
  type RunnerCalls,
  type RunnerNotices,
  type HostConfigWire,
  type WireOutcome,
  type WireSettlement,
} from "./protocol.js";

export interface AgentHostServerHooks {
  /** The runner's configuration arrived with the first boot. */
  readonly onConfigured?: (config: HostConfigWire) => void;
}

/** A host serving one runner. */
export interface AgentHostServer {
  /** Settles with the reason once the channel has closed. */
  readonly closed: Promise<Error>;
  /** The approval-receipt key the runner handed for a running turn of `executionId`. */
  fingerprintKey(executionId: string): Buffer | undefined;
  /** The harnesses booted and not shut down, in boot order. */
  readonly booted: readonly HarnessRow[];
}

/** Serve the runner over `channel` with the adapters in `rows`. */
export function serveAgentHost(channel: LineChannel, rows: readonly HarnessRow[], hooks: AgentHostServerHooks = {}): AgentHostServer {
  const peer: HostPeer = new Peer<RunnerCalls, HostCalls, HostNotices, RunnerNotices>(channel, "agent host");
  const turns = new Map<string, HostTurn>();
  const keys = new Map<string, Buffer>();
  const booted: HarnessRow[] = [];
  let configured: HostConfigWire | undefined;

  const configure = (wire: HostConfigWire): Config => {
    if (configured === undefined) {
      configured = wire;
      hooks.onConfigured?.(wire);
    }
    return hostConfig(configured);
  };

  peer.handle("boot", async ({ harness, config }) => {
    const row = harnessRowFor(rows, harness);
    await row.adapter.boot(configure(config));
    if (!booted.includes(row)) booted.push(row);
    return null;
  });
  peer.handle("shutdown", async ({ harness }) => {
    const row = harnessRowFor(rows, harness);
    const index = booted.indexOf(row);
    if (index !== -1) booted.splice(index, 1);
    await row.adapter.shutdown();
    return null;
  });
  peer.handle("releaseSession", async ({ harness, sessionId }) => {
    await harnessRowFor(rows, harness).adapter.releaseSession(sessionId);
    return null;
  });

  peer.handle("readCasObservations", async ({ turnId }) => {
    const reader = turns.get(turnId)?.cas;
    if (!reader) throw new Error(`agent host: no CAS observations bound for turn ${turnId}`);
    return encodeCasSnapshot(await reader());
  });

  peer.onNotice("stopTurn", ({ turnId, reason }) => turns.get(turnId)?.stop(reason));

  // The SDK the warm-up loads is the host's: the runner loads no engine.
  peer.handle("warmCursorSdk", async () => {
    const { warmCursorSdkStateStores } = await import("../activities/execute-cursor/sdk-warmup.js");
    const result = await warmCursorSdkStateStores();
    return { warmed: result.warmed, durationMs: result.durationMs, error: result.error ?? null };
  });

  peer.handle("runTurn", async (args): Promise<WireSettlement> => {
    const { turnId, harness, input: wireInput } = args;
    const adapter = harnessRowFor(rows, harness).adapter;
    const input = decodeTurnInput(wireInput, {
      selectRecalledMemories: async () => (await peer.call("selectRecalledMemories", { turnId })) ?? undefined,
      artifactStorage: remoteArtifactStorage(peer, turnId),
      verifyPlugin: async (slug) => {
        await peer.call("verifyPlugin", { turnId, slug });
      },
    });
    const turn = new HostTurn(peer, turnId, input, args.status, args.timing);
    turns.set(turnId, turn);
    keys.set(input.executionId, Buffer.from(args.fingerprintKey, "base64"));
    if (args.stopped !== null) turn.stop(args.stopped);

    let outcome: TurnOutcome | undefined;
    let thrown: unknown;
    try {
      outcome = await runWithExecutionContext(input.executionId, () => adapter.runTurn(input, turn.sink));
    } catch (err) {
      thrown = err;
    }
    try {
      // The runtime finalizes its builder the moment `runTurn` returns; the
      // rows are this builder's, so they are finalized before they cross.
      turn.sink.transcript.finalize();
      const reader = turn.cas;
      return {
        outcome: outcome === undefined ? null : toWireOutcome(outcome),
        thrown: outcome === undefined ? toWireError(thrown) : null,
        projection: encodeAdapterProjection(turn.status),
        cas: reader ? encodeCasSnapshot(await reader()) : null,
      };
    } finally {
      turns.delete(turnId);
      keys.delete(input.executionId);
    }
  });

  peer.sendHello(AGENT_HOST_PROTOCOL_VERSION);
  return {
    closed: new Promise((resolve) => peer.onClose(resolve)),
    fingerprintKey: (executionId) => keys.get(executionId),
    booted,
  };
}

/** The `Config` the host's adapters boot with (the module header says what is in it). */
function hostConfig(wire: HostConfigWire): Config {
  const tokenRef = { current: wire.token };
  return {
    taskQueue: "agent-host",
    temporalAddress: "",
    temporalNamespace: "",
    temporalConnection: {},
    stigmerBackendEndpoint: wire.proxyEndpoint,
    stigmerTokenRef: tokenRef,
    stigmerRunnerTokenRef: tokenRef,
    proxyTokenRef: tokenRef,
    mcpBridgeEndpoint: wire.mcpBridgeEndpoint,
    mcpPublicEndpoint: wire.mcpPublicEndpoint,
    cursorApiKey: "",
    workspaceRootDir: wire.workspaceRootDir,
    mode: wire.mode,
    proxyEndpoint: wire.platformProxied ? wire.proxyEndpoint : null,
    cursorEndpoint: wire.cursorEndpoint,
    maxConcurrentActivities: wire.maxConcurrentActivities,
    idleTimeoutSeconds: null,
    cloudModeEnabled: wire.cloudModeEnabled,
    checkpointerType: wire.checkpointerType,
    checkpointerProxyEndpoint: wire.checkpointerType === "http" ? wire.proxyEndpoint : null,
    artifactProxyEndpoint: null,
    primaryModel: wire.primaryModel,
    cursorStreamStallTimeoutMs: wire.cursorStreamStallTimeoutMs,
    agentResolveTimeoutMs: wire.agentResolveTimeoutMs,
    workspaceLockTimeoutMs: wire.workspaceLockTimeoutMs,
  };
}

/**
 * The turn's artifact store as the host sees it: uploads go to the runner,
 * which holds the store's credential and confines the key to the turn's
 * own prefix (`remote-adapter.ts`). The engines only upload; a read is
 * refused here rather than given a path to the runner's whole store.
 */
function remoteArtifactStorage(peer: HostPeer, turnId: string): ArtifactStorage {
  return {
    upload: (key, content, contentType) =>
      peer.call("uploadArtifact", { turnId, key, content: content.toString("base64"), contentType: contentType ?? null }),
    download: (key) => Promise.reject(new Error(`agent host: artifact reads are not served (${key})`)),
    exists: (key) => Promise.reject(new Error(`agent host: artifact reads are not served (${key})`)),
  };
}

function toWireOutcome(outcome: TurnOutcome): WireOutcome {
  if (outcome.kind !== "failed") return { kind: outcome.kind };
  return {
    kind: "failed",
    message: outcome.message,
    surface: outcome.surface,
    ...(outcome.cause !== undefined ? { cause: toWireError(outcome.cause) } : {}),
  };
}
