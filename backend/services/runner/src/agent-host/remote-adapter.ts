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
 *  - a persist replaces only the adapter-owned rows, never a status field,
 *    every one of which the runtime owns (`codec.ts`); a tool output's
 *    stored reference is kept only under the turn's own key prefix or as
 *    the runtime seeded it;
 *  - a usage report's counts are clamped to finite, non-negative numbers;
 *  - a plugin verify names one of the turn's own plugins;
 *  - a relayed checkpoint op names only the turn's own thread, and is
 *    stored for the turn's own session, which the runner names, never the
 *    host (`shared/checkpointer/relayed-rows.ts`).
 *
 * Which host runs the turn is chosen here, per turn: a turn without a
 * computer runs in a locked host where the harness has them, one lent to it
 * alone for the turn (`host-pool.ts`, `fence.ts`), every other turn in the
 * open host. A turn the locked host can never serve on this runner (no lock
 * to be had) settles `failed` on the actionable surface before it starts,
 * with the reason: the runner refuses rather than run it unlocked. A runner
 * that serves only conversations without a computer refuses a turn with one
 * here too, after the runtime's own refusal (`runner-serves.ts`), so no route
 * reaches the open host with a turn. A turn whose locked host died of its
 * heap cap settles `failed` on the actionable surface with the person's
 * sentence naming the cap. Its saved state is stored by the open host, on
 * the session's file, and the file is closed once the turn settles.
 *
 * The turn is opened at the local proxy under its key, in the slot of the
 * host it runs on, with the run credential the activity entered: the host's
 * model, checkpoint and engine-session calls go out under that turn's own
 * credential, and only from that host (`agent-proxy/server.ts`).
 *
 * The turn's lifetime is one pending `runTurn` call. The runtime's stop is
 * forwarded as a notice; the call is answered when the adapter settles,
 * with the adapter-owned fields, which replace the runtime's, and the
 * engine's last CAS snapshot, which the runtime's boundary capture reads
 * after the call returns. When the host dies first, the call rejects and
 * the turn settles here: `interrupted` when the runtime had already asked
 * it to stop, otherwise `failed` on the `internal` surface. Anything the
 * host sends for a turn after that is dropped (`supervisor.ts`).
 *
 * Each call and notice the host sends is handled in the async context the
 * turn was entered in, as the runtime's own calls are when the adapter runs
 * in this process: what it asks of the control plane goes out as the run's
 * (the run credential the activity entered, `shared/run-credential-store.ts`),
 * never as the process.
 */

import { ArchiveFileNotFoundError, NO_TURN_ARCHIVES } from "../shared/archive-reader.js";
import { InputFileNotFoundError } from "../shared/inputs-reader.js";
import type { TurnOffloads } from "../shared/offload-store.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { posix } from "node:path";
import { SessionSpecSchema, type SessionSpec } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";

import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Config } from "../config.js";
import type { HarnessName } from "../harness/registry.js";
import type { FailureSurface, HarnessAdapter, TurnInput, TurnOutcome, TurnSink, TurnStoreFiles, UsageDelta } from "../harness/types.js";
import { isStopKind, type StopDetail } from "../shared/stop-kind.js";
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
  type TurnFields,
  encodeTurnInput, encodeOffloads } from "./codec.js";
import { fromWireError, type WireError, type WireOutcome } from "./protocol.js";
import { FenceRefusedError } from "./fence.js";
import { threadsOfCheckpointOp, type CheckpointRowsOp } from "../shared/checkpointer/relayed-rows.js";
import { currentRunCredential } from "../shared/run-credential-store.js";
import { DEFAULT_TURN_MEMORY_MB, outOfMemorySentence, refusalForServes } from "../runner-serves.js";
import { HostHeapExhaustedError, type AgentHostSupervisor, type HostLease, type RemoteTurnEndpoint, type TurnHosts } from "./supervisor.js";
import { TurnRowsSchema, type ToolCall, type TurnRows } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

/** A turn as the remote adapter opens it at the local proxy. */
export interface LiveTurnOpening {
  readonly executionId: string;
  readonly threadId: string;
  readonly turnKey: string;
  /** The slot of the host the turn runs on; the open host's when absent. */
  readonly slot?: string;
  /** The run credential the turn's activity entered; absent when its dispatch carried none. */
  readonly credential?: string;
}

/** What the host may open live turns at: the local proxy's turn registry (`agent-proxy/server.ts`). */
export interface LiveTurnRegistry {
  /** The turn is live at the proxy until the returned close runs. */
  openTurn(turn: LiveTurnOpening): () => void;
}

/** The hosts a harness's turns run in: the open one always, the locked ones for turns without a computer where the harness has them. */
export interface AgentHosts {
  readonly open: AgentHostSupervisor;
  readonly fenced?: TurnHosts;
  /** The runner serves only conversations without a computer (`runner-serves.ts`). */
  readonly computerless?: boolean;
}

