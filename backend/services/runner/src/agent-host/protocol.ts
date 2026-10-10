/**
 * The agent host protocol — what the runner and its agent host say to each
 * other over the host's private pipe.
 *
 * The runner keeps every credential and the whole turn runtime; the agent
 * host runs the harness adapters (`harness/types.ts`), and with them every
 * process the agent's turn starts (#2016). They meet at the adapter
 * contract: the runner's remote adapter (`remote-adapter.ts`) forwards
 * `boot`, `shutdown`, `releaseSession` and `runTurn` here, and the host's
 * sink (`host-sink.ts`) forwards what an adapter asks of the runtime back.
 * Data crosses; authority never does. Every value the host sends is the
 * agent's, so the runner validates each one it acts on (`remote-adapter.ts`
 * says how). Two are not yet confined, and must be before the host runs as
 * a user of its own (#2079): the paths of the settlement's CAS snapshot,
 * which the runtime's capture reads under the workspace, and the storage
 * keys an artifact row of a persisted projection names.
 *
 * Shape: three envelopes over newline-delimited JSON (the manager IPC's
 * framing, `ipc-protocol.ts`), on file descriptor 3 so neither process's
 * stdout or stderr carries protocol bytes.
 *
 *  - `call`: a request that expects exactly one `result` with the same id.
 *    Both sides make calls: the runner calls the host's {@link HostCalls},
 *    the host calls the runner's {@link RunnerCalls}.
 *  - `result`: the answer to one call, a value or a {@link WireError}.
 *  - `notify`: a one-way fact ({@link HostNotices}, {@link RunnerNotices}),
 *    for the high-rate signals that need no answer (activity, usage, the
 *    transcript events the runtime's timeline observes) and for the stop.
 *
 * `runTurn` is a call whose result is the turn's settlement: the host
 * answers it when the adapter settles, so one pending call is the whole
 * lifetime of a remote turn, and a host that dies rejects it with every
 * other pending call. Every turn-scoped message carries the `turnId` the
 * runner minted for that call; a message for a turn the receiver has
 * already settled is dropped (`remote-adapter.ts`, `host.ts`).
 *
 * Bytes (protobuf messages, file contents) cross as base64 strings. One
 * message is capped at {@link MAX_MESSAGE_BYTES}; a larger one is refused
 * by its sender as a failed call, never sent half.
 *
 * The protocol is private to two TypeScript processes built from one
 * bundle, so nothing mirrors it and its version only guards a mismatched
 * pair (a host from another build): the host announces it in `hello`, and
 * the runner refuses any other. Bump it on any incompatible change.
 */

import type { HarnessName } from "../harness/registry.js";
import type { UsageDelta } from "../harness/types.js";
import type { TranscriptEvent } from "../harness/transcript/events.js";
import type { RecalledMemoriesContent } from "../shared/recalled-memories.js";
import type { TimingRecorderWire } from "../shared/cold-start-timing.js";
import type { RuntimeFieldsWire, WireOffload, WireTurnInput } from "./codec.js";

export const AGENT_HOST_PROTOCOL_VERSION = 2;

/**
 * The largest single message either side sends or accepts. A turn's input
 * carries its attachments' images (at most 4 MiB raw, `attachment-vision.ts`)
 * and the whole persisted transcript; 64 MiB is far above both and still a
 * bound on what a misbehaving peer can make the other buffer.
 */
export const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

/** The argument that starts the runner's entry as the agent host (`main.ts`). */
export const AGENT_HOST_MODE_ARG = "agent-host";

/** The file descriptor the host's channel uses in the host process. */
export const AGENT_HOST_CHANNEL_FD = 3;

// ─── What crosses ───────────────────────────────────────────────────────────

/** An error as it crosses: its name, message and stack, rebuilt as an `Error` on the far side. */
export interface WireError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

/**
 * The settings the host's adapters run with: the runner's own non-secret
 * configuration, with every transport pointed at the runner's local proxy
 * (`agent-proxy/`). Never a credential of the runner's: `token` is the
 * host's own, minted per host start and good only at that proxy.
 */
