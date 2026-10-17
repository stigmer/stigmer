/**
 * A turn's `invoke_agent {agent}` span: what a tracing tool lists as the
 * run, for every harness alike, started by the turn runtime
 * (`run-turn.ts`) around the whole activity.
 *
 * Root, never a child. The run workflow lives in the server, which has no
 * tracer, so the runner's Temporal activity span would otherwise be the
 * trace's root and every run would be listed as `RunActivity:...`. Each
 * turn's span is a root instead, named after the agent, with a link to the
 * activity span when one is active, so the operational spans stay one click
 * away. Started inside the run's execution context, it takes the run's
 * trace id (`run-trace-id.ts`): a run that waits for an approval and
 * resumes stays one trace, each turn a root span in it.
 *
 * The whole turn runs in its context, so the runtime's own RPCs carry it
 * to the server (`client/stigmer-client.ts` injects the active context),
 * the agent's hooks join it, and the agent host runs the engine under it
 * (`shared/trace-context.ts`), where the engines' `chat` and
 * `execute_tool` spans nest (`middleware/otel-spans.ts`,
 * `activities/execute-cursor/run-telemetry.ts`).
 *
 * Its facts arrive as resolution learns them: the run and its session
 * ({@link RunSpan.identify}, which also names the span), the model, the
 * answer, and how the turn ended ({@link RunSpan.settle}, from the status
 * the terminal table wrote). No usage is set here: the `chat` spans carry
 * it, and a tool that sums both would count it twice. With content on
 * (`otel-export.ts`), the turn's request and answer, and who asked
 * (`user.id`, which can be an email, so never without content).
 *
 * `stigmer.run.kind` tells what started the run, read from the labels the
 * server sets: a judge's grade, an eval run's try, a routine's run, or a
 * conversation, so a tool can filter each.
 */

import { SpanKind, context, trace, type Span } from "@opentelemetry/api";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

import {
  GEN_AI_AGENT_ID,
  GEN_AI_AGENT_NAME,
  GEN_AI_AGENT_VERSION,
  GEN_AI_CONVERSATION_ID,
  GEN_AI_INPUT_MESSAGES,
  GEN_AI_OPERATION_NAME,
  GEN_AI_OUTPUT_MESSAGES,
  GEN_AI_REQUEST_MODEL,
  OP_INVOKE_AGENT,
  STIGMER_HARNESS,
  STIGMER_ORGANIZATION,
  STIGMER_RUN_ID,
  STIGMER_RUN_KIND,
  STIGMER_RUN_TURN,
  TRACER_NAME,
  USER_ID,
  type RunKind,
} from "../gen-ai-conventions.js";
import { telemetrySettings } from "../otel-export.js";
import type { ResolvedBlueprint } from "../shared/blueprint-resolver.js";
import { GRADES_RUN_LABEL } from "../shared/builtin-judge.js";
import { markFailed, turnContent } from "../shared/telemetry-content.js";

/** The label the server sets on an eval run's try (the server's `domain/eval-run/constants.ts`). Wire contract. */
export const EVAL_RUN_LABEL = "stigmer.ai/eval-run";
/** The label the server sets on a routine's run (the server's `domain/routine/labels.ts`). Wire contract. */
export const ROUTINE_ID_LABEL = "stigmer.ai/routine-id";

/** The agent name of a turn that runs no saved agent. */
export const ASSISTANT_AGENT_NAME = "assistant";
/** The agent name of a judge's grade. */
export const JUDGE_AGENT_NAME = "judge";

/** What resolution knows once it has the run and its session. */
export interface RunFacts {
  readonly execution: Run;
  readonly session: Session;
  readonly sessionId: string;
  readonly blueprint: ResolvedBlueprint;
}

/** The turn's span, as the runtime feeds it. Every method is a no-op when tracing is off. */
export interface RunSpan {
  /** Name and stamp the span: the agent, the conversation, the organization, what started the run. */
  identify(facts: RunFacts): void;
  /** The model the turn asked for. */
  model(requested: string): void;
  /** The turn's final answer, the span's output when content is on. */
  answer(text: string | undefined): void;
  /** How the turn ended, from the status the terminal table wrote. */
  settle(status: RunStatus): void;
}