/**
 * The remote stand-in for `local`, the real adapter, which the hosts run.
 * `local` lends only its name and its capabilities: the runtime branches on
 * them before and after the turn, and they are the adapter's own facts.
 */
export function createRemoteAdapter(
  harness: HarnessName,
  local: HarnessAdapter,
  hosts: AgentHosts,
  turns: LiveTurnRegistry,
): HarnessAdapter {
  const all = hosts.fenced === undefined ? [hosts.open] : [hosts.open, hosts.fenced];
  return {
    name: local.name,
    capabilities: local.capabilities,
    boot: async (config: Config) => {
      for (const host of all) await host.boot(harness, config);
    },
    shutdown: async () => {
      for (const host of [...all].reverse()) await host.shutdown(harness);
    },
    releaseSession: async (sessionId: string) => {
      for (const host of all) await host.releaseSession(harness, sessionId);
    },
    runTurn: (input: TurnInput, sink: TurnSink) => runRemoteTurn(harness, hosts, turns, input, sink),
  };
}

async function runRemoteTurn(
  harness: HarnessName,
  hosts: AgentHosts,
  turns: LiveTurnRegistry,
  input: TurnInput,
  sink: TurnSink,
): Promise<TurnOutcome> {
  const refusal = hosts.computerless ? refusalForServes("computerless", input.workspace.computer) : undefined;
  if (refusal !== undefined) return { kind: "failed", surface: "actionable", message: refusal };
  const side = !input.workspace.computer && hosts.fenced !== undefined ? hosts.fenced : hosts.open;
  let lease: HostLease;
  try {
    lease = await side.acquire();
  } catch (err) {
    if (err instanceof FenceRefusedError) return lockRefused(err);
    throw err;
  }
  const host = lease.host;
  const turnId = randomUUID();
  const turn = new RemoteTurn(turnId, input, sink, host, hosts.open);
  const detach = host.attachTurn(turnId, turn.endpoint);
  // The turn's own key at the proxy: the open host serves every turn with
  // one token, so this is what keeps a turn's calls to its own execution;
  // its credential is what they reach the platform with.
  const turnKey = randomBytes(32).toString("base64url");
  const credential = currentRunCredential();
  const closeTurn = turns.openTurn({
    executionId: input.executionId,
    threadId: input.threadId,
    turnKey,
    slot: host.slot,
    ...(credential === undefined ? {} : { credential }),
  });
  let stopListener: (() => void) | undefined;
  let yieldListener: (() => void) | undefined;
  let inputListener: (() => void) | undefined;
  let backgroundStopListener: (() => void) | undefined;
  try {
    const peer = await host.connection();
    stopListener = () => peer.notify("stopTurn", { turnId, reason: describeReason(sink.stopSignal.reason) });
    sink.stopSignal.addEventListener("abort", stopListener, { once: true });
    yieldListener = () => peer.notify("yieldTurn", { turnId });
    sink.yieldSignal.addEventListener("abort", yieldListener, { once: true });
    inputListener = sink.input.onPending(() => peer.notify("inputPending", { turnId }));
    backgroundStopListener = sink.backgroundStops.onStop((callId) => peer.notify("stopBackgroundCommand", { turnId, callId }));
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
      inputPending: sink.input.pending(),
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
    if (err instanceof FenceRefusedError) return lockRefused(err);
    // A turn the runtime had stopped, or asked to yield, ends as the runtime
    // asked whatever became of the host: its evidence decides the arm.
    if (sink.stopSignal.aborted || sink.yieldSignal.aborted) return { kind: "interrupted" };
    if (err instanceof HostHeapExhaustedError) {
      console.error(`[agent-host] turn ran out of the agent host's memory: execution=${input.executionId}, ${err.message}`);
      return { kind: "failed", surface: "actionable", message: outOfMemorySentence(host.heapMb ?? DEFAULT_TURN_MEMORY_MB), cause: err };
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent-host] turn lost with the agent host: execution=${input.executionId}, ${message}`);
    return { kind: "failed", surface: "internal", message: `The agent process stopped before the turn finished: ${message}`, cause: err };
  } finally {
    if (stopListener) sink.stopSignal.removeEventListener("abort", stopListener);
    if (yieldListener) sink.yieldSignal.removeEventListener("abort", yieldListener);
    inputListener?.();
    backgroundStopListener?.();
    closeTurn();
    detach();
    lease.release();
    if (turn.checkpointRowsUsed) await closeCheckpointRows(hosts.open, input.sessionId);
  }
}

/** A turn without a computer that no locked host can run on this runner: refused, never run unlocked. */
function lockRefused(err: FenceRefusedError): TurnOutcome {
  return {
    kind: "failed",
    surface: "actionable",
    message: `This runner can't lock the agent program for a conversation without a computer (${err.message}), and it won't run one unlocked.`,
    cause: err,
  };
}

/** The relayed turn has settled: the open host closes the session's checkpoint file. A host that is gone holds none open. */
async function closeCheckpointRows(open: AgentHostSupervisor, sessionId: string): Promise<void> {
  try {
    await (await open.connection()).call("closeCheckpointRows", { sessionId });
  } catch (err) {
    console.warn(`[agent-host] the session's checkpoint file was not closed: session=${sessionId}, ${err instanceof Error ? err.message : String(err)}`);
  }
}

