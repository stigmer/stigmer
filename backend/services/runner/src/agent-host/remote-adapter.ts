/**
 * The remote adapter: a `HarnessAdapter` (`harness/types.ts`) whose engine
 * runs in the agent host. The registry, the turn runtime and both
 * composition roots see the interface they always saw; this module turns
 * each member into a call over the host's pipe (`protocol.ts`), and each of
 * the host's calls back into the runtime's sink.
 *
 * The runtime keeps everything that needs authority — the persist
 * chokepoint, the control-plane writes, the artifact store, the memory
 * selection, the plugin archives — and the host asks for it by turn. Every
 * value the host sends is the agent's, so what the runner acts on is
 * checked here, at the one place it enters:
 *
 *  - a persist replaces only the adapter-owned status fields, never one the
 *    runtime owns (`codec.ts`);
 *  - a session-spec write carries over only the fields an adapter owns
 *    ({@link ADAPTER_OWNED_SESSION_SPEC_FIELDS}); the state id is the
 *    runtime's to write, through `bindHarnessState`;
 *  - an upload is confined to the turn's own key prefix, the one the
 *    engines write under (`execute-deep-agent/inline-publisher.ts`);
 *  - a usage report's counts are clamped to finite, non-negative numbers;
 *  - a plugin verify names one of the turn's own plugins.
 *
 * The turn's lifetime is one pending `runTurn` call. The runtime's stop is
 * forwarded as a notice; the call is answered when the adapter settles,
 * with the adapter-owned fields, which replace the runtime's, and the
 * engine's last CAS snapshot, which the runtime's boundary capture reads
 * after the call returns. When the host dies first, the call rejects and
 * the turn settles here: `interrupted` when the runtime had already asked
 * it to stop, otherwise `failed` on the `internal` surface. Anything the
 * host sends for a turn after that is dropped (`supervisor.ts`).
 */

import { randomUUID } from "node:crypto";
import { SessionSpecSchema, type SessionSpec } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";

import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Config } from "../config.js";
import type { HarnessName } from "../harness/registry.js";
import type { HarnessAdapter, TurnInput, TurnOutcome, TurnSink, UsageDelta } from "../harness/types.js";
import { executionFingerprintKey } from "../shared/fingerprint-secret.js";
import type { CasTouchedSnapshot } from "../shared/filereview/cas-touched.js";
import {
  RuntimeFieldTracker,
  applyAdapterProjection,
  decodeCasSnapshot,
  decodeMessage,
  encodeMessage,
  encodeTurnInput,
} from "./codec.js";
import { fromWireError, type WireOutcome } from "./protocol.js";
import type { AgentHostSupervisor, RemoteTurnEndpoint } from "./supervisor.js";

/**
 * The `SessionSpec` fields a harness writes on the session record before it
 * binds its state id (`TurnSink.bindHarnessState`): the Cursor harness's
 * mode. One writer per field; the runtime writes the state id itself.
 */
export const ADAPTER_OWNED_SESSION_SPEC_FIELDS = ["cursorMode"] as const satisfies readonly (keyof SessionSpec)[];

/** What the host may open live turns at: the local proxy's turn registry (`agent-proxy/server.ts`). */
export interface LiveTurnRegistry {
  /** The turn is live at the proxy until the returned close runs. */
  openTurn(turn: { readonly executionId: string; readonly sessionId: string }): () => void;
}

/**
 * The remote stand-in for `local`, the real adapter, which the host runs.
 * `local` lends only its name and its capabilities: the runtime branches on
 * them before and after the turn, and they are the adapter's own facts.
 */
export function createRemoteAdapter(
  harness: HarnessName,
  local: HarnessAdapter,
  host: AgentHostSupervisor,
  turns: LiveTurnRegistry,
): HarnessAdapter {
  return {
    name: local.name,
    capabilities: local.capabilities,
    boot: (config: Config) => host.boot(harness, config),
    shutdown: () => host.shutdown(harness),
    releaseSession: (sessionId: string) => host.releaseSession(harness, sessionId),
    runTurn: (input: TurnInput, sink: TurnSink) => runRemoteTurn(harness, host, turns, input, sink),
  };
}

