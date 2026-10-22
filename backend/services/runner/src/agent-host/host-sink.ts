/**
 * The agent host's `TurnSink`: what an adapter running in the host sees as
 * the runtime, built over the host's own copy of the turn's rows and status
 * and answered by the runner over the pipe (`protocol.ts`).
 *
 * The adapter folds its engine into this copy synchronously, exactly as it
 * folds into the runtime's rows when it runs in the runner's process:
 * the copy, its transcript builder (`harness/transcript/builder.ts`) and
 * the setup timeline are all local, so the adapter's code path is the one
 * it always had. What leaves the host:
 *
 *  - `requestPersist` ships the adapter-owned fields as of the request
 *    (`codec.ts`) and resolves when the runtime's chokepoint has written
 *    them, with the runtime-owned fields that changed since applied to the
 *    copy. Single-flight with one coalesced follow-up, as the chokepoint is
 *    (`harness/persist-chokepoint.ts`), so a fast stream does not queue a
 *    snapshot per request; it never rejects.
 *  - `recordActivity`, `reportUsage` and every event the builder folds are
 *    notices: the runtime's watchdog, cost cap and turn timeline read them.
 *  - `reportProgress` and `bindHarnessState` are calls, because the
 *    contract lets an adapter await them. `bindHarnessState` sends the
 *    engine-minted id alone: the runtime records it through the session's
 *    door, and nothing on the session record the adapter holds changes.
 *  - `bindCasObservations` keeps the reader here and tells the runtime one
 *    exists; the runtime pulls through `readCasObservations`.
 *
 * The stop is the runner's: its `stopTurn` notice aborts {@link HostTurn.stop},
 * which is the adapter's `stopSignal`, and its `yieldTurn` notice aborts
 * {@link HostTurn.yield}, the adapter's `yieldSignal`. One cause is also seen here, because
 * it must land synchronously: the cost cap. The runtime stops a turn inside
 * `reportUsage` on the delta that reaches the cap, so in-process the engine
 * stops at its next step boundary; a stop that crossed the pipe would land a
 * step later, with the next model call already in flight. So the host watches
 * the same deltas with the same rule (`harness/cost-cap-watch.ts`) and aborts
 * locally; the terminal is still the runtime's, from its own watch.
 */

import { RunStatusSchema, type RunStatus } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { TurnRowsSchema, type TurnRows } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";

import { costCapWatchFor } from "../harness/cost-cap-watch.js";
import { TranscriptBuilder } from "../harness/transcript/builder.js";
import type { TurnInput, TurnSink, UsageDelta } from "../harness/types.js";
import { TimingRecorder, type TimingRecorderWire } from "../shared/cold-start-timing.js";
import type { CasTouchedReader } from "../shared/filereview/cas-touched.js";
import { adoptOffloadedOutputs } from "../shared/status-offload.js";
import { applyRuntimeFields, decodeMessage, decodeOffloads, encodeAdapterProjection, encodeMessage } from "./codec.js";
import type { HostNotices, HostCalls, RunnerCalls, RunnerNotices } from "./protocol.js";
import type { Peer } from "./channel.js";

/** The host's side of the pipe: it calls the runner and answers the runner's calls. */
export type HostPeer = Peer<RunnerCalls, HostCalls, HostNotices, RunnerNotices>;

/** One turn the host is running: its sink, its stop, and the CAS reader the adapter bound. */
export class HostTurn {
  readonly sink: TurnSink;
  readonly status: RunStatus;
  readonly rows: TurnRows;
  private readonly stopController = new AbortController();
  private readonly yieldController = new AbortController();
  private casReader: CasTouchedReader | undefined;
  private persistInFlight: Promise<void> | undefined;
  private pendingInput = false;
  private readonly pendingListeners = new Set<() => void>();
  private persistFollowUp: Promise<void> | undefined;

