// The engine of `stigmer load-test`: make one agent of its own, start N
// turns on it at the same moment, watch each until it ends or the watch's
// time is up, read each run once, then delete everything it made.
//
// - Every turn is a new conversation (`startTurn` with a `sessionSpec`), so
//   each asks the fleet for a sandbox of its own. The creates are fired
//   together (one `Promise.allSettled`, no stagger); a create the server
//   refuses is kept as its code and the server's own sentence.
// - Each admitted turn is followed the way `stigmer run` follows one
//   (`followSession` with the `stigmer.run.liveness` preview), never with
//   `waitForTurn`, which asks for no previews and so never sees a wait. The
//   largest `awaiting_sandbox_for` any frame carried is kept: a later
//   liveness replaces the fold's, so the fold forgets the wait once the turn
//   starts.
// - A started turn's conversation is left as a person leaves one until the
//   cleanup at the end: its sandbox holds its place until the fleet's own
//   idle sweep, which is how room frees for the turns still waiting.
// - The cleanup runs on every way out, Ctrl-C included: every follow is
//   aborted, every run still open is terminated, every conversation it made
//   is deleted (with its sandbox), then the agent. What could not be deleted
//   is returned by id. This command cannot read a server's database, so it
//   never claims the fleet is empty.
//
// The client is the narrow slice of `Stigmer` the engine calls, so tests
// drive it with a fake.

import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Duration } from "@bufbuild/protobuf/wkt";
import {
  type AgentInput,
  followSession,
  isTerminalPhase,
  type RunInput,
  type SessionEventsClient,
  SessionLog,
  startTurn,
  StigmerError,
  turnOf,
  type TurnPhase,
} from "@stigmer/client";
import type { Refusal, RunSighting } from "./report.js";

/** The slice of the client the engine calls. */
export interface LoadTestClient extends SessionEventsClient {
  readonly agent: {
    create(input: AgentInput): Promise<Agent>;
    delete(id: string): Promise<unknown>;
  };
  readonly run: {
    create(input: RunInput): Promise<Run>;
    get(id: string): Promise<Run>;
    terminate(input: { id: string; reason: string }): Promise<unknown>;
  };
  readonly session: SessionEventsClient["session"] & {
    delete(id: string): Promise<unknown>;
  };
}

/** How the burst stands, each time it changes. */
export interface BurstProgress {
  readonly sent: number;
  readonly started: number;
  /** Admitted and not yet started: waiting for a sandbox, or still setting up. */
  readonly waiting: number;
  readonly refused: number;
}

export interface BurstOptions {
  /** The organization the agent and the turns are made in ("" lets a single-organization server fill it). */
  readonly org: string;
  readonly agents: number;
  /** The model every turn asks for; "" leaves the agent's default. */
  readonly model: string;
  readonly message: string;
  /** Each turn's budget, `RunConfig.max_cost_usd`. */
  readonly shareUsd: number;
  /** How long to watch, from the burst, before calling a run still waiting. */
  readonly waitMs: number;
  /** Ctrl-C: stops every watch; the cleanup still runs. */
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: BurstProgress) => void;
  /** The agent's name suffix; random when absent (tests pin it). */
  readonly nonce?: string;
}

/** What the burst saw, and what its cleanup could not delete. */
export interface BurstResult {
  /** The agent's slug. */
  readonly agent: string;
  readonly sightings: readonly RunSighting[];
  /** "<kind> <id>" for each thing the cleanup could not delete. */
  readonly leftBehind: readonly string[];
  /** Whether Ctrl-C ended the watch. */
  readonly interrupted: boolean;
}

/** The one-line instructions the burst's agent runs: each turn stays tiny. */
export const AGENT_INSTRUCTIONS = "Reply with one word.";

const TERMINATE_REASON = "stigmer load-test cleanup";

// The fold's phases a turn has only once its runner started it.
const STARTED_PHASES: ReadonlySet<TurnPhase> = new Set<TurnPhase>(["running", "waiting", "paused", "completed"]);

interface Admitted {
  readonly index: number;
  readonly runId: string;
  readonly sessionId: string;
}