/** What started a run, from the labels the server sets on it. */
export function runKindOf(labels: Readonly<Record<string, string>> | undefined): RunKind {
  if ((labels?.[GRADES_RUN_LABEL] ?? "") !== "") return "judge";
  if ((labels?.[EVAL_RUN_LABEL] ?? "") !== "") return "eval-try";
  if ((labels?.[ROUTINE_ID_LABEL] ?? "") !== "") return "routine";
  return "conversation";
}

/** The agent a run's span is named after: the session's agent by its slug, else the assistant, the judge for a grade. */
export function agentNameOf(execution: Run, session: Session): string {
  if (runKindOf(execution.metadata?.labels) === "judge") return JUDGE_AGENT_NAME;
  return session.spec?.agentRef?.slug || ASSISTANT_AGENT_NAME;
}

/** The phases a turn that ended badly settles in, which mark the span as an error. */
const FAILED_PHASES: ReadonlySet<RunPhase> = new Set([RunPhase.RUN_FAILED]);

class RecordingRunSpan implements RunSpan {
  private readonly content = telemetrySettings().content;

  constructor(private readonly span: Span) {}

  identify({ execution, session, sessionId, blueprint }: RunFacts): void {
    const name = agentNameOf(execution, session);
    this.span.updateName(`${OP_INVOKE_AGENT} ${name}`);
    this.span.setAttributes({
      [GEN_AI_AGENT_NAME]: name,
      [GEN_AI_CONVERSATION_ID]: sessionId,
      [STIGMER_ORGANIZATION]: session.metadata?.org ?? "",
      [STIGMER_RUN_KIND]: runKindOf(execution.metadata?.labels),
      ...(blueprint.agent?.id ? { [GEN_AI_AGENT_ID]: blueprint.agent.id } : {}),
      ...(blueprint.agent?.versionHash ? { [GEN_AI_AGENT_VERSION]: blueprint.agent.versionHash } : {}),
    });
    if (!this.content) return;
    const asker = execution.status?.audit?.specAudit?.createdBy?.id;
    if (asker) this.span.setAttribute(USER_ID, asker);
    this.span.setAttribute(GEN_AI_INPUT_MESSAGES, turnContent(execution.spec?.message ?? "", undefined).input);
  }

  model(requested: string): void {
    if (requested) this.span.setAttribute(GEN_AI_REQUEST_MODEL, requested);
  }

  answer(text: string | undefined): void {
    if (!this.content || text === undefined) return;
    const { output } = turnContent("", text);
    if (output !== undefined) this.span.setAttribute(GEN_AI_OUTPUT_MESSAGES, output);
  }

  settle(status: RunStatus): void {
    if (!FAILED_PHASES.has(status.phase)) return;
    markFailed(this.span, RunPhase[status.phase] ?? "RUN_FAILED", { message: status.error }, this.content);
  }
}

const NO_SPAN: RunSpan = {
  identify() {},
  model() {},
  answer() {},
  settle() {},
};

/**
 * Run one turn inside its `invoke_agent` span. Call inside the run's
 * execution context (`shared/execution-context.ts`), so the span takes the
 * run's trace id.
 */
export async function withRunSpan<T>(
  turn: { readonly executionId: string; readonly turnSeq: number; readonly harness: string },
  body: (span: RunSpan) => Promise<T>,
): Promise<T> {
  const activity = trace.getSpan(context.active());
  const span = trace.getTracer(TRACER_NAME).startSpan(OP_INVOKE_AGENT, {
    root: true,
    kind: SpanKind.INTERNAL,
    ...(activity?.isRecording() ? { links: [{ context: activity.spanContext() }] } : {}),
    attributes: {
      [GEN_AI_OPERATION_NAME]: OP_INVOKE_AGENT,
      [STIGMER_RUN_ID]: turn.executionId,
      [STIGMER_RUN_TURN]: turn.turnSeq,
      [STIGMER_HARNESS]: turn.harness,
    },
  });
  const runSpan = span.isRecording() ? new RecordingRunSpan(span) : NO_SPAN;
  try {
    return await context.with(trace.setSpan(context.active(), span), () => body(runSpan));
  } finally {
    span.end();
  }
}