  constructor(
    private readonly peer: HostPeer,
    readonly turnId: string,
    input: TurnInput,
    status: string,
    rows: string,
    timing: TimingRecorderWire,
  ) {
    this.status = decodeMessage(RunStatusSchema, status);
    this.rows = decodeMessage(TurnRowsSchema, rows);
    const transcript = new TranscriptBuilder(input.executionId, this.rows, this.status, (event, _atMs, place) =>
      peer.notify("event", {
        turnId,
        event,
        atWallMs: performance.timeOrigin + performance.now(),
        messageIndex: place?.messageIndex ?? null,
      }),
    );
    const setupTiming = TimingRecorder.fromWire(timing);
    const costCap = costCapWatchFor(input);
    this.sink = {
      status: this.status,
      rows: this.rows,
      transcript,
      stopSignal: this.stopController.signal,
      yieldSignal: this.yieldController.signal,
      setupTiming,
      // The runtime's channel, over the pipe: the runtime claims and mounts,
      // and answers whether more still wait.
      input: {
        pending: () => this.pendingInput,
        onPending: (listener) => {
          this.pendingListeners.add(listener);
          return () => this.pendingListeners.delete(listener);
        },
        claim: async (options = {}) => {
          if (!this.pendingInput && options.force !== true) return [];
          const { messages, pending } = await peer.call("claimInput", { turnId, force: options.force === true });
          this.pendingInput = pending;
          return [...messages];
        },
        claimed: async (delivered) => [...(await peer.call("claimedInput", { turnId, delivered: [...delivered] }))],
      },
      requestPersist: () => this.requestPersist(),
      recordActivity: (detail?: string) => peer.notify("activity", { turnId, detail: detail ?? null }),
      reportUsage: (delta: UsageDelta) => {
        peer.notify("usage", { turnId, delta });
        if (costCap.add(delta)) this.stop("cost-cap");
      },
      reportProgress: async (label: string) => {
        try {
          await peer.call("reportProgress", { turnId, label });
        } catch (err) {
          console.warn(`[agent-host] progress label not reported: execution=${input.executionId}, ${describe(err)}`);
        }
      },
      bindHarnessState: async (harnessStateId: string) => {
        await peer.call("bindHarnessState", { turnId, harnessStateId });
      },
      bindCasObservations: (read: CasTouchedReader) => {
        this.casReader = read;
        peer.notify("bindCas", { turnId });
      },
    };
  }

  /** The runtime's stop fired. */
  stop(reason: string): void {
    if (!this.stopController.signal.aborted) this.stopController.abort(new Error(reason));
  }

  /** The session's queue holds messages for the turn. */
  inputPending(): void {
    if (this.pendingInput) return;
    this.pendingInput = true;
    for (const listener of [...this.pendingListeners]) listener();
  }

  /** The runtime asked the turn to yield. */
  yield(): void {
    if (!this.yieldController.signal.aborted) this.yieldController.abort();
  }

  /** The reader the adapter bound, if any. */
  get cas(): CasTouchedReader | undefined {
    return this.casReader;
  }

  private requestPersist(): Promise<void> {
    if (this.persistInFlight === undefined) {
      const write = this.persistNow().finally(() => {
        this.persistInFlight = undefined;
      });
      this.persistInFlight = write;
      return write;
    }
    if (this.persistFollowUp === undefined) {
      this.persistFollowUp = this.persistInFlight.then(() => {
        this.persistFollowUp = undefined;
        return this.requestPersist();
      });
    }
    return this.persistFollowUp;
  }

  private async persistNow(): Promise<void> {
    try {
      const { runtime, offloads } = await this.peer.call("persist", { turnId: this.turnId, projection: encodeAdapterProjection(this) });
      applyRuntimeFields(this.status, runtime);
      adoptOffloadedOutputs(this.rows, decodeOffloads(offloads));
    } catch (err) {
      console.warn(`[agent-host] persist request failed: turn=${this.turnId}, ${describe(err)}`);
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