/** Run the burst (module header). The agent's create throws through; everything after it is cleaned up. */
export async function runBurst(client: LoadTestClient, options: BurstOptions): Promise<BurstResult> {
  const nonce = options.nonce ?? Math.random().toString(36).slice(2, 8);
  const agent = await client.agent.create({
    name: `load-test-${nonce}`,
    org: options.org,
    description: "Made by stigmer load-test and deleted when it ends.",
    instructions: AGENT_INSTRUCTIONS,
  });
  const agentId = agent.metadata?.id ?? "";
  const agentRef = { org: agent.metadata?.org ?? options.org, slug: agent.metadata?.slug ?? "" };

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), options.waitMs);
  const signal = AbortSignal.any([options.signal, deadline.signal]);
  const tracker = new Tracker(options.agents, options.onProgress);
  const slots: Array<Admitted | Refusal> = [];
  const admitted: Admitted[] = [];
  const waits = new Map<string, number>();
  const runs = new Map<string, Run>();
  try {
    const sends = await Promise.allSettled(
      Array.from({ length: options.agents }, () =>
        startTurn(client, {
          org: agentRef.org,
          message: options.message,
          sessionSpec: { agentRef, includeMyVault: true },
          runConfig: { maxCostUsd: options.shareUsd, ...(options.model === "" ? {} : { modelName: options.model }) },
        }),
      ),
    );
    for (const [i, send] of sends.entries()) {
      if (send.status === "fulfilled") {
        const a = { index: i + 1, runId: send.value.runId, sessionId: send.value.sessionId };
        admitted.push(a);
        slots.push(a);
      } else {
        slots.push(refusalOf(send.reason));
      }
    }
    tracker.sent(admitted.map((a) => a.runId), slots.length - admitted.length);

    await Promise.all(
      admitted.map(async (a) => {
        const waited = await watch(client, a, signal, tracker);
        if (waited !== undefined) waits.set(a.runId, waited);
      }),
    );
    await Promise.all(
      admitted.map(async (a) => {
        const run = await client.run.get(a.runId).catch(() => undefined);
        if (run !== undefined) runs.set(a.runId, run);
      }),
    );
  } finally {
    clearTimeout(timer);
  }

  const leftBehind = await cleanUp(client, admitted, runs, agentId);
  const sightings = slots.map((slot, i): RunSighting =>
    "runId" in slot
      ? { index: slot.index, runId: slot.runId, sessionId: slot.sessionId, run: runs.get(slot.runId), waitedMs: waits.get(slot.runId) }
      : { index: i + 1, runId: "", sessionId: "", refusal: slot },
  );
  return { agent: agentRef.slug, sightings, leftBehind, interrupted: options.signal.aborted };
}

/** A refused create as its code word and the server's own sentence. */
export function refusalOf(err: unknown): Refusal {
  if (err instanceof StigmerError) return { code: err.code, message: err.message };
  return { code: "unknown", message: err instanceof Error ? err.message : String(err) };
}

// Follow one turn until it ends or the watch stops; the largest wait for a
// sandbox its liveness carried, or undefined when it reported none. A follow
// the server refuses ends the watch; the run is read afterwards either way.
async function watch(client: LoadTestClient, a: Admitted, signal: AbortSignal, tracker: Tracker): Promise<number | undefined> {
  const own = new AbortController();
  const log = new SessionLog();
  let waited: number | undefined;
  try {
    for await (const frame of followSession(client, a.sessionId, {
      signal: AbortSignal.any([signal, own.signal]),
      previews: ["stigmer.run.liveness"],
    })) {
      if (frame.frame.case === "stigmerRunLiveness" && frame.frame.value.runId === a.runId) {
        const awaiting = frame.frame.value.awaitingSandboxFor;
        if (awaiting !== undefined) waited = Math.max(waited ?? 0, durationMs(awaiting));
      }
      if (!log.applyFrame(frame)) continue;
      const turn = turnOf(log.snapshot(), a.runId);
      if (turn?.status === undefined) continue;
      if (STARTED_PHASES.has(turn.status.phase)) tracker.started(a.runId);
      if (turn.ended) {
        tracker.ended(a.runId);
        break;
      }
    }
  } catch {
    // A refused follow: the run's own read says how it stands.
  } finally {
    own.abort();
  }
  return waited;
}

// Terminate what is still open, delete each conversation, then the agent;
// return what could not be deleted.
async function cleanUp(client: LoadTestClient, admitted: readonly Admitted[], runs: ReadonlyMap<string, Run>, agentId: string): Promise<string[]> {
  const left: string[] = [];
  await Promise.all(
    admitted
      .filter((a) => !isTerminalPhase(runs.get(a.runId)?.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED))
      .map((a) => client.run.terminate({ id: a.runId, reason: TERMINATE_REASON }).catch(() => undefined)),
  );
  await Promise.all(
    admitted.map(async (a) => {
      try {
        await client.session.delete(a.sessionId);
      } catch {
        left.push(`conversation ${a.sessionId}`);
      }
    }),
  );
  if (agentId !== "") {
    try {
      await client.agent.delete(agentId);
    } catch {
      left.push(`agent ${agentId}`);
    }
  }
  return left;
}

function durationMs(duration: Duration): number {
  return Number(duration.seconds) * 1000 + Math.floor(duration.nanos / 1_000_000);
}

// The burst's counts, told to the caller each time one changes.
class Tracker {
  private readonly startedRuns = new Set<string>();
  private readonly endedRuns = new Set<string>();
  private admitted: readonly string[] = [];
  private refused = 0;

  constructor(
    private readonly total: number,
    private readonly onProgress: ((progress: BurstProgress) => void) | undefined,
  ) {}

  sent(admitted: readonly string[], refused: number): void {
    this.admitted = admitted;
    this.refused = refused;
    this.tell();
  }

  started(runId: string): void {
    if (this.startedRuns.has(runId)) return;
    this.startedRuns.add(runId);
    this.tell();
  }

  ended(runId: string): void {
    if (this.endedRuns.has(runId)) return;
    this.endedRuns.add(runId);
    this.tell();
  }

  private tell(): void {
    const waiting = this.admitted.filter((id) => !this.startedRuns.has(id) && !this.endedRuns.has(id)).length;
    this.onProgress?.({ sent: this.total, started: this.startedRuns.size, waiting, refused: this.refused });
  }
}
