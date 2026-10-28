// Conformance suite for a run's trace: what a tracing tool receives from the
// runner, over the standard OpenTelemetry settings.
// Domain: agentic / run — read where an operator's collector sees it, the
// target's fake OTLP receiver (harness/fake-otlp-collector.ts), with the
// scripted model.
//
// The target boots its runner with OTEL_EXPORTER_OTLP_ENDPOINT pointed at the
// receiver, OTEL_EXPORTER_OTLP_PROTOCOL=http/json, a login header the
// receiver requires, and the conversation's text switched on
// (OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true).
//
// The contract under test:
//   - a run arrives as ONE trace whose id is the first 16 bytes of SHA-256
//     over the run id, rooted at `invoke_agent <agent slug>` (no parent),
//     carrying the run, its conversation, its kind and the request's text;
//   - each model call is a `chat` span under it with the provider, the model
//     and the tokens, sent by the agent host (its resource names the
//     process), which holds no login: those spans reached a receiver that
//     refuses any export without the login, so the runner forwarded them;
//   - a hand-off is an `execute_tool task` span, the subagent's invocation an
//     `invoke_agent <subagent>` span under it, and the subagent's own model
//     and tool calls nest under that: an MCP server's tool is an `extension`
//     tool with `mcp.method.name=tools/call`;
//   - no export was refused.
// The protobuf and gRPC forwards, the content rules and the bounds are the
// runner's unit suites; this suite proves the whole path on a real engine.
import { createHash } from "node:crypto";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import type { ConformanceClients } from "../harness/clients";
import type { FakeOtlpCollector, ReceivedSpan } from "../harness/fake-otlp-collector";
import { FixtureTracker } from "../harness/fixtures";
import { ECHO_TOOL_NAME, type McpToolFixture } from "../harness/mcp-server";
import { agentRefOf, createSubagents, makeAgent, subagentSlugsOf } from "../support/agents";
import { uniqueName } from "../support/naming";
import {
  awaitTerminal,
  makeAgentExecution,
  pushFixturePlugin,
  requireLlmProxy,
  requireMcpFixture,
  sessionIdOf,
} from "../support/runs";
import { createTarget, type TargetProfile } from "../targets";

// The built-in delegation tool the native engine binds when a turn has subagents.
const TASK_TOOL_NAME = "task";
const REQUEST = "Look the order up with the researcher and tell me what it found.";
const SUBAGENT_ANSWER = "The order shipped yesterday.";
// How long a finished run's spans may take to reach the receiver: the
// runner's batch leaves every 200 ms (runner-process.ts), the host's goes
// through the runner's local proxy first.
const TRACE_DEADLINE_MS = 15_000;

const collectionTarget = createTarget();

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
let mcp: McpToolFixture;
let collector: FakeOtlpCollector;
const fixtures = new FixtureTracker();

/** The trace id a run's spans carry: the first 16 bytes of SHA-256 over the run id. */
function traceIdOfRun(runId: string): string {
  return createHash("sha256").update(runId, "utf8").digest("hex").slice(0, 32);
}

