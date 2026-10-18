// Follows one long turn in real time, minute by minute, until it ends: the
// loop the real-clock run (against the mock) and the live run (against real
// providers) share.
// Domain: conformance long turn (the driver; hand-run only).
//
// Every second it reads the run and the step markers; when a held step
// (`kill`, `drain`) is open it asks its caller to end the runner, once, and
// releases the step. Every minute it records a sample and rewrites the
// report. It stops on COMPLETED, on any other terminal phase held for 20 s
// (a drained turn writes FAILED before the workflow recovers it), or when the
// profile's budget is spent, then reads the session's whole log back for the
// transcript check. Nothing here is retried: the turn's fate is the finding.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { ConformanceClients } from "../harness/clients";
import { sessionIdOf } from "../support/runs";
import { foldSession, turnOf } from "@stigmer/session-log";
import { stepProgressOf, type LongTurnProfile, type StepFiles } from "./profile";
import { transcriptCheckOf, writeLongTurnReport, type LongTurnReport, type MinuteSample } from "./report";

/* v8 ignore start -- @preserve: the real-clock and live runs are hand-run scripts no vitest config collects; the unit lane tests the pure readers and the report they feed */
const TERMINAL = new Set([RunPhase.RUN_COMPLETED, RunPhase.RUN_FAILED, RunPhase.RUN_CANCELLED, RunPhase.RUN_TERMINATED]);
const TERMINAL_SETTLE_MS = 20_000;
const TICK_MS = 1_000;
const SAMPLE_MS = 60_000;

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
  /** The mock's counts, when there is a mock. */
  readonly counts?: () => { readonly modelCalls: number; readonly compactions: number };
}

/** Follow the run to its end and return the final report (also written to `out`). */
export async function driveLongTurn(options: DriveOptions): Promise<LongTurnReport> {
  const { clients, runId, profile, files, out } = options;
  let report = options.report;
  const minutes = (): number => Math.round((Date.now() - options.startedAtMs) / 6_000) / 10;
  const acted = new Set<string>();
  let terminalSince: number | undefined;
  let nextSample = Date.now() + SAMPLE_MS;
  for (;;) {
    const run = await clients.agentExecutionQuery.get({ value: runId });
    const phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
    const progress = stepProgressOf(readFileSync(files.markers, "utf8"));

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

    if (Date.now() >= nextSample) {
      nextSample += SAMPLE_MS;
      const { events } = await clients.sessionQuery.listEvents({ sessionId: sessionIdOf(run), pageSize: 1000 });
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
      const log = await listAllEvents(clients, sessionIdOf(run));
      const seqs = log.map((e) => Number(e.seq));
      report = {
        ...report,
        end: {
          phase: RunPhase[phase],
          error: run.status?.error ?? "",
          elapsedMinutes: minutes(),
          atStep: progress.open ?? progress.ended.at(-1),
          stepsEnded: progress.ended.length,
          stoppedByBudget,
          transcript: transcriptCheckOf(seqs),
          reply: turnOf(foldSession(log), runId)?.answer ?? "",
        },
      };
      await writeLongTurnReport(out, report);
      console.log(`[long-turn] ${report.end!.phase} at minute ${report.end!.elapsedMinutes}, at ${report.end!.atStep ?? "no step"}; ${join(out, "summary.md")}`);
      return report;
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
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
