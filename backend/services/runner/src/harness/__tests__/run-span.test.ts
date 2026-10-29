/**
 * A turn's `invoke_agent {agent}` span (`run-span.ts`), read back from a
 * real tracer provider that generates trace ids the way the runner's does
 * (`run-trace-id.ts`).
 *
 * Pinned: the span is a root even under an active activity span, linked to
 * it; inside a run's execution context its trace id is the run's, so two
 * turns of one run share a trace; it is named after the session's agent,
 * the assistant or the judge; `stigmer.run.kind` comes from the server's
 * labels; who asked and the turn's text appear only with content on, for
 * every run kind; a failed run marks the span, a completed one does not;
 * with no tracer provider, nothing is recorded and nothing breaks.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SpanStatusCode, context, propagation, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { RunSchema, RunStatusSchema, type Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema, type Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";

import { TELEMETRY_OFF, adoptTelemetrySettings, resetTelemetrySettingsForTests } from "../../otel-export.js";
import { RunTraceIdGenerator, traceIdOfRun } from "../../run-trace-id.js";
import type { ResolvedBlueprint } from "../../shared/blueprint-resolver.js";
import { runWithExecutionContext } from "../../shared/execution-context.js";
import { EVAL_RUN_LABEL, ROUTINE_ID_LABEL, agentNameOf, runKindOf, withRunSpan, type RunFacts } from "../run-span.js";

const exporter = new InMemorySpanExporter();
let provider: NodeTracerProvider;

beforeAll(() => {
  provider = new NodeTracerProvider({ idGenerator: new RunTraceIdGenerator(), spanProcessors: [new SimpleSpanProcessor(exporter)] });
  provider.register();
});

afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
  propagation.disable();
});

afterEach(() => {
  exporter.reset();
  resetTelemetrySettingsForTests();
});

const RUN_ID = "run_01m3zkdb7wxbe2gx0ezmf8fmaq";

function run(labels: Record<string, string> = {}): Run {
  return create(RunSchema, {
    metadata: { id: RUN_ID, labels },
    spec: { message: "summarize the ticket" },
    status: { audit: { specAudit: { createdBy: { id: "person@example.com" } } } },
  });
}

function session(agentSlug?: string): Session {
  return create(SessionSchema, {
    metadata: { id: "ses_1", org: "acme" },
    spec: agentSlug ? { agentRef: { org: "acme", slug: agentSlug } } : {},
  });
}

function blueprint(s: Session, agent?: { id: string; versionHash: string }): ResolvedBlueprint {
  return {
    agent: agent ? { ...agent, spec: create(AgentSpecSchema, {}) } : undefined,
    session: s,
    sessionSpec: s.spec!,
    instructions: "",
    pluginAgents: [],
    subagents: [],
    plugins: [],
    mergedSkillRefs: [],
  };
}

function facts(execution: Run, s: Session, agent?: { id: string; versionHash: string }): RunFacts {
  return { execution, session: s, sessionId: "ses_1", blueprint: blueprint(s, agent) };
}

const TURN = { executionId: RUN_ID, turnSeq: 0, harness: "stigmer" };

function onlySpan(): ReadableSpan {
  const finished = exporter.getFinishedSpans().filter((span) => span.name.startsWith("invoke_agent"));
  expect(finished).toHaveLength(1);
  return finished[0]!;
}

describe("withRunSpan", () => {
  it("starts a root span with the run's trace id, linked to the active activity span", async () => {
    const tracer = trace.getTracer("test");
    let activitySpanId = "";
    let activityTraceId = "";
    await tracer.startActiveSpan("RunActivity:ExecuteDeepAgent", async (activity) => {
      activitySpanId = activity.spanContext().spanId;
      activityTraceId = activity.spanContext().traceId;
      await runWithExecutionContext(RUN_ID, () => withRunSpan(TURN, async () => undefined));
      activity.end();
    });

    const span = onlySpan();
    expect(span.parentSpanContext).toBeUndefined();
    expect(span.spanContext().traceId).toBe(traceIdOfRun(RUN_ID));
    expect(span.spanContext().traceId).not.toBe(activityTraceId);
    expect(span.links.map((link) => link.context.spanId)).toEqual([activitySpanId]);
    expect(span.attributes).toMatchObject({
      "gen_ai.operation.name": "invoke_agent",
      "stigmer.run.id": RUN_ID,
      "stigmer.run.turn": 0,
      "stigmer.harness": "stigmer",
    });
  });

  it("keeps two turns of one run in one trace, each a root", async () => {
    await runWithExecutionContext(RUN_ID, () => withRunSpan(TURN, async () => undefined));
    await runWithExecutionContext(RUN_ID, () => withRunSpan({ ...TURN, turnSeq: 1 }, async () => undefined));

    const turns = exporter.getFinishedSpans();
    expect(turns).toHaveLength(2);
    expect(new Set(turns.map((span) => span.spanContext().traceId))).toEqual(new Set([traceIdOfRun(RUN_ID)]));
    expect(turns.every((span) => span.parentSpanContext === undefined)).toBe(true);
    expect(turns.map((span) => span.attributes["stigmer.run.turn"])).toEqual([0, 1]);
  });

  it("runs the turn in the span's context, so what it starts nests under it", async () => {
    await runWithExecutionContext(RUN_ID, () =>
      withRunSpan(TURN, async () => {
        trace.getTracer("test").startSpan("stigmer rpc").end();
      }),
    );
    const root = onlySpan();
    const rpc = exporter.getFinishedSpans().find((span) => span.name === "stigmer rpc")!;
    expect(rpc.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
  });

  it("names the span after the session's agent and stamps the run's facts", async () => {
    await withRunSpan(TURN, async (span) => {
      span.identify(facts(run(), session("support-bot"), { id: "agt_1", versionHash: "v123" }));
      span.model("claude-sonnet-4.6");
    });

    const span = onlySpan();
    expect(span.name).toBe("invoke_agent support-bot");
    expect(span.attributes).toMatchObject({
      "gen_ai.agent.name": "support-bot",
      "gen_ai.agent.id": "agt_1",
      "gen_ai.agent.version": "v123",
      "gen_ai.conversation.id": "ses_1",
      "gen_ai.request.model": "claude-sonnet-4.6",
      "stigmer.organization": "acme",
      "stigmer.run.kind": "conversation",
    });
  });

  it("names the assistant and the judge, and sets no empty agent id or version", async () => {
    await withRunSpan(TURN, async (span) => span.identify(facts(run(), session())));
    const assistant = onlySpan();
    expect(assistant.name).toBe("invoke_agent assistant");
    expect(assistant.attributes["gen_ai.agent.id"]).toBeUndefined();
    expect(assistant.attributes["gen_ai.agent.version"]).toBeUndefined();

    exporter.reset();
    await withRunSpan(TURN, async (span) =>
      span.identify(facts(run({ "stigmer.ai/grades-run": "run_graded" }), session("support-bot"), { id: "", versionHash: "" })),
    );
    const judge = onlySpan();
    expect(judge.name).toBe("invoke_agent judge");
    expect(judge.attributes["stigmer.run.kind"]).toBe("judge");
    expect(judge.attributes["gen_ai.agent.id"]).toBeUndefined();
  });

  it.each([
    ["conversation", {}],
    ["routine", { [ROUTINE_ID_LABEL]: "rtn_1" }],
    ["judge", { "stigmer.ai/grades-run": "run_x" }],
    ["eval-try", { [EVAL_RUN_LABEL]: "evr_1" }],
  ] as const)("carries no text and no asker with content off, for a %s run", async (kind, labels) => {
    await withRunSpan(TURN, async (span) => {
      span.identify(facts(run(labels), session("support-bot")));
      span.answer("the summary");
    });
    const attributes = onlySpan().attributes;
    expect(attributes["stigmer.run.kind"]).toBe(kind);
    expect(attributes["user.id"]).toBeUndefined();
    expect(attributes["gen_ai.input.messages"]).toBeUndefined();
    expect(attributes["gen_ai.output.messages"]).toBeUndefined();
  });

  it("with content on, carries who asked, the request and the answer", async () => {
    adoptTelemetrySettings({ ...TELEMETRY_OFF, content: true });
    await withRunSpan(TURN, async (span) => {
      span.identify(facts(run(), session("support-bot")));
      span.answer("the summary");
    });
    const attributes = onlySpan().attributes;
    expect(attributes["user.id"]).toBe("person@example.com");
    expect(JSON.parse(String(attributes["gen_ai.input.messages"]))).toEqual([
      { role: "user", parts: [{ type: "text", content: "summarize the ticket" }] },
    ]);
    expect(JSON.parse(String(attributes["gen_ai.output.messages"]))).toEqual([
      { role: "assistant", parts: [{ type: "text", content: "the summary" }], finish_reason: "stop" },
    ]);
  });

  it("marks a failed run and leaves a completed one unset; the failure's text only with content on", async () => {
    await withRunSpan(TURN, async (span) => span.settle(create(RunStatusSchema, { phase: RunPhase.RUN_FAILED, error: "the model refused" })));
    const failed = onlySpan();
    expect(failed.status, "an error can quote the conversation: no text with content off").toEqual({ code: SpanStatusCode.ERROR });
    expect(failed.attributes["error.type"]).toBe("RUN_FAILED");

    exporter.reset();
    adoptTelemetrySettings({ ...TELEMETRY_OFF, content: true });
    await withRunSpan(TURN, async (span) => span.settle(create(RunStatusSchema, { phase: RunPhase.RUN_FAILED, error: "the model refused" })));
    expect(onlySpan().status).toEqual({ code: SpanStatusCode.ERROR, message: "the model refused" });
    adoptTelemetrySettings(TELEMETRY_OFF);

    exporter.reset();
    await withRunSpan(TURN, async (span) => span.settle(create(RunStatusSchema, { phase: RunPhase.RUN_COMPLETED })));
    const completed = onlySpan();
    expect(completed.status.code).toBe(SpanStatusCode.UNSET);
    expect(completed.attributes["error.type"]).toBeUndefined();
  });

  it("records nothing and breaks nothing with no tracer provider", async () => {
    trace.disable();
    try {
      const result = await runWithExecutionContext(RUN_ID, () =>
        withRunSpan(TURN, async (span) => {
          span.identify(facts(run(), session("support-bot")));
          span.model("m");
          span.answer("a");
          span.settle(create(RunStatusSchema, { phase: RunPhase.RUN_FAILED }));
          return "settled";
        }),
      );
      expect(result).toBe("settled");
    } finally {
      provider.register();
    }
    expect(exporter.getFinishedSpans()).toEqual([]);
  });
});

describe("runKindOf and agentNameOf", () => {
  it("prefers the judge's label over an eval's, as a graded eval check carries both", () => {
    expect(runKindOf({ "stigmer.ai/grades-run": "r", [EVAL_RUN_LABEL]: "e" })).toBe("judge");
    expect(runKindOf(undefined)).toBe("conversation");
    expect(agentNameOf(run(), session())).toBe("assistant");
  });
});