/** Wait until the run's trace holds every span `ready` asks for. */
async function traceOf(runId: string, ready: (spans: readonly ReceivedSpan[]) => boolean): Promise<readonly ReceivedSpan[]> {
  const deadline = Date.now() + TRACE_DEADLINE_MS;
  for (;;) {
    const spans = collector.trace(traceIdOfRun(runId));
    if (ready(spans)) return spans;
    if (Date.now() > deadline) {
      throw new Error(`run ${runId}'s trace is incomplete after ${TRACE_DEADLINE_MS} ms: ${spans.map((span) => span.name).join(", ") || "(no spans)"}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
}

/** The one span named `name`, failing with the trace's names when there is not exactly one. */
function only(spans: readonly ReceivedSpan[], name: string): ReceivedSpan {
  const found = spans.filter((span) => span.name === name);
  expect(found, `exactly one '${name}' among ${spans.map((span) => span.name).join(", ")}`).toHaveLength(1);
  return found[0]!;
}

/** The spans whose parent is `parent`. */
function childrenOf(spans: readonly ReceivedSpan[], parent: ReceivedSpan): readonly ReceivedSpan[] {
  return spans.filter((span) => span.parentSpanId === parent.spanId);
}

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
  mcp = requireMcpFixture(target);
  collector = target.traceCollector!();
});

afterEach(async () => {
  // A run that ended before it reached the model would take the next arm's
  // script; wait, bounded, for every scripted turn to be claimed.
  const claimDeadline = Date.now() + 15_000;
  while (mock.remaining() > 0 && Date.now() < claimDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  mock.reset();
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

describe.skipIf(collectionTarget.traceCollector === undefined)("Run — a tracing tool receives the run as one trace", () => {
  it("a run with a hand-off and an MCP tool call arrives as one trace rooted at invoke_agent, the engine's spans through the runner", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await pushFixturePlugin(clients, mcp, fixtures, { org, name: uniqueName("trace-tools"), tools: [ECHO_TOOL_NAME] });
    const saved = await createSubagents(clients, fixtures, org, [
      {
        name: uniqueName("researcher"),
        instructions: "You look things up with your tools and report in one sentence.",
        harness: Harness.STIGMER,
        plugins: [plugin.metadata!.slug],
      },
    ]);
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("tracer"), harness: Harness.STIGMER, subagents: subagentSlugsOf(saved) }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    const subagentSlug = saved[0]!.metadata!.slug;

    // Parent hands off; the subagent calls the MCP echo, then answers; the parent answers.
    mock.enqueue(
      anthropicToolUse("toolu_trace_task", TASK_TOOL_NAME, {
        description: "Look the order up",
        prompt: "Look the order up and report back in one sentence.",
        subagent_type: subagentSlug,
      }),
    );
    mock.enqueue(anthropicToolUse("call_trace_echo", ECHO_TOOL_NAME, { text: "order 42" }));
    mock.enqueue(anthropicText(SUBAGENT_ANSWER));
    mock.enqueue(anthropicText(`The researcher says: ${SUBAGENT_ANSWER}`));

    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-trace"), agentRef: agentRefOf(agent), message: REQUEST, autoApproveAll: true }),
    );
    const runId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: runId }));
    const final = await awaitTerminal(clients, runId);
    expect(RunPhase[final.status?.phase ?? 0], `run ${runId} completes (error: ${final.status?.error ?? ""})`).toBe(
      RunPhase[RunPhase.RUN_COMPLETED],
    );

    const rootName = `invoke_agent ${agent.metadata!.slug}`;
    const subagentName = `invoke_agent ${subagentSlug}`;
    const spans = await traceOf(runId, (trace) => {
      const names = trace.map((span) => span.name);
      return (
        names.includes(rootName) &&
        names.includes(subagentName) &&
        names.includes(`execute_tool ${ECHO_TOOL_NAME}`) &&
        names.filter((name) => name.startsWith("chat ")).length >= 4
      );
    });

    // The root: one per turn, no parent, the run's facts and the request's text.
    const root = only(spans, rootName);
    expect(root.parentSpanId, "the run's span is the trace's root").toBe("");
    expect(root.attributes["gen_ai.operation.name"]).toBe("invoke_agent");
    expect(root.attributes["gen_ai.agent.name"]).toBe(agent.metadata!.slug);
    expect(root.attributes["stigmer.run.id"]).toBe(runId);
    expect(root.attributes["stigmer.run.kind"]).toBe("conversation");
    expect(root.attributes["gen_ai.conversation.id"]).toBe(sessionIdOf(final));
    expect(String(root.attributes["gen_ai.input.messages"]), "with content on, the request's text").toContain(REQUEST);
    expect(String(root.attributes["gen_ai.output.messages"]), "and the answer").toContain(SUBAGENT_ANSWER);

    // The parent's model calls and its hand-off sit under the root.
    const underRoot = childrenOf(spans, root);
    const parentChats = underRoot.filter((span) => span.name.startsWith("chat "));
    expect(parentChats, "the parent's two model calls").toHaveLength(2);
    for (const chat of parentChats) {
      expect(chat.process, "a model call is the agent host's span").toBe("agent-host");
      expect(chat.attributes["gen_ai.operation.name"]).toBe("chat");
      expect(chat.attributes["gen_ai.provider.name"]).toBe("anthropic");
      expect(Number(chat.attributes["gen_ai.usage.output_tokens"] ?? 0), "tokens ride the model call").toBeGreaterThan(0);
    }
    const task = only(underRoot, `execute_tool ${TASK_TOOL_NAME}`);
    expect(task.attributes["gen_ai.tool.call.id"]).toBe("toolu_trace_task");

    // The subagent nests under its hand-off, and its own calls under it.
    const subagent = only(childrenOf(spans, task), subagentName);
    const underSubagent = childrenOf(spans, subagent);
    expect(underSubagent.filter((span) => span.name.startsWith("chat ")), "the subagent's two model calls").toHaveLength(2);
    const echo = only(underSubagent, `execute_tool ${ECHO_TOOL_NAME}`);
    expect(echo.attributes["gen_ai.tool.type"], "an MCP server's tool").toBe("extension");
    expect(echo.attributes["mcp.method.name"]).toBe("tools/call");
    expect(String(echo.attributes["gen_ai.tool.call.arguments"])).toContain("order 42");

    expect(collector.refused(), "every export carried the login: the host's went through the runner").toBe(0);
  });
});
