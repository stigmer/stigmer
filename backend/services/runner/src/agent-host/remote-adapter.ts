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
 *  - a harness state bind carries only the id; the runtime records it
 *    through the session's `bindHarnessState` door;
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

import { randomBytes, randomUUID } from "node:crypto";
import { posix } from "node:path";
import { SessionSpecSchema, type SessionSpec } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";

import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Config } from "../config.js";
import type { HarnessName } from "../harness/registry.js";
import type { FailureSurface, HarnessAdapter, TurnInput, TurnOutcome, TurnSink, UsageDelta } from "../harness/types.js";
import { executionFingerprintKey } from "../shared/fingerprint-secret.js";
import type { CasTouchedSnapshot } from "../shared/filereview/cas-touched.js";
import { offloadedOutputs } from "../shared/status-offload.js";
import { activeTraceparent } from "../shared/trace-context.js";
import {
  RuntimeFieldTracker,
  applyAdapterProjection,
  decodeCasSnapshot,
  decodeMessage,
  encodeMessage,
  encodeRunEvents,
  type TurnFields,
  encodeTurnInput, encodeOffloads } from "./codec.js";
import { fromWireError, type WireError, type WireOutcome } from "./protocol.js";
import type { AgentHostSupervisor, RemoteTurnEndpoint } from "./supervisor.js";
import { TurnRowsSchema, type ToolCall, type TurnRows } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

/** What the host may open live turns at: the local proxy's turn registry (`agent-proxy/server.ts`). */
export interface LiveTurnRegistry {
  /** The turn is live at the proxy until the returned close runs. */
  openTurn(turn: { readonly executionId: string; readonly threadId: string; readonly turnKey: string }): () => void;
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
  // The turn's own key at the proxy: one host serves every turn with one
  // token, so this is what keeps a turn's calls to its own execution.
  const turnKey = randomBytes(32).toString("base64url");
  const closeTurn = turns.openTurn({ executionId: input.executionId, threadId: input.threadId, turnKey });
  let stopListener: (() => void) | undefined;
  let yieldListener: (() => void) | undefined;
  try {
    const peer = await host.connection();
    stopListener = () => peer.notify("stopTurn", { turnId, reason: describeReason(sink.stopSignal.reason) });
    sink.stopSignal.addEventListener("abort", stopListener, { once: true });
    yieldListener = () => peer.notify("yieldTurn", { turnId });
    sink.yieldSignal.addEventListener("abort", yieldListener, { once: true });
    const settlement = await peer.call("runTurn", {
      turnId,
      harness,
      input: encodeTurnInput(input),
      status: encodeMessage(RunStatusSchema, sink.status),
      rows: encodeMessage(TurnRowsSchema, sink.rows),
      timing: sink.setupTiming.toWire(),
      fingerprintKey: executionFingerprintKey(input.executionId).toString("base64"),
      stopped: sink.stopSignal.aborted ? describeReason(sink.stopSignal.reason) : null,
      yielded: sink.yieldSignal.aborted,
      turnKey,
      traceparent: await activeTraceparent(),
    });
    applyAdapterProjection(sink, settlement.projection);
    confineHostRows(sink, input.executionId, turn.seededKeys);
    turn.settle(settlement.cas === null ? undefined : confineCasSnapshot(decodeCasSnapshot(settlement.cas)));
    if (settlement.thrown !== null || settlement.outcome === null) {
      throw fromWireError(settlement.thrown ?? { name: "Error", message: "the agent host settled with no outcome" });
    }
    return fromWireOutcome(settlement.outcome);
  } catch (err) {
    if (turn.settled) throw err;
    turn.settle(undefined);
    // A turn the runtime had stopped, or asked to yield, ends as the runtime
    // asked whatever became of the host: its evidence decides the arm.
    if (sink.stopSignal.aborted || sink.yieldSignal.aborted) return { kind: "interrupted" };
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent-host] turn lost with the agent host: execution=${input.executionId}, ${message}`);
    return { kind: "failed", surface: "internal", message: `The agent process stopped before the turn finished: ${message}`, cause: err };
  } finally {
    if (stopListener) sink.stopSignal.removeEventListener("abort", stopListener);
    if (yieldListener) sink.yieldSignal.removeEventListener("abort", yieldListener);
    closeTurn();
    detach();
  }
}

/** One remote turn's runner side: the handlers the host's calls reach. */
class RemoteTurn {
  private readonly runtimeFields: RuntimeFieldTracker;
  /** The storage keys the runtime's rows and status held when the turn began: rows the host may keep naming. */
  readonly seededKeys: ReadonlySet<string>;
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
    this.seededKeys = storageKeysOf(sink);
    const { executionId } = input;
    this.endpoint = {
      calls: {
        persist: async ({ projection }) => {
          applyAdapterProjection(sink, projection);
          confineHostRows(sink, executionId, this.seededKeys);
          await sink.requestPersist();
          return { runtime: this.runtimeFields.changes(sink.status), offloads: encodeOffloads(offloadedOutputs(sink.rows)) };
        },
        reportProgress: async ({ label }) => {
          await sink.reportProgress(label);
          return null;
        },
        bindHarnessState: async ({ harnessStateId }) => {
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
        readRunEvents: async () => encodeRunEvents(await input.readRunEvents()),
      },
      notices: {
        activity: ({ detail }) => sink.recordActivity(detail ?? undefined),
        usage: ({ delta }) => sink.reportUsage(clampUsage(delta)),
        event: ({ event, atWallMs, messageIndex }) =>
          sink.transcript.relayObserved(
            event,
            atWallMs - performance.timeOrigin,
            messageIndex === null ? undefined : { messageIndex },
          ),
        bindCas: () =>
          sink.bindCasObservations(async () => {
            if (this.finalCas) return this.finalCas;
            const peer = await host.connection();
            return confineCasSnapshot(decodeCasSnapshot(await peer.call("readCasObservations", { turnId })));
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
  if (!isTurnArtifactKey(key, executionId)) throw new Error(`artifact key '${key}' is outside this turn's prefix artifacts/${executionId}/`);
}