const CHECKPOINT_OPS: ReadonlySet<string> = new Set(["get", "list", "put", "putWrites", "deleteThread"]);

/**
 * Hold a relayed checkpoint op to the turn's own thread, read as the host
 * sent it: an op of a kind this runner does not know, or one naming any
 * other thread, is refused, never stored.
 */
export function confineCheckpointOp(op: CheckpointRowsOp, threadId: string): CheckpointRowsOp {
  const raw = op as { readonly op?: unknown };
  if (typeof raw.op !== "string" || !CHECKPOINT_OPS.has(raw.op)) throw new Error("the agent program sent a checkpoint call this runner does not know");
  for (const thread of threadsOfCheckpointOp(op)) {
    if (thread !== threadId) throw new Error(`thread ${String(thread)} is not the turn's own`);
  }
  return op;
}

/**
 * The endpoint with every handler run in the async context it was built in,
 * the turn's (the module header): the snapshot is taken here, inside the
 * activity, and each handler enters it.
 */
function withinTurn(endpoint: RemoteTurnEndpoint): RemoteTurnEndpoint {
  const inTurn = AsyncLocalStorage.snapshot();
  const wrapped = <T extends object>(handlers: T): T =>
    Object.fromEntries(
      Object.entries(handlers).map(([method, handler]) => [
        method,
        (args: unknown) => inTurn(() => (handler as (args: unknown) => unknown)(args)),
      ]),
    ) as T;
  return { calls: wrapped(endpoint.calls), notices: wrapped(endpoint.notices) };
}

/**
 * The files of a turn without a computer, which the runner holds and
 * answers for: a host that asks for them on a turn with a computer is
 * refused, never served from a disk.
 */
function storeFilesOf(input: TurnInput): TurnStoreFiles {
  if (input.workspace.computer) throw new Error("this turn has a computer; its files are on its workspace, not the store");
  return input.workspace.files;
}

/** The turn's set-aside store, or a refusal where the runner has none. */
function offloadsOf(input: TurnInput): TurnOffloads {
  const offloads = storeFilesOf(input).offloads;
  if (offloads === undefined) throw new Error("this runner has no artifact storage to set results aside in");
  return offloads;
}

/** One remote turn's runner side: the handlers the host's calls reach. */
class RemoteTurn {
  private readonly runtimeFields: RuntimeFieldTracker;
  /** The storage keys the runtime's rows held when the turn began: rows the host may keep naming. */
  readonly seededKeys: ReadonlySet<string>;
  private finalCas: CasTouchedSnapshot | undefined;
  private done = false;
  /** Whether the turn stored saved state through the open host, whose file then closes at the turn's end. */
  checkpointRowsUsed = false;
  readonly endpoint: RemoteTurnEndpoint;