export interface HostConfigWire {
  readonly mode: "local" | "cloud";
  readonly workspaceRootDir: string;
  readonly primaryModel: string;
  readonly maxConcurrentActivities: number;
  readonly cloudModeEnabled: boolean;
  readonly checkpointerType: "memory" | "http" | "sqlite";
  readonly mcpBridgeEndpoint: string | null;
  readonly mcpPublicEndpoint: string | null;
  readonly cursorStreamStallTimeoutMs: number;
  readonly agentResolveTimeoutMs: number;
  readonly workspaceLockTimeoutMs: number;
  /** The runner's local proxy, `http://127.0.0.1:<port>`. */
  readonly proxyEndpoint: string;
  /** The local proxy's Cursor lane, `https://127.0.0.1:<port>`, whose certificate the host trusts. */
  readonly cursorEndpoint: string;
  /** The host's credential at that proxy. */
  readonly token: string;
  /**
   * True when the runner itself talks to the Stigmer platform's proxy:
   * the host is then a proxy-mode runner pointed at the local proxy, which
   * forwards. False on a runner that calls its providers directly: the
   * host's model clients keep their direct-mode shape and reach the
   * providers through the local proxy's provider lanes, which add the key.
   */
  readonly platformProxied: boolean;
}

/** The pre-turn bytes the engine observed (`shared/filereview/cas-touched.ts`), as they cross. */
export interface WireCasSnapshot {
  /** Workspace-relative path to its base64 pre-turn bytes, `null` for a path that did not exist. */
  readonly before: readonly (readonly [string, string | null])[];
  readonly blockedSecretPaths: readonly string[];
}

/** How a remote turn ended: the adapter's `TurnOutcome`, with a failure's cause as a {@link WireError}. */
export type WireOutcome =
  | { readonly kind: "completed" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "awaiting_approval" }
  | { readonly kind: "tool_call_limit" }
  | { readonly kind: "interrupted" }
  | {
      readonly kind: "failed";
      readonly message: string;
      readonly surface: "engine" | "actionable" | "internal";
      readonly cause?: WireError;
    };

/**
 * What `runTurn` answers: how the turn ended, the status fields the adapter
 * owns, and the engine's last CAS snapshot. Exactly one of `outcome` and
 * `thrown` is set: `thrown` is an adapter that broke its contract and
 * threw, which the runtime then handles as it would in-process.
 */
export interface WireSettlement {
  readonly outcome: WireOutcome | null;
  readonly thrown: WireError | null;
  /** base64 `RunStatus` carrying only the adapter-owned fields (`codec.ts` `ADAPTER_OWNED_STATUS_FIELDS`). */
  readonly projection: string;
  /** The snapshot at settle when the adapter bound a reader; the runtime's boundary capture reads it after the turn. */
  readonly cas: WireCasSnapshot | null;
}

// ─── Calls the runner makes of the host ────────────────────────────────────

export interface HostCalls {
  /** Boot one harness's adapter in the host (`HarnessAdapter.boot`). */
  readonly boot: { readonly args: { readonly harness: HarnessName; readonly config: HostConfigWire }; readonly result: null };
  /** Shut every booted adapter down (`HarnessAdapter.shutdown`), in reverse boot order. */
  readonly shutdown: { readonly args: { readonly harness: HarnessName }; readonly result: null };
  readonly releaseSession: { readonly args: { readonly harness: HarnessName; readonly sessionId: string }; readonly result: null };
  /** Run one turn; answered when the adapter settles. */
  readonly runTurn: {
    readonly args: {
      readonly turnId: string;
      readonly harness: HarnessName;
      readonly input: WireTurnInput;
      /** base64 `RunStatus`: the whole status as the runtime seeded it. */
      readonly status: string;
      readonly timing: TimingRecorderWire;
      /** base64 per-execution approval-receipt key (`shared/approval-fingerprint.ts`); the master secret never crosses. */
      readonly fingerprintKey: string;
      /** The reason, when the runtime's stop had already fired before the call. */
      readonly stopped: string | null;
    };
    readonly result: WireSettlement;
  };
  /** The engine's CAS observations now, for the runtime's mid-turn progress refresh. */
  readonly readCasObservations: { readonly args: { readonly turnId: string }; readonly result: WireCasSnapshot };
  /** Pay the Cursor SDK's per-process store set-up now, on an idle pool member (`activities/execute-cursor/sdk-warmup.ts`). */
  readonly warmCursorSdk: {
    readonly args: Record<string, never>;
    readonly result: { readonly warmed: boolean; readonly durationMs: number; readonly error: string | null };
  };
}

