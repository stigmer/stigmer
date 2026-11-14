// A scripted server for `stigmer load-test`'s suites: the slice of the
// client the burst calls (commands/load-test/burst.ts), where each turn the
// burst starts takes the next script in order. A script refuses the create,
// or names the frames its conversation's stream sends and the run its read
// returns; the stream then stays open until the follow is aborted, as a live
// server's does. Every call is recorded for the assertions.

import { clone, create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { type Agent, AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { type Run, RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import {
  SessionEventListSchema,
  type StreamSessionEventsRequest,
  StreamSessionEventsResponseSchema,
  type StreamSessionEventsResponse,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import type { AgentInput, RunInput, StigmerError } from "@stigmer/client";
import type { LoadTestClient } from "../load-test/burst.js";
import { frameOf, phase, user } from "../../resources/__test-utils__/session-events.js";

/** One turn's script. */
export interface TurnScript {
  /** The create's refusal: the turn is never made. */
  readonly refuse?: StigmerError;
  /** What the conversation's stream sends, in order. */
  readonly frames?: readonly StreamSessionEventsResponse[];
  /** The stream's refusal, thrown after the frames. */
  readonly streamError?: Error;
  /** What the run's read returns (its id is filled in); a read that fails when absent. */
  readonly run?: Run;
}

/** A turn that starts and completes: its stamps 3.25 s apart, a tiny spend. */
export function completes(runId: string): TurnScript {
  return {
    frames: [user(runId, "hi"), phase(runId, "pending"), phase(runId, "running"), phase(runId, "completed")].map(frameOf),
    run: runOf({ phase: RunPhase.RUN_COMPLETED, startedAt: "2026-11-14T10:00:05.250Z", cost: 0.0007 }),
  };
}

/** A liveness frame for a run: waiting for a sandbox for `seconds`, or none to clear it. */
export function liveness(runId: string, seconds?: number): StreamSessionEventsResponse {
  return create(StreamSessionEventsResponseSchema, {
    frame: {
      case: "stigmerRunLiveness",
      value: seconds === undefined ? { runId } : { runId, awaitingSandboxFor: { seconds: BigInt(seconds) } },
    },
  });
}

/** A Run as the read returns it: created at 10:00:02.000Z (or `createdAt`), with the status given. */
export function runOf(status: {
  phase: RunPhase;
  startedAt?: string;
  createdAt?: Date;
  cost?: number;
  stopCause?: string;
  stopKind?: string;
}): Run {
  return create(RunSchema, {
    status: {
      phase: status.phase,
      startedAt: status.startedAt ?? "",
      stopCause: status.stopCause ?? "",
      ...(status.stopKind === undefined ? {} : { stopDetail: { kind: status.stopKind } }),
      ...(status.cost === undefined ? {} : { streamingUsage: { estimatedCostUsd: status.cost } }),
      audit: { specAudit: { createdAt: timestampFromDate(status.createdAt ?? new Date("2026-11-14T10:00:02.000Z")) } },
    },
  });
}

/** The fake server: `scripts[i]` is the i-th turn's, in the order the creates arrive. */
export class LoadTestServer implements LoadTestClient {
  readonly agentsMade: AgentInput[] = [];
  readonly agentsDeleted: string[] = [];
  readonly runsMade: RunInput[] = [];
  readonly terminated: string[] = [];
  readonly sessionsDeleted: string[] = [];
  /** The follows' signals, by session. */
  readonly follows = new Map<string, AbortSignal>();
  /** Session ids whose delete fails. */
  readonly undeletableSessions = new Set<string>();
  agentDeleteFails = false;
  agentCreateRefusal: StigmerError | undefined;
  /** Called once every stream has sent its frames (tests press Ctrl-C there). */
  onAllFollowing: (() => void) | undefined;

  constructor(private readonly scripts: readonly TurnScript[]) {}

  readonly agent = {
    create: async (input: AgentInput): Promise<Agent> => {
      if (this.agentCreateRefusal !== undefined) throw this.agentCreateRefusal;
      this.agentsMade.push(input);
      return create(AgentSchema, { metadata: { id: "agt_1", org: input.org === "" ? "solo" : input.org, slug: input.name } });
    },
    delete: async (id: string): Promise<unknown> => {
      if (this.agentDeleteFails) throw new Error("agent delete refused");
      this.agentsDeleted.push(id);
      return undefined;
    },
  };

  readonly run = {
    create: async (input: RunInput): Promise<Run> => {
      const i = this.runsMade.length;
      this.runsMade.push(input);
      const script = this.scripts[i];
      if (script?.refuse !== undefined) throw script.refuse;
      return create(RunSchema, { metadata: { id: `run_${i + 1}` }, spec: { target: { case: "sessionId", value: `ses_${i + 1}` } } });
    },
    get: async (id: string): Promise<Run> => {
      const run = this.scriptOf(id.replace("run_", "")).run;
      if (run === undefined) throw new Error("read failed");
      const read = clone(RunSchema, run);
      read.metadata = create(ApiResourceMetadataSchema, { id });
      return read;
    },
    terminate: async (input: { id: string; reason: string }): Promise<unknown> => {
      this.terminated.push(input.id);
      return undefined;
    },
  };

  private following = 0;

  readonly session = {
    streamEvents: (input: StreamSessionEventsRequest, signal?: AbortSignal): AsyncIterable<StreamSessionEventsResponse> => {
      const script = this.scriptOf(input.sessionId.replace("ses_", ""));
      if (signal !== undefined) this.follows.set(input.sessionId, signal);
      const self = this;
      return (async function* () {
        for (const frame of script.frames ?? []) {
          if (frame.frame.case === "event" && frame.frame.value.seq <= (input.afterSeq ?? 0n)) continue;
          yield frame;
        }
        if (script.streamError !== undefined) throw script.streamError;
        self.following += 1;
        if (self.following === self.scripts.filter((s) => s.refuse === undefined).length) self.onAllFollowing?.();
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted === true) reject(new DOMException("Aborted", "AbortError"));
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      })();
    },
    listEvents: async () => create(SessionEventListSchema, {}),
    delete: async (id: string): Promise<unknown> => {
      if (this.undeletableSessions.has(id)) throw new Error("session delete refused");
      this.sessionsDeleted.push(id);
      return undefined;
    },
  };

  private scriptOf(oneBased: string): TurnScript {
    return this.scripts[Number(oneBased) - 1] ?? {};
  }
}