  constructor(
    turnId: string,
    private readonly input: TurnInput,
    private readonly sink: TurnSink,
    host: AgentHostSupervisor,
    store: AgentHostSupervisor,
  ) {
    this.runtimeFields = new RuntimeFieldTracker(sink.status);
    this.seededKeys = storageKeysOf(sink);
    const { executionId } = input;
    this.endpoint = withinTurn({
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
        selectRecalledMemories: async () => (await input.standing.selectRecalledMemories()) ?? null,
        verifyPlugin: async ({ slug }) => {
          const plugin = input.hooks.sources.find((s) => s.plugin?.slug === slug)?.plugin;
          if (!plugin) throw new Error(`plugin '${slug}' is not one of this turn's`);
          await plugin.verify();
          return null;
        },
        listTurnArchives: async () => (input.skills.archives ?? NO_TURN_ARCHIVES).list(),
        readTurnArchiveFile: async ({ path }) => {
          try {
            return { content: Buffer.from(await (input.skills.archives ?? NO_TURN_ARCHIVES).read(path)).toString("base64") };
          } catch (err) {
            if (err instanceof ArchiveFileNotFoundError) return { missing: true };
            throw err;
          }
        },
        listTurnInputs: async () => storeFilesOf(input).inputs.list(),
        readTurnInput: async ({ path }) => {
          try {
            return { content: Buffer.from(await storeFilesOf(input).inputs.read(path)).toString("base64") };
          } catch (err) {
            if (err instanceof InputFileNotFoundError) return { missing: true };
            throw err;
          }
        },
        listTurnOutputs: async () => storeFilesOf(input).outputs.list(),
        readTurnOutput: async ({ path }) => {
          const bytes = await storeFilesOf(input).outputs.read(path);
          return bytes === undefined ? { missing: true } : { content: Buffer.from(bytes).toString("base64") };
        },
        writeTurnOutput: async ({ path, content }) => {
          await storeFilesOf(input).outputs.write(path, new Uint8Array(Buffer.from(content, "base64")));
          return null;
        },
        deleteTurnOutput: async ({ path }) => storeFilesOf(input).outputs.delete(path),
        putTurnOffload: async ({ content }) => offloadsOf(input).put(new Uint8Array(Buffer.from(content, "base64"))),
        readTurnOffload: async ({ key }) => Buffer.from(await offloadsOf(input).read(key)).toString("base64"),
        checkpointRows: async ({ op }) => {
          storeFilesOf(input);
          const confined = confineCheckpointOp(op, input.threadId);
          this.checkpointRowsUsed = true;
          return (await store.connection()).call("checkpointRows", { sessionId: input.sessionId, op: confined });
        },
        claimInput: async ({ force }) => {
          const messages = await sink.input.claim({ force });
          return { messages, pending: sink.input.pending() };
        },
        claimedInput: ({ delivered }) => sink.input.claimed(new Set(delivered)),
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
    });
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
 * Is `key` under the execution's own prefix, `artifacts/<executionId>/`,
 * with no empty, `.` or `..` segment? The runtime offloads a turn's tool
 * outputs there, and the runner's store holds every other turn's objects
 * beside it.
 */
export function isTurnArtifactKey(key: string, executionId: string): boolean {
  const prefix = `artifacts/${executionId}/`;
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : undefined;
  const segments = rest?.split("/") ?? [];
  return !(rest === undefined || rest === "" || key.includes("\\") || segments.some((s) => s === "" || s === "." || s === ".."));
}

/** Every storage key the turn names: its tool outputs' refs. */
function storageKeysOf(turn: TurnFields): Set<string> {
  const keys = new Set<string>();
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
 * the runtime's rows already held when the turn began. A tool output's ref
 * outside both is dropped (the runtime's offload makes its own on the next
 * persist), so the console never links another execution's object from
 * this turn.
 */
function confineHostRows(turn: TurnFields, executionId: string, seeded: ReadonlySet<string>): void {
  const allowed = (key: string): boolean => key === "" || seeded.has(key) || isTurnArtifactKey(key, executionId);
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

const SETTLED_KINDS: ReadonlySet<string> = new Set(["completed", "awaiting_approval", "tool_call_limit", "interrupted"]);
const FAILURE_SURFACES: ReadonlySet<string> = new Set(["engine", "actionable", "internal"]);

/** The host's outcome, taken only in a shape the runtime knows: anything else is an internal failure, never the host's own choice. */
function fromWireOutcome(wire: WireOutcome): TurnOutcome {
  // Read as the host sent it, not as the type promises: the host is the agent's.
  const raw = wire as { readonly kind?: unknown; readonly message?: unknown; readonly surface?: unknown; readonly cause?: WireError; readonly stopDetail?: unknown };
  if (typeof raw.kind === "string" && SETTLED_KINDS.has(raw.kind)) return { kind: raw.kind as Exclude<TurnOutcome["kind"], "failed"> };
  if (raw.kind !== "failed" || typeof raw.message !== "string" || typeof raw.surface !== "string" || !FAILURE_SURFACES.has(raw.surface)) {
    return { kind: "failed", surface: "internal", message: "The agent process answered with an outcome this runner does not know." };
  }
  return {
    kind: "failed",
    message: raw.message,
    surface: raw.surface as FailureSurface,
    ...(raw.cause !== undefined ? { cause: fromWireError(raw.cause) } : {}),
    ...stopDetailOf(raw.stopDetail),
  };
}

/** The host's stop detail, taken only with a kind this runner knows and string names; dropped otherwise (the surface's own kind then applies). */
function stopDetailOf(raw: unknown): { readonly stopDetail?: StopDetail } {
  if (raw === null || typeof raw !== "object") return {};
  const { kind, model, app } = raw as { readonly kind?: unknown; readonly model?: unknown; readonly app?: unknown };
  if (typeof kind !== "string" || !isStopKind(kind)) return {};
  return {
    stopDetail: {
      kind,
      ...(typeof model === "string" && model !== "" ? { model } : {}),
      ...(typeof app === "string" && app !== "" ? { app } : {}),
    },
  };
}

function describeReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" ? reason : "stopped";
}