async function runRemoteTurn(
  harness: HarnessName,
  host: AgentHostSupervisor,
  turns: LiveTurnRegistry,
  input: TurnInput,
  sink: TurnSink,
): Promise<TurnOutcome> {
  const turnId = randomUUID();
  const turn = new RemoteTurn(turnId, input, sink, host);
  const detach = host.attachTurn(turnId, turn.endpoint);
  const closeTurn = turns.openTurn({ executionId: input.executionId, sessionId: input.sessionId });
  let stopListener: (() => void) | undefined;
  try {
    const peer = await host.connection();
    stopListener = () => peer.notify("stopTurn", { turnId, reason: describeReason(sink.stopSignal.reason) });
    sink.stopSignal.addEventListener("abort", stopListener, { once: true });
    const settlement = await peer.call("runTurn", {
      turnId,
      harness,
      input: encodeTurnInput(input),
      status: encodeMessage(RunStatusSchema, sink.status),
      timing: sink.setupTiming.toWire(),
      fingerprintKey: executionFingerprintKey(input.executionId).toString("base64"),
      stopped: sink.stopSignal.aborted ? describeReason(sink.stopSignal.reason) : null,
    });
    applyAdapterProjection(sink.status, settlement.projection);
    turn.settle(settlement.cas === null ? undefined : decodeCasSnapshot(settlement.cas));
    if (settlement.thrown !== null || settlement.outcome === null) {
      throw fromWireError(settlement.thrown ?? { name: "Error", message: "the agent host settled with no outcome" });
    }
    return fromWireOutcome(settlement.outcome);
  } catch (err) {
    if (turn.settled) throw err;
    turn.settle(undefined);
    if (sink.stopSignal.aborted) return { kind: "interrupted" };
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent-host] turn lost with the agent host: execution=${input.executionId}, ${message}`);
    return { kind: "failed", surface: "internal", message: `The agent process stopped before the turn finished: ${message}`, cause: err };
  } finally {
    if (stopListener) sink.stopSignal.removeEventListener("abort", stopListener);
    closeTurn();
    detach();
  }
}

/** One remote turn's runner side: the handlers the host's calls reach. */
class RemoteTurn {
  private readonly runtimeFields: RuntimeFieldTracker;
  private finalCas: CasTouchedSnapshot | undefined;
  private done = false;
  readonly endpoint: RemoteTurnEndpoint;

  constructor(
    turnId: string,
    private readonly input: TurnInput,
    private readonly sink: TurnSink,
    host: AgentHostSupervisor,
  ) {
    this.runtimeFields = new RuntimeFieldTracker(sink.status);
    const { executionId } = input;
    this.endpoint = {
      calls: {
        persist: async ({ projection }) => {
          applyAdapterProjection(sink.status, projection);
          await sink.requestPersist();
          return { runtime: this.runtimeFields.changes(sink.status) };
        },
        reportProgress: async ({ label }) => {
          await sink.reportProgress(label);
          return null;
        },
        bindHarnessState: async ({ harnessStateId, sessionSpec }) => {
          const proposed = decodeMessage(SessionSpecSchema, sessionSpec);
          const spec = input.session.spec!;
          for (const field of ADAPTER_OWNED_SESSION_SPEC_FIELDS) spec[field] = proposed[field];
          await sink.bindHarnessState(harnessStateId);
          return null;
        },
        selectRecalledMemories: async () => (await input.standing.selectRecalledMemories()) ?? null,
        uploadArtifact: async ({ key, content, contentType }) => {
          const storage = input.artifactStorage;
          if (!storage) throw new Error("this turn has no artifact storage");
          assertTurnArtifactKey(key, executionId);
          return storage.upload(key, Buffer.from(content, "base64"), contentType ?? undefined);
        },
        verifyPlugin: async ({ slug }) => {
          const plugin = input.hooks.sources.find((s) => s.plugin?.slug === slug)?.plugin;
          if (!plugin) throw new Error(`plugin '${slug}' is not one of this turn's`);
          await plugin.verify();
          return null;
        },
      },
      notices: {
        activity: ({ detail }) => sink.recordActivity(detail ?? undefined),
        usage: ({ delta }) => sink.reportUsage(clampUsage(delta)),
        event: ({ event, atWallMs }) => sink.transcript.relayObserved(event, atWallMs - performance.timeOrigin),
        bindCas: () =>
          sink.bindCasObservations(async () => {
            if (this.finalCas) return this.finalCas;
            const peer = await host.connection();
            return decodeCasSnapshot(await peer.call("readCasObservations", { turnId }));
          }),
      },
    };
  }

  get settled(): boolean {
    return this.done;
  }

  /** The turn is over; the runtime's later CAS reads see the snapshot the host settled with. */
  settle(cas: CasTouchedSnapshot | undefined): void {
    this.done = true;
    this.finalCas = cas ?? { before: new Map(), blockedSecretPaths: new Set() };
  }
}

/**
 * Refuse an upload outside the turn's own prefix: the engines write
 * `artifacts/<executionId>/<file>` (`execute-deep-agent/inline-publisher.ts`),
 * and the runner's store holds every other turn's objects beside it.
 */
export function assertTurnArtifactKey(key: string, executionId: string): void {
  const prefix = `artifacts/${executionId}/`;
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : undefined;
  const segments = rest?.split("/") ?? [];
  if (rest === undefined || rest === "" || key.includes("\\") || segments.some((s) => s === "" || s === "." || s === "..")) {
    throw new Error(`artifact key '${key}' is outside this turn's prefix ${prefix}`);
  }
}

function clampUsage(delta: UsageDelta): UsageDelta {
  const count = (n: number | undefined): number | undefined =>
    n === undefined ? undefined : Number.isFinite(n) && n > 0 ? n : 0;
  return {
    inputTokens: count(delta.inputTokens),
    outputTokens: count(delta.outputTokens),
    cacheReadTokens: count(delta.cacheReadTokens),
    cacheWriteTokens: count(delta.cacheWriteTokens),
    estimatedCostUsd: count(delta.estimatedCostUsd),
    ...(typeof delta.model === "string" ? { model: delta.model } : {}),
    ...(typeof delta.requestedModelParams === "string" ? { requestedModelParams: delta.requestedModelParams } : {}),
  };
}

function fromWireOutcome(wire: WireOutcome): TurnOutcome {
  if (wire.kind !== "failed") return { kind: wire.kind };
  return {
    kind: "failed",
    message: wire.message,
    surface: wire.surface,
    ...(wire.cause !== undefined ? { cause: fromWireError(wire.cause) } : {}),
  };
}

function describeReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" ? reason : "stopped";
}
