// Follows one long turn in real time, minute by minute, until it ends: the
// loop the real-clock run (against the mock) and the live run (against real
// providers) share.
// Domain: conformance long turn (the driver; hand-run only).
//
// Every second it reads the run and the step markers; when a held step is
// open it acts once and releases the step: `kill` and `drain` ask its caller
// to end the runner; `server-restart` asks it to replace the server, and
// where two servers overlap (a Postgres target) releases the step while
// both serve, so the step's end is written through the outgoing server;
// `message` sends the person's message to the session, replaces the server
// while the message waits in the queue, then releases the step.
// Every minute it records a sample and rewrites the report. It stops on
// COMPLETED, on any other terminal phase held for 20 s (a drained turn
// writes FAILED before the workflow recovers it), or when the profile's
// budget is spent, then reads the session's whole log back for the
// transcript check.
//
// Beside the poll, a streaming follower (follow.ts) reads the session from
// its first event through every restart; at the end it is given the stream's
// longest wait (the server's tail read backs off to two minutes) to reach the
// log's last seq, and what it was sent is checked against the log. A
// follower of what needs the person, when its caller opened one, is given a
// minute after the turn ends to be told of it, and the person's message is
// found in the log read back. Nothing
// about the turn is retried: its fate is the finding. Only the run's own
// reads are, while a restart leaves the front with no server for a moment.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Code, ConnectError } from "@connectrpc/connect";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { ConformanceClients } from "../harness/clients";
import type { ServerRestart, ServerRestartOptions } from "../targets/target";
import { sessionIdOf } from "../support/runs";
import { foldSession, turnOf } from "@stigmer/session-log";
import { stepProgressOf, type LongTurnProfile, type StepFiles } from "./profile";
import { SessionFollower } from "./follow";
import { compactedEventsOf, followerCheckOf, messageCheckOf, movedSeqsOf, transcriptCheckOf, writeLongTurnReport, type LongTurnReport, type MinuteSample } from "./report";
import type { AttentionFollower } from "./follow";

/* v8 ignore start -- @preserve: the real-clock and live runs are hand-run scripts no vitest config collects; the unit lane tests the pure readers and the report they feed */
const TERMINAL = new Set([RunPhase.RUN_COMPLETED, RunPhase.RUN_FAILED, RunPhase.RUN_CANCELLED, RunPhase.RUN_TERMINATED]);
const TERMINAL_SETTLE_MS = 20_000;
const TICK_MS = 1_000;
const SAMPLE_MS = 60_000;
/** How long a released server-restart step may take to end while both servers serve. */
const OVERLAP_STEP_END_MS = 60_000;
/** The follower's longest wait for the log's last seq: past the server's two-minute tail read. */
const FOLLOWER_CATCH_UP_MS = 150_000;
/** How long the run's own reads retry while a restart leaves the front with no server. */
const READ_RETRY_MS = 120_000;
/** How long the follower of what needs the person may take to be told the turn ended. */
const ATTENTION_WAIT_MS = 60_000;

export interface DriveOptions {
  readonly clients: ConformanceClients;
  readonly runId: string;
  readonly profile: LongTurnProfile;
  readonly files: StepFiles;
  readonly out: string;
  readonly report: LongTurnReport;
  readonly startedAtMs: number;
  /** Ends the runner by `signal` and returns once a replacement serves; absent where the stack has no such door. */
  readonly restartRunner?: (signal: "SIGKILL" | "SIGTERM") => Promise<void>;
  /** Replaces the server behind the stack's front (the target's restartServer); absent where the stack has no such door. */
  readonly restartServer?: (options: ServerRestartOptions) => Promise<ServerRestart>;
  /** The mock's counts, when there is a mock. */
  readonly counts?: () => { readonly modelCalls: number; readonly compactions: number };
  /** Sends the person's message to the session; absent where the run sends none. */
  readonly sendMessage?: (sessionId: string, text: string) => Promise<{ readonly eventId: string; readonly queued: boolean }>;
  /** A follower of what needs the run's person, opened before the run; absent where none runs. */
  readonly attention?: AttentionFollower;
}

