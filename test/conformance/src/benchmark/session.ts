// Runs one benchmark session, turn by turn, and reads every turn into a
// sample: the one path the bare cells, the working-agent cell and the quality
// tasks all take, so a turn means the same thing wherever it is measured.
// Domain: conformance benchmark (the live half's per-turn driver).
//
// Per turn, in order: the clock is read, and the execution is created, on the
// session's first turn with the one-call session bootstrap and on later turns
// with the session's id. The subscribe stream is watched to review or to the
// end. A turn that offers its edits for review is approved whole, at once
// (the benchmark measures the agent, not a reviewer), and the watch follows
// the reconcile to the terminal phase. Then the status facts, the runner's
// timing lines (re-read from the log until present) and the Temporal history
// are joined by execution id, and each root tool call is placed on its round
// (`tool-call-facts.ts`).
//
// The next turn is sent only after the previous one is terminal. That is a
// correctness rule, not a convenience: the platform accepts a follow-up while
// a review is still open, and the later decision rewrites the files from the
// capture whatever the follow-up has written since (stigmer#1290).
//
// Nothing is retried. A refused create, a provider fault or a stall is a fact
// about the harness under measurement and stays on the sample as its outcome,
// with `failure` naming the stage and the platform's own words, and the run
// goes on. A session whose first turn was never created has no session for
// the rest: they are recorded as failed at create, never skipped silently.
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { FileDecisionAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ExecutionConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import type { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import type { ConformanceClients } from "../harness/clients";
import { makeAgentExecution } from "../support/agentexecutions";
import { requireReviewSet, submitChangeSetDecision } from "../support/file-review";
import { uniqueName } from "../support/naming";
import type { BenchmarkHarness, BenchmarkSample, SampleFailure, SampleOutcome } from "./report";
import { finalReply, nullAxes, statusFacts } from "./status-facts";
import { subscribeTo, watchExecution, type WatchedExecution } from "./stream-watch";
import { executeActivityNameFor, historyAxes, invokeWorkflowIdFor, showWorkflow } from "./temporal-history";
import { awaitTimingLines, axesFromTiming, type ExecutionTiming } from "./timing-lines";
import { todoCounts, toolCallFacts } from "./tool-call-facts";

/** How long one turn may take before the sample is a `timeout`: a live edit turn outlives the poll core's default. */
export const EXECUTION_BUDGET_MS = 10 * 60_000;

/** The reason every approval the benchmark submits carries, so a reader of the ledger knows who decided. */
export const BENCHMARK_APPROVAL_REASON = "harness benchmark: approved whole at review-ready";

/** What a session needs from the stack: the clients, the runner's tee'd log and Temporal. */
export interface SessionStack {
  clients: ConformanceClients;
  runnerLogFile: string;
  temporal: { hostPort: string; namespace: string };
}

export interface SessionPlan {
  org: string;
  agentId: string;
  harness: BenchmarkHarness;
  /** The registry id pinned on every turn, or `null` for the harness's default. */
  modelRequested: string | null;
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

async function measureTurn(stack: SessionStack, plan: SessionPlan, turn: TurnRequest, io: SessionIo): Promise<MeasuredTurn> {
  const { clients } = stack;
  const executionConfig: MessageInitShape<typeof ExecutionConfigSchema> | undefined =
    plan.modelRequested === null ? undefined : { modelName: plan.modelRequested };
  const startedAtMs = Date.now();

  let created: AgentExecution;
  try {
    created = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org: plan.org,
        name: uniqueName("bench-aex"),
        ...(turn.sessionId === undefined ? { agentId: plan.agentId, sessionSpec: plan.sessionSpec } : { sessionId: turn.sessionId }),
        message: turn.prompt,
        autoApproveAll: true,
        ...(executionConfig !== undefined ? { executionConfig } : {}),
      }),
    );
  } catch (error) {
    io.log(`${turn.label}: create refused: ${errorMessage(error)}`);
    return { sample: failedAtCreate(plan.modelRequested, errorMessage(error)), reply: "" };
  }
  const executionId = created.metadata!.id;

  const watch = (stopAtReview: boolean, timeoutMs: number): Promise<WatchedExecution> =>
    watchExecution(subscribeTo(clients, executionId), { startedAtMs, timeoutMs, stopAtReview });

  let watched = await watch(true, EXECUTION_BUDGET_MS);
  const reviewReadyMs = watched.review_ready_ms;
  let approvalFailure: string | undefined;
  if (watched.awaiting_review && watched.final !== undefined) {
    try {
      await submitChangeSetDecision(clients, executionId, requireReviewSet(watched.final), FileDecisionAction.APPROVE, {
        reason: BENCHMARK_APPROVAL_REASON,
      });
      const spent = Date.now() - startedAtMs;
      const resumed = await watch(false, Math.max(EXECUTION_BUDGET_MS - spent, 1));
      // The first-token stamps belong to the first watch, which saw the turn
      // start; the second only follows the reconcile to the end.
      watched = {
        ...resumed,
        client_first_visible_token_ms: watched.client_first_visible_token_ms ?? resumed.client_first_visible_token_ms,
        client_first_text_ms: watched.client_first_text_ms ?? resumed.client_first_text_ms,
      };
    } catch (error) {
      approvalFailure = `approve at review-ready: ${errorMessage(error)}`;
      io.log(`${turn.label}: ${executionId} ${approvalFailure}`);
    }
  }

  let terminal = watched.final ?? created;
  let timedOut = false;
  if (watched.outcome !== "until" || watched.awaiting_review) {
    // The budget passed, the server closed early, or the approval never
    // landed: cancel what is still running and record the attempt as what
    // it was, never as a sample.
    timedOut = approvalFailure === undefined;
    try {
      terminal = await clients.agentExecutionCommand.cancel({ id: executionId, reason: "benchmark budget exceeded" });
    } catch {
      // Already terminal, or gone: the snapshot we hold is what there is.
    }
    if (timedOut) io.log(`${turn.label}: ${executionId} did not reach a terminal phase within ${EXECUTION_BUDGET_MS}ms; recorded as timeout`);
  }

  const facts = statusFacts(terminal);
  const timing: ExecutionTiming = await awaitTimingLines(stack.runnerLogFile, executionId);
  const history = await showWorkflow(stack.temporal.hostPort, stack.temporal.namespace, invokeWorkflowIdFor(executionId)).catch(
    () => ({ events: [] }),
  );
  const fromHistory = historyAxes(history, executeActivityNameFor(plan.harness));

  const outcome: SampleOutcome = approvalFailure !== undefined ? "failed" : timedOut ? "timeout" : facts.outcome;
  const failure: SampleFailure | undefined =
    outcome === "completed"
      ? undefined
      : {
          stage: "execution",
          message:
            approvalFailure ??
            (timedOut ? `no terminal phase within ${EXECUTION_BUDGET_MS}ms` : facts.error || `the execution ended ${outcome}`),
        };

  const sample: BenchmarkSample = {
    execution_id: executionId,
    session_id: facts.session_id || created.spec?.sessionId || "",
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
    tool_calls: toolCallFacts(terminal, timing.turn_phases),
    todos: todoCounts(terminal),
    outcome,
    ...(failure !== undefined ? { failure } : {}),
  };
  return { sample, reply: finalReply(terminal) };
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