// ─── Calls the host makes of the runner ────────────────────────────────────

export interface RunnerCalls {
  /**
   * `TurnSink.requestPersist`: the adapter-owned fields as of the request.
   * Answered once the runtime's chokepoint has written them, with the
   * runtime-owned fields that changed since the host last saw them, and the
   * tool outputs the chokepoint's offload has lifted to refs, which the
   * host's copy takes in place of the outputs (`shared/status-offload.ts`
   * `adoptOffloadedOutputs`), so it neither carries nor re-sends them.
   */
  readonly persist: {
    readonly args: { readonly turnId: string; readonly projection: string };
    readonly result: { readonly runtime: RuntimeFieldsWire; readonly offloads: readonly WireOffload[] };
  };
  readonly reportProgress: { readonly args: { readonly turnId: string; readonly label: string }; readonly result: null };
  /** `TurnSink.bindHarnessState`, with the session spec as the adapter left it (base64 `SessionSpec`). */
  readonly bindHarnessState: {
    readonly args: { readonly turnId: string; readonly harnessStateId: string; readonly sessionSpec: string };
    readonly result: null;
  };
  /** `TurnStandingContext.selectRecalledMemories`, which the runtime memoizes per turn. */
  readonly selectRecalledMemories: {
    readonly args: { readonly turnId: string };
    readonly result: RecalledMemoriesContent | null;
  };
  /** `ArtifactStorage.upload`, confined to the turn's own key prefix. */
  readonly uploadArtifact: {
    readonly args: { readonly turnId: string; readonly key: string; readonly content: string; readonly contentType: string | null };
    readonly result: string;
  };
  /** `MountedPlugin.verify` for one of the turn's plugins, by slug: the tree and its archive are the runner's. */
  readonly verifyPlugin: { readonly args: { readonly turnId: string; readonly slug: string }; readonly result: null };
}

// ─── One-way notices ───────────────────────────────────────────────────────

export interface HostNotices {
  /** `TurnSink.recordActivity`. */
  readonly activity: { readonly turnId: string; readonly detail: string | null };
  /** `TurnSink.reportUsage`. */
  readonly usage: { readonly turnId: string; readonly delta: UsageDelta };
  /** One event the host's transcript builder folded, at its wall-clock instant, for the runtime's timeline. */
  readonly event: { readonly turnId: string; readonly event: TranscriptEvent; readonly atWallMs: number };
  /** `TurnSink.bindCasObservations`: the adapter bound a reader. */
  readonly bindCas: { readonly turnId: string };
}

export interface RunnerNotices {
  /** The runtime's stop signal fired; the reason is diagnostic only. */
  readonly stopTurn: { readonly turnId: string; readonly reason: string };
}

// ─── Envelopes ─────────────────────────────────────────────────────────────

type CallEnvelope<C> = {
  [M in keyof C]: { readonly kind: "call"; readonly id: number; readonly method: M; readonly args: C[M] extends { args: infer A } ? A : never };
}[keyof C];

type NoticeEnvelope<N> = {
  [M in keyof N]: { readonly kind: "notify"; readonly method: M; readonly args: N[M] };
}[keyof N];

export type ResultEnvelope =
  | { readonly kind: "result"; readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly kind: "result"; readonly id: number; readonly ok: false; readonly error: WireError };

export interface HelloEnvelope {
  readonly kind: "hello";
  readonly protocolVersion: number;
}

/** Everything the runner sends. */
export type RunnerEnvelope = CallEnvelope<HostCalls> | NoticeEnvelope<RunnerNotices> | ResultEnvelope;

/** Everything the host sends. */
export type HostEnvelope = HelloEnvelope | CallEnvelope<RunnerCalls> | NoticeEnvelope<HostNotices> | ResultEnvelope;

// ─── Errors ────────────────────────────────────────────────────────────────

export function toWireError(err: unknown): WireError {
  if (err instanceof Error) return { name: err.name, message: err.message, ...(err.stack ? { stack: err.stack } : {}) };
  return { name: "Error", message: String(err) };
}

export function fromWireError(wire: WireError): Error {
  const err = new Error(wire.message);
  err.name = wire.name;
  if (wire.stack) err.stack = wire.stack;
  return err;
}