/** Follow the run to its end and return the final report (also written to `out`). */
export async function driveLongTurn(options: DriveOptions): Promise<LongTurnReport> {
  const { clients, runId, profile, files, out } = options;
  let report = options.report;
  const minutes = (): number => Math.round((Date.now() - options.startedAtMs) / 6_000) / 10;
  const acted = new Set<string>();
  let terminalSince: number | undefined;
  let nextSample = Date.now() + SAMPLE_MS;
  let follower: SessionFollower | undefined;
  try {
  for (;;) {
    const run = await retried(() => clients.agentExecutionQuery.get({ value: runId }));
    const phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
    const progress = stepProgressOf(readFileSync(files.markers, "utf8"));
    if (follower === undefined && sessionIdOf(run) !== "") follower = new SessionFollower(clients, sessionIdOf(run));

    const open = profile.steps.find((s) => s.id === progress.open);
    if (open !== undefined && (open.kind === "kill" || open.kind === "drain") && !acted.has(open.id)) {
      acted.add(open.id);
      const signal = open.kind === "kill" ? "SIGKILL" : "SIGTERM";
      report = { ...report, runnerEvents: [...report.runnerEvents, { elapsedMinutes: minutes(), step: open.id, signal }] };
      console.log(`[long-turn] minute ${minutes()}: ${signal} during ${open.id}`);
      const ending = options.restartRunner?.(signal);
      // A drain is let finish the step a moment later; a crash has nothing to finish.
      if (signal === "SIGTERM") await new Promise((r) => setTimeout(r, 2_000));
      writeFileSync(files.releaseOf(open.id), "released\n");
      await ending;
    }

    if (open !== undefined && open.kind === "server-restart" && !acted.has(open.id)) {
      acted.add(open.id);
      const release = (): void => {
        if (!existsSync(files.releaseOf(open.id))) writeFileSync(files.releaseOf(open.id), "released\n");
      };
      if (options.restartServer === undefined) {
        console.log(`[long-turn] minute ${minutes()}: no server door on this stack; ${open.id} released as it is`);
        release();
      } else {
        console.log(`[long-turn] minute ${minutes()}: replacing the server during ${open.id}`);
        const at = minutes();
        const restart = await options.restartServer({
          // Both servers serve: let the step end now, so the turn writes its
          // end through the outgoing server, which the runner still holds.
          duringOverlap: async () => {
            release();
            const deadline = Date.now() + OVERLAP_STEP_END_MS;
            while (!stepProgressOf(readFileSync(files.markers, "utf8")).ended.includes(open.id) && Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 200));
            }
            await new Promise((r) => setTimeout(r, 5_000));
          },
        });
        release();
        report = { ...report, serverRestarts: [...(report.serverRestarts ?? []), { elapsedMinutes: at, step: open.id, overlapped: restart.overlapped }] };
        console.log(`[long-turn] minute ${minutes()}: the server replaced (${restart.overlapped ? "overlapping" : "stop then start"})`);
      }
    }

    if (open !== undefined && open.kind === "message" && !acted.has(open.id)) {
      acted.add(open.id);
      const release = (): void => {
        if (!existsSync(files.releaseOf(open.id))) writeFileSync(files.releaseOf(open.id), "released\n");
      };
      if (options.sendMessage === undefined) {
        console.log(`[long-turn] minute ${minutes()}: no message door on this run; ${open.id} released as it is`);
      } else {
        const at = minutes();
        const sent = await retried(() => options.sendMessage!(sessionIdOf(run), open.text));
        console.log(`[long-turn] minute ${at}: the person's message sent during ${open.id}${sent.queued ? ", waiting in the queue" : ""}`);
        let restarted = false;
        if (options.restartServer !== undefined) {
          const restart = await options.restartServer({});
          restarted = true;
          report = { ...report, serverRestarts: [...(report.serverRestarts ?? []), { elapsedMinutes: minutes(), step: open.id, overlapped: restart.overlapped }] };
          console.log(`[long-turn] minute ${minutes()}: the server replaced while the message waits`);
        }
        report = {
          ...report,
          message: { step: open.id, sentAtMinutes: at, eventId: sent.eventId, queuedWhenSent: sent.queued, serverRestartedWhileQueued: restarted && sent.queued },
        };
      }
      release();
    }

    if (Date.now() >= nextSample) {
      nextSample += SAMPLE_MS;
      const { events } = await retried(() => clients.sessionQuery.listEvents({ sessionId: sessionIdOf(run), pageSize: 1000 }));
      const counts = options.counts?.();
      const sample: MinuteSample = {
        elapsedMinutes: minutes(),
        phase: RunPhase[phase],
        openStep: progress.open,
        stepsStarted: progress.started.length,
        stepsEnded: progress.ended.length,
        sessionEvents: events.length,
        modelCalls: counts?.modelCalls,
        compactions: counts?.compactions,
        error: run.status?.error ?? "",
      };
      report = { ...report, samples: [...report.samples, sample] };
      console.log(`[long-turn] minute ${sample.elapsedMinutes}: ${sample.phase}, open ${sample.openStep ?? "none"}, ${sample.stepsEnded}/${profile.steps.length} ended`);
      await writeLongTurnReport(out, report);
    }

    terminalSince = TERMINAL.has(phase) ? (terminalSince ?? Date.now()) : undefined;
    const stoppedByBudget = Date.now() - options.startedAtMs > profile.budgetMs;
    if (phase === RunPhase.RUN_COMPLETED || (terminalSince !== undefined && Date.now() - terminalSince >= TERMINAL_SETTLE_MS) || stoppedByBudget) {
      const log = await retried(() => listAllEvents(clients, sessionIdOf(run)));
      const seqs = log.map((e) => Number(e.seq));
      let moved: number[] = [];
      let followed: ReturnType<typeof followerCheckOf> | undefined;
      if (follower !== undefined) {
        const caughtUp = await follower.until(Math.max(0, ...seqs), FOLLOWER_CATCH_UP_MS);
        await follower.stop();
        moved = movedSeqsOf(
          follower.seqs.map((seq, i) => [seq, follower!.ids[i] ?? ""] as const),
          log.map((e) => [Number(e.seq), e.event.case === undefined ? "" : e.event.value.id] as const),
        );
        followed = followerCheckOf(follower.seqs, seqs, follower.endings, moved);
        console.log(`[long-turn] the follower holds ${follower.seqs.length} events${caughtUp ? "" : `, short of the log's last seq after ${FOLLOWER_CATCH_UP_MS / 1000} s`}`);
      }
      let told: Array<{ readonly reason: string; readonly runId: string }> | undefined;
      if (options.attention !== undefined) {
        await options.attention.until(sessionIdOf(run), ATTENTION_WAIT_MS);
        // A moment more, so a second attention for the turn would be counted too.
        await new Promise((r) => setTimeout(r, 5_000));
        told = options.attention.told.filter((a) => a.sessionId === sessionIdOf(run)).map((a) => ({ reason: a.reason, runId: a.runId }));
      }
      report = {
        ...report,
        end: {
          phase: RunPhase[phase],
          error: run.status?.error ?? "",
          elapsedMinutes: minutes(),
          atStep: progress.open ?? progress.ended.at(-1),
          stepsEnded: progress.ended.length,
          stoppedByBudget,
          transcript: transcriptCheckOf(seqs, moved),
          reply: turnOf(foldSession(log), runId)?.answer ?? "",
          compactedEvents: compactedEventsOf(log),
          ...(options.counts === undefined ? {} : options.counts()),
          ...(followed === undefined ? {} : { follower: followed }),
          ...(report.message === undefined ? {} : { message: messageCheckOf(log, report.message) }),
          ...(told === undefined ? {} : { attention: { told } }),
        },
      };
      await writeLongTurnReport(out, report);
      console.log(`[long-turn] ${report.end!.phase} at minute ${report.end!.elapsedMinutes}, at ${report.end!.atStep ?? "no step"}; ${join(out, "summary.md")}`);
      return report;
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
  } finally {
    // A drive that throws must not leave the follower retrying a stack that is torn down.
    await follower?.stop();
  }
}

/** A read of the run, retried while the front has no server to send it to (a restart's gap, a connection the outgoing server closed). */
async function retried<T>(read: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + READ_RETRY_MS;
  for (;;) {
    try {
      return await read();
    } catch (error) {
      if (ConnectError.from(error).code !== Code.Unavailable || Date.now() > deadline) throw error;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
}

/** Every event on the session's log, in order, page by page. */
async function listAllEvents(clients: ConformanceClients, sessionId: string) {
  const events = [];
  let pageToken = "";
  do {
    const page = await clients.sessionQuery.listEvents({ sessionId, pageSize: 1000, pageToken });
    events.push(...page.events);
    pageToken = page.nextPageToken;
  } while (pageToken !== "");
  return events;
}
/* v8 ignore stop */
