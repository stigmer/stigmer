// Runs one benchmark session, turn by turn, and reads every turn into a
// sample: the one path the bare cells, the working-agent cell and the quality
// tasks all take, so a turn means the same thing wherever it is measured.
// Domain: conformance benchmark (the live half's per-turn driver).
//
// Per turn, in order: the clock is read, and the execution is created, on the
// session's first turn with the one-call session bootstrap and on later turns
// with the session's id. The session's event stream is watched to the turn's
// end (`stream-watch.ts`). A turn that offered its edits for review has them
// kept whole once it ends (the benchmark measures the agent, not a
// reviewer). Then the status facts, the turn as the session's log folds it,
// the runner's timing lines (re-read from the log until present) and the
// Temporal history are joined by execution id, and each primary-thread tool
// call is placed on its round (`tool-call-facts.ts`).
//
// The next turn is sent only after the previous one has ended and its review
// is kept. That is a correctness rule, not a convenience: the platform
// accepts a follow-up while a review is still open, and a later undo would
// rewrite the files from the capture whatever the follow-up has written
// since (stigmer#1290). "Ended" is the server's word, not the stream's: the
// stream shows the turn's end before the run's own phase is terminal, and the
// server refuses a session's next turn while another is still working,
// waiting or paused (stigmer#2518). So once the watch has ended and every
// offered review is kept, the run is read until its phase is terminal
// (`awaitTerminal`, bounded by SETTLE_BUDGET_MS), and its status facts come
// from that settled read; the next turn's create follows it, because
// `measureSession` is sequential (stigmer#2536). A turn whose watch timed out
// or whose keep failed is already decided and is not waited on. End-to-end
// time stays the stream's end of the turn.
//
// Nothing is retried. A refused create, a provider fault or a stall is a fact
// about the harness under measurement and stays on the sample as its outcome,
// with `failure` naming the stage and the platform's own words, and the run
// goes on. A session whose first turn was never created has no session for
// the rest: they are recorded as failed at create, never skipped silently.
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ThinkingMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { RunConfigSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/invocation_pb";
import type { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import type { ConformanceClients } from "../harness/clients";
import { awaitTerminal, makeAgentExecution, sessionIdOf } from "../support/runs";
import type { AgentRefInit } from "../support/agents";
import { recordedSet, reviewChangeSet } from "../support/file-review";
import { uniqueName } from "../support/naming";
import type { BenchmarkHarness, BenchmarkSample, SampleFailure, SampleOutcome } from "./report";
import { finalReply, nullAxes, statusFacts } from "./status-facts";
import { streamSessionEvents, watchTurn } from "./stream-watch";
import { executeActivityNameFor, historyAxes, invokeWorkflowIdFor, showWorkflow } from "./temporal-history";
import { awaitTimingLines, axesFromTiming, type ExecutionTiming } from "./timing-lines";
import { todoCounts, toolCallFacts } from "./tool-call-facts";

/** How long one turn may take before the sample is a `timeout`: a live edit turn outlives the poll core's default. */
export const EXECUTION_BUDGET_MS = 10 * 60_000;

/**
 * How long a turn the stream showed ending may take to reach a terminal phase
 * on the server before the sample is a `timeout`: the gap is the runner's
 * last status writes, seconds at most, so a minute is a stall.
 */
export const SETTLE_BUDGET_MS = 60_000;

/** The reason every keep the benchmark decides carries, so a reader of the log knows who decided. */
export const BENCHMARK_APPROVAL_REASON = "harness benchmark: kept whole at review-ready";

/** What a session needs from the stack: the clients, the runner's tee'd log and Temporal. */
export interface SessionStack {
  clients: ConformanceClients;
  runnerLogFile: string;
  temporal: { hostPort: string; namespace: string };
}

export interface SessionPlan {
  org: string;
  agentRef: AgentRefInit;
  harness: BenchmarkHarness;
  /** The registry id pinned on every turn, or `null` for the harness's default. */
  modelRequested: string | null;
  /** "enabled" pins thinking on every turn; absent sends no mode (the platform default). */
  thinking?: "enabled";
  /** The session the first turn creates: its harness, subject and any workspace. */
  sessionSpec: MessageInitShape<typeof SessionSpecSchema>;
  /** One prompt per turn, sent in order in ONE session. */
  prompts: readonly string[];
  /** Prefix of each turn's operator log line and execution name. */
  label: string;
}

export interface SessionIo {
  /** Prose for the operator; stderr. */
  log: (line: string) => void;
}

/** One turn as measured, with the agent's final reply (what a grader reads). */
export interface MeasuredTurn {
  sample: BenchmarkSample;
  reply: string;
}

/** The session's turns in order, one each, as long as `plan.prompts`. */
export async function measureSession(stack: SessionStack, plan: SessionPlan, io: SessionIo): Promise<MeasuredTurn[]> {
  const turns: MeasuredTurn[] = [];
  let sessionId: string | undefined;
  for (const [index, prompt] of plan.prompts.entries()) {
    const label = `${plan.label}.${index + 1}`;
    if (index > 0 && sessionId === undefined) {
      turns.push({ sample: failedAtCreate(plan.modelRequested, "no session: the session's first turn was never created"), reply: "" });
      continue;
    }
    const turn = await measureTurn(stack, plan, { prompt, sessionId, label }, io);
    if (index === 0 && turn.sample.session_id !== "") sessionId = turn.sample.session_id;
    turns.push(turn);
  }
  return turns;
}

interface TurnRequest {
  prompt: string;
  /** Set for the later turns of a session; the first turn bootstraps it. */
  sessionId: string | undefined;
  label: string;
}

/* v8 ignore next -- @preserve: the live benchmark is a hand-run script no vitest config collects (vitest.unit.config.ts tests only its pure readers) */
async function measureTurn(stack: SessionStack, plan: SessionPlan, turn: TurnRequest, io: SessionIo): Promise<MeasuredTurn> {
  const { clients } = stack;
  const runConfig: MessageInitShape<typeof RunConfigSchema> | undefined =
    plan.modelRequested === null
      ? undefined
      : {
          modelName: plan.modelRequested,
          ...(plan.thinking === "enabled" ? { thinkingMode: ThinkingMode.ENABLED } : {}),
        };
  const startedAtMs = Date.now();

  let created: Run;
  try {
    created = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org: plan.org,
        name: uniqueName("bench-aex"),
        ...(turn.sessionId === undefined ? { agentRef: plan.agentRef, sessionSpec: plan.sessionSpec } : { sessionId: turn.sessionId }),
        message: turn.prompt,
        autoApproveAll: true,
        ...(runConfig !== undefined ? { runConfig } : {}),
      }),
    );
  } catch (error) {
    io.log(`${turn.label}: create refused: ${errorMessage(error)}`);
    return { sample: failedAtCreate(plan.modelRequested, errorMessage(error)), reply: "" };
  }
  const executionId = created.metadata!.id;
  const sessionId =
    turn.sessionId ??
    (sessionIdOf(created) || sessionIdOf(await clients.agentExecutionQuery.get({ value: executionId }).catch(() => created)));

  const watched = await watchTurn(streamSessionEvents(clients, sessionId), executionId, {
    startedAtMs,
    timeoutMs: EXECUTION_BUDGET_MS,
  });
  const reviewReadyMs = watched.review_ready_ms;
  const timedOut = watched.outcome !== "until";
  if (timedOut) {
    // The budget passed or the server closed early: stop what is still
    // running and record the attempt as what it was, never as a sample.
    try {
      await clients.sessionCommand.interrupt({ sessionId });
    } catch {
      // Already finished, or gone: the run we read next is what there is.
    }
    io.log(`${turn.label}: ${executionId} did not end within ${EXECUTION_BUDGET_MS}ms; recorded as timeout`);
  }

  let terminal = await clients.agentExecutionQuery.get({ value: executionId }).catch(() => created);
  let approvalFailure: string | undefined;
  if (!timedOut) {
    for (const offered of watched.turn?.fileReview ?? []) {
      if (!offered.undecided) continue;
      try {
        await reviewChangeSet(clients, sessionId, recordedSet(terminal, offered.changeSetId), "keep", {
          reason: BENCHMARK_APPROVAL_REASON,
        });
      } catch (error) {
        approvalFailure = `keep at review-ready: ${errorMessage(error)}`;
        io.log(`${turn.label}: ${executionId} ${approvalFailure}`);
      }
    }
  }
  let unsettled = false;
  if (!timedOut && approvalFailure === undefined) {
    try {
      terminal = await awaitTerminal(clients, executionId, { timeoutMs: SETTLE_BUDGET_MS, label: `${turn.label} settled` });
    } catch (error) {
      unsettled = true;
      io.log(`${turn.label}: ${executionId} ended on the stream but not on the server: ${errorMessage(error)}; recorded as timeout`);
    }
  }

  const facts = statusFacts(terminal);
  const timing: ExecutionTiming = await awaitTimingLines(stack.runnerLogFile, executionId);
  const history = await showWorkflow(stack.temporal.hostPort, stack.temporal.namespace, invokeWorkflowIdFor(executionId)).catch(
    () => ({ events: [] }),
  );
  const fromHistory = historyAxes(history, executeActivityNameFor(plan.harness));

  const outcome: SampleOutcome = approvalFailure !== undefined ? "failed" : timedOut || unsettled ? "timeout" : facts.outcome;
  const failure: SampleFailure | undefined =
    outcome === "completed"
      ? undefined
      : {
          stage: "execution",
          message:
            approvalFailure ??
            (timedOut
              ? `no terminal phase within ${EXECUTION_BUDGET_MS}ms`
              : unsettled
                ? `no terminal phase within ${SETTLE_BUDGET_MS}ms of the turn's end on the stream (settle budget)`
                : facts.error || `the execution ended ${outcome}`),
        };

  const sample: BenchmarkSample = {
    execution_id: executionId,
    session_id: facts.session_id || sessionId,
    model_requested: plan.modelRequested ?? "default",
    model_reported: facts.model_reported,
    measures: {
      ...nullAxes(),
      end_to_end_ms: watched.end_to_end_ms,
      client_first_visible_token_ms: watched.client_first_visible_token_ms,
      client_first_text_ms: watched.client_first_text_ms,
      review_ready_ms: reviewReadyMs,
      before_activity_ms: fromHistory.before_activity_ms,
      ensure_thread_ms: fromHistory.ensure_thread_ms,
      ...axesFromTiming(timing),
      attachment_count: facts.attachment_count,
      estimated_cost_micros: facts.estimated_cost_micros,
      tokens: facts.tokens,
    },
    cost_source: "runner-rate-card-estimate",
    server: facts.server,
    timing,
    tool_calls: toolCallFacts(watched.turn, timing.turn_phases),
    todos: todoCounts(watched.turn),
    outcome,
    ...(failure !== undefined ? { failure } : {}),
  };
  return { sample, reply: finalReply(watched.turn) };
}

/** An attempt that never became an execution: every axis unobserved, the refusal kept. */
export function failedAtCreate(modelRequested: string | null, message: string): BenchmarkSample {
  return {
    execution_id: "",
    session_id: "",
    model_requested: modelRequested ?? "default",
    model_reported: "",
    measures: {
      ...nullAxes(),
      estimated_cost_micros: 0,
      tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0 },
    },
    cost_source: "runner-rate-card-estimate",
    server: { created_at: "", started_at: "", completed_at: "" },
    timing: { turn_phases: null, execution_setup: null, turn_first_event: null },
    tool_calls: [],
    todos: { pending: 0, in_progress: 0, completed: 0, cancelled: 0 },
    outcome: "failed",
    failure: { stage: "create", message },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
