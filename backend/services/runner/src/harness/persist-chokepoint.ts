/**
 * The turn runtime's single persist chokepoint: every write of the
 * execution status during a turn — the adapter's streaming requests, the
 * runtime's own terminal writes — goes through here and nowhere else, so
 * the guards that must never be skipped cannot be skipped by a call site
 * that forgot them.
 *
 * What one write does, in order:
 *  1. The never-persist-secret backstop: content is withheld from
 *     any built-in write row targeting a secret-like path, top-level and
 *     sub-agent, before the rows reach the session's log. The single
 *     airtight choke point for a deny-gate harness and the only guarantee
 *     under `auto_approve_all`. Idempotent.
 *  2. `file_change_progress` is refreshed from the turn's capture (the "N
 *     files changed so far" strip) when the turn is in capture mode:
 *     the tree is read at most once per floor interval and only re-attached
 *     when it moved (`shared/filereview/progress.ts`), so a write that
 *     changed nothing on disk carries the snapshot it already had. Before
 *     #1096 each adapter's stream loop did this before its own persists; the
 *     runtime owns the capture now, so the display field it derives is
 *     refreshed where every other runtime-owned field is — here. A capture
 *     that fails is skipped there, never thrown, so it never fails the write
 *     and `request()` keeps its promise to the adapters.
 *  3. `streaming_usage` is refreshed from the accumulator when it has turns,
 *     so the summary the UI shows is the one the write carries.
 *  4. `persistStatus` (`shared/status.ts`): tool-output offload over the
 *     rows, the run's file record read from the rows' ledger, then the
 *     session event flush (`events/emitter.ts`: what the agent did, read from
 *     the rows as offloaded and appended to the session's log before the
 *     status that follows it), then the aggregate size cap, transient
 *     retry, oversize recovery. Never rejects. The flush is a second RPC
 *     under the same single flight: an adapter's coalesced follow-up covers
 *     both. The status sent carries lifecycle, stamps and files, never the
 *     rows.
 *  5. A Temporal heartbeat, so a long streaming turn's liveness is proven by
 *     the writes it makes.
 *  6. The control plane's answer: STOP becomes the runtime's platform-stop
 *     cause on the stop controller, which aborts the adapter's signal.
 *
 * Single-flight with coalescing: an adapter's `requestPersist()` while a
 * write is in flight does not start a second concurrent write (two writes of
 * one status racing on the wire is the drift the chokepoint exists to
 * prevent); it schedules ONE follow-up write after the current one lands,
 * and resolves when that follow-up has. The promise it returns therefore
 * always means "the state as of my request is on the control plane", which
 * is what lets the Cursor loop await it and see a STOP before it pulls the
 * next event, exactly as its own inline persist did.
 *
 * The runtime's terminal writes use the same path (`write()`), so the
 * secret backstop and the usage summary ride the final status too, as they
 * did when the orchestrator's `persist` closure was the one place to write.
 */

import { create } from "@bufbuild/protobuf";
import type { RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunControlSignal } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { StreamingUsageSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/usage_pb";

import type { StigmerClient } from "../client/stigmer-client.js";
import { captureFileChangeProgress } from "../shared/filereview/progress.js";
import { persistStatus } from "../shared/status.js";
import type { ToolOutputOffloadContext } from "../shared/status-offload.js";
import type { SessionEventEmitter } from "./events/emitter.js";
import { withholdSecretContentFromMessages } from "../shared/tool-row.js";
import type { TurnProgress } from "./capture.js";
import type { UsageAccumulator } from "./usage-accumulator.js";
import type { TurnRows } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

export interface PersistChokepointDeps {
  readonly client: StigmerClient;
  readonly executionId: string;
  readonly status: RunStatus;
  /** The turn's rows: bounded and read into the session's log on every write, never sent with the status. */
  readonly rows: TurnRows;
  /** Present when artifact storage resolved; enables tool-output offload on every write. */
  readonly offload: ToolOutputOffloadContext | undefined;
  /**
   * The accumulator, read at WRITE time: it exists only once the runtime has
   * the turn's model preferences, after resolution, so it arrives as a thunk
   * and is `undefined` for a write made before then (no usage yet anyway).
   */
  readonly usage: () => UsageAccumulator | undefined;
  /**
   * The turn's mid-run progress, read at WRITE time for the same reason as
   * `usage`: it exists only once the runtime has pinned the capture baseline,
   * after resolution, and is `undefined` outside capture mode.
   */
  readonly progress: () => TurnProgress | undefined;
  /** The Temporal heartbeat, pulsed after each write. */
  readonly heartbeat: () => void;
  /** The control plane answered STOP to this write. */
  readonly onPlatformStop: () => void;
  /** Writes the session's events from the rows each write carries; absent in tests that do not read the log. */
  readonly events?: Pick<SessionEventEmitter, "flush">;
}

export class PersistChokepoint {
  private inFlight: Promise<void> | undefined;
  private followUp: Promise<void> | undefined;

  constructor(private readonly deps: PersistChokepointDeps) {}

  /**
   * The adapter's `requestPersist()`: a write now, or one follow-up write
   * after the in-flight one. Resolves when the state as of this call has
   * been written. Never rejects.
   */
  request(): Promise<void> {
    if (this.inFlight === undefined) {
      const write = this.write().finally(() => {
        this.inFlight = undefined;
      });
      this.inFlight = write;
      return write;
    }
    if (this.followUp === undefined) {
      this.followUp = this.inFlight.then(() => {
        this.followUp = undefined;
        return this.request();
      });
    }
    return this.followUp;
  }

  /**
   * One write, now. The runtime's own writes (a settlement, a terminal
   * status) call this directly: they run when no adapter write can be in
   * flight (before `runTurn` or after it settled), so they need no
   * coalescing, and they must not be deferred behind one. `final` marks the
   * turn's terminal write: the boundary has run and nothing streams, so the
   * session event emitter writes every row that is left.
   */
  async write(opts: { readonly final?: boolean } = {}): Promise<void> {
    const { client, executionId, status, rows, offload, heartbeat } = this.deps;
    withholdSecretContentFromMessages(rows.messages, rows.subAgentRuns);
    const progress = this.deps.progress();
    if (progress) {
      await captureFileChangeProgress({ status, changeSetId: progress.changeSetId, substrate: progress.substrate, state: progress.state });
    }
    const usage = this.deps.usage();
    if (usage?.hasTurns) {
      status.streamingUsage = create(StreamingUsageSummarySchema, usage.snapshot());
    }
    const events = this.deps.events;
    const signal = await persistStatus(client, executionId, status, {
      rows,
      offload,
      ...(events ? { afterOffload: () => events.flush(rows, { final: opts.final === true }) } : {}),
    });
    heartbeat();
    if (signal === RunControlSignal.STOP) {
      this.deps.onPlatformStop();
    }
  }
}