/** Is `key` under the execution's own artifact prefix, with no empty, `.` or `..` segment? */
export function isTurnArtifactKey(key: string, executionId: string): boolean {
  const prefix = `artifacts/${executionId}/`;
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : undefined;
  const segments = rest?.split("/") ?? [];
  return !(rest === undefined || rest === "" || key.includes("\\") || segments.some((s) => s === "" || s === "." || s === ".."));
}

/** Every storage key the turn names: its artifact rows' and its tool outputs' refs. */
function storageKeysOf(turn: TurnFields): Set<string> {
  const keys = new Set<string>();
  for (const artifact of turn.status.artifacts) if (artifact.storageKey) keys.add(artifact.storageKey);
  for (const tc of allToolCallsOf(turn.rows)) if (tc.outputRef?.storageKey) keys.add(tc.outputRef.storageKey);
  return keys;
}

function allToolCallsOf(rows: TurnRows): ToolCall[] {
  const calls: ToolCall[] = [];
  const lists = [rows.messages, ...rows.subAgentRuns.map((run) => run.messages)];
  for (const messages of lists) for (const message of messages) calls.push(...message.toolCalls);
  return calls;
}

/**
 * Keep the host's rows to keys the turn may name: its own prefix, or a key
 * the runtime's rows or status already held when the turn began. An artifact row
 * outside both is dropped; a tool output's ref outside both is dropped
 * (the runtime's offload makes its own on the next persist), so the
 * console never links another execution's artifact from this turn.
 */
function confineHostRows(turn: TurnFields, executionId: string, seeded: ReadonlySet<string>): void {
  const allowed = (key: string): boolean => key === "" || seeded.has(key) || isTurnArtifactKey(key, executionId);
  const kept = turn.status.artifacts.filter((artifact) => allowed(artifact.storageKey));
  turn.status.artifacts.splice(0, turn.status.artifacts.length, ...kept);
  for (const tc of allToolCallsOf(turn.rows)) {
    if (tc.outputRef !== undefined && !allowed(tc.outputRef.storageKey)) tc.outputRef = undefined;
  }
}

/**
 * Keep a CAS snapshot's paths inside the workspace: the runtime's capture
 * reads each one under the workspace root, so a path that is absolute or
 * leaves the root once normalized is dropped, never read.
 */
export function confineCasSnapshot(snapshot: CasTouchedSnapshot): CasTouchedSnapshot {
  // Separators of either platform, and a drive letter, read as escapes too:
  // the engine's paths are workspace-relative.
  const inside = (raw: string): boolean => {
    const path = raw.replace(/\\/g, "/");
    if (path === "" || path.includes("\0") || posix.isAbsolute(path) || /^[A-Za-z]:/.test(path)) return false;
    const normal = posix.normalize(path);
    return normal !== ".." && !normal.startsWith("../");
  };
  return {
    before: new Map([...snapshot.before].filter(([path]) => inside(path))),
    blockedSecretPaths: new Set([...snapshot.blockedSecretPaths].filter(inside)),
  };
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

const SETTLED_KINDS: ReadonlySet<string> = new Set(["completed", "cancelled", "awaiting_approval", "tool_call_limit", "interrupted"]);
const FAILURE_SURFACES: ReadonlySet<string> = new Set(["engine", "actionable", "internal"]);

/** The host's outcome, taken only in a shape the runtime knows: anything else is an internal failure, never the host's own choice. */
function fromWireOutcome(wire: WireOutcome): TurnOutcome {
  // Read as the host sent it, not as the type promises: the host is the agent's.
  const raw = wire as { readonly kind?: unknown; readonly message?: unknown; readonly surface?: unknown; readonly cause?: WireError };
  if (typeof raw.kind === "string" && SETTLED_KINDS.has(raw.kind)) return { kind: raw.kind as Exclude<TurnOutcome["kind"], "failed"> };
  if (raw.kind !== "failed" || typeof raw.message !== "string" || typeof raw.surface !== "string" || !FAILURE_SURFACES.has(raw.surface)) {
    return { kind: "failed", surface: "internal", message: "The agent process answered with an outcome this runner does not know." };
  }
  return {
    kind: "failed",
    message: raw.message,
    surface: raw.surface as FailureSurface,
    ...(raw.cause !== undefined ? { cause: fromWireError(raw.cause) } : {}),
  };
}

function describeReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" ? reason : "stopped";
}
