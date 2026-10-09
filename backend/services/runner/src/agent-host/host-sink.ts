/**
 * The agent host's `TurnSink`: what an adapter running in the host sees as
 * the runtime, built over the host's own copy of the turn's status and
 * answered by the runner over the pipe (`protocol.ts`).
 *
 * The adapter folds its engine into this copy synchronously, exactly as it
 * folds into the runtime's status when it runs in the runner's process:
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
 *    session spec the adapter left (its own fields set) and, once the
 *    runtime has written it, mirrors onto the host's session the two fields
 *    the runtime writes on the shared record, so the adapter reads the
 *    record as it would in-process.
 *  - `bindCasObservations` keeps the reader here and tells the runtime one
 *    exists; the runtime pulls through `readCasObservations`.
 *
 * The stop is the runner's: its `stopTurn` notice aborts {@link HostTurn.stop},
 * which is the adapter's `stopSignal`. One cause is also seen here, because
 * it must land synchronously: the cost cap. The runtime stops a turn inside
 * `reportUsage` on the delta that reaches the cap, so in-process the engine
 * stops at its next step boundary; a stop that crossed the pipe would land a
 * step later, with the next model call already in flight. So the host watches
 * the same deltas with the same rule (`harness/cost-cap-watch.ts`) and aborts
 * locally; the terminal is still the runtime's, from its own watch.
 */

import { RunStatusSchema, type RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";

import { CostCapWatch } from "../harness/cost-cap-watch.js";
import { TranscriptBuilder } from "../harness/transcript/builder.js";
import type { TurnInput, TurnSink, UsageDelta } from "../harness/types.js";
import { TimingRecorder, type TimingRecorderWire } from "../shared/cold-start-timing.js";
import type { CasTouchedReader } from "../shared/filereview/cas-touched.js";
import { applyRuntimeFields, decodeMessage, encodeAdapterProjection, encodeMessage } from "./codec.js";
import type { HostNotices, HostCalls, RunnerCalls, RunnerNotices } from "./protocol.js";
import type { Peer } from "./channel.js";

/** The host's side of the pipe: it calls the runner and answers the runner's calls. */
export type HostPeer = Peer<RunnerCalls, HostCalls, HostNotices, RunnerNotices>;

/** One turn the host is running: its sink, its stop, and the CAS reader the adapter bound. */
export class HostTurn {
  readonly sink: TurnSink;
  readonly status: RunStatus;
  private readonly stopController = new AbortController();
  private casReader: CasTouchedReader | undefined;
  private persistInFlight: Promise<void> | undefined;
  private persistFollowUp: Promise<void> | undefined;

  constructor(
    private readonly peer: HostPeer,
    readonly turnId: string,
    input: TurnInput,
    status: string,
    timing: TimingRecorderWire,
  ) {
    this.status = decodeMessage(RunStatusSchema, status);
    const transcript = new TranscriptBuilder(input.executionId, this.status, (event) =>
      peer.notify("event", { turnId, event, atWallMs: performance.timeOrigin + performance.now() }),
    );
    const setupTiming = TimingRecorder.fromWire(timing);
    const costCap = new CostCapWatch(input.execution.status?.runConfig?.maxCostUsd ?? 0, input.model.serviceTier, input.model.thinkingMode);
    this.sink = {
      status: this.status,
      transcript,
      stopSignal: this.stopController.signal,
      setupTiming,
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
        const spec = input.session.spec!;
        await peer.call("bindHarnessState", {
          turnId,
          harnessStateId,
          sessionSpec: encodeMessage(SessionSpecSchema, spec),
        });
        spec.harnessStateId = harnessStateId;
        if (input.session.metadata) input.session.metadata.slug = "";
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
      const { runtime } = await this.peer.call("persist", { turnId: this.turnId, projection: encodeAdapterProjection(this.status) });
      applyRuntimeFields(this.status, runtime);
    } catch (err) {
      console.warn(`[agent-host] persist request failed: turn=${this.turnId}, ${describe(err)}`);
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
