// Smoke: the live harness benchmark's five readers still read what the
// engine writes today. One scripted bare-agent turn on the mock and one
// graded agent call, then each reader returns a value for it — the runner's
// `turn_phases` and `execution_setup` lines by execution id in the tee'd log,
// the execute activity's start and the EnsureThread hop in the Temporal
// history, the first visible token and the terminal phase on the subscribe
// stream, the usage aggregate on the terminal status, and the judge's grade
// with the child's id on the graded workflow.
// Domain: conformance harness (the benchmark instrument's wiring).
//
// Why a smoke and not a facet: nothing here is a contract of the platform; it
// is the instrument's dependence on the runner's current field names, ids and
// task outputs, which the live benchmark (`make benchmark-harnesses`, an
// experiment that spends real money) would otherwise discover at the owner's
// run. No NUMBER is asserted — a scripted model makes every timing meaningless
// — only presence and shape, so the live half stays an experiment and this
// stays a test.
//
// Gated on the two accessors the readers need: the target's Temporal address
// (`engineCoordinates`, absent on the cloud targets whose runner discovers
// Temporal through the control plane) and the runner's tee'd log
// (`runnerLogFile`, present only on targets that spawn the runner). Where
// either is missing the file reports SKIPPED, the IPC smoke's shape.
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionPhase as WorkflowPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { verdictOf } from "../benchmark/quality";
import { statusFacts, visibleRows } from "../benchmark/status-facts";
import { subscribeTo, watchExecution } from "../benchmark/stream-watch";
import { executeActivityNameFor, historyAxes, invokeWorkflowIdFor, showWorkflow } from "../benchmark/temporal-history";
import { awaitTimingLines, axesFromTiming } from "../benchmark/timing-lines";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText, anthropicToolUse } from "../harness/mock-llm";
import { TEMPORAL_DEV_NAMESPACE } from "../harness/temporal";
import { BARE_AGENT_INSTRUCTIONS, makeAgent } from "../support/agents";
import { makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { awaitTerminal as awaitWorkflowTerminal, makeWorkflowExecution } from "../support/workflowexecutions";
import { EVAL_EXTRACT_TOOL_NAME, LLM_TASK_MODEL, makeGradedAgentCallWorkflow } from "../support/workflows";
import { createTarget, type TargetProfile } from "../targets";

const probe = createTarget();
const hasReaders = probe.engineCoordinates !== undefined && probe.runnerLogFile !== undefined;

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

describe.skipIf(!hasReaders)("Benchmark readers — the instrument reads what the engine writes", () => {
  beforeAll(async () => {
    target = createTarget();
    await target.setup();
    clients = target.clients();
    mock = requireLlmProxy(target);
  });

  afterEach(async () => {
    await fixtures.cleanup();
    mock.reset();
  });

  afterAll(async () => {
    await target?.teardown();
  });

  it("the stream watch, the status facts, the timing lines and the history each read one bare turn", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-bench"), instructions: BARE_AGENT_INSTRUCTIONS }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    mock.enqueue(anthropicText("Hello."));
    const startedAtMs = Date.now();
    const created = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-bench"),
        agentId: agent.metadata!.id,
        sessionSpec: { subject: "benchmark readers smoke" },
        message: "Say hello.",
        autoApproveAll: true,
      }),
    );
    const executionId = created.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const watched = await watchExecution(subscribeTo(clients, executionId), { startedAtMs, timeoutMs: 60_000 });
    expect(watched.outcome, "the subscribe stream reached the terminal phase").toBe("until");
    expect(watched.final?.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(watched.client_first_visible_token_ms, "the watcher saw the assistant's text arrive").not.toBeNull();
    expect(watched.end_to_end_ms, "the watcher stamped the terminal message").not.toBeNull();
    expect(visibleRows(watched.final!).text, "the terminal snapshot carries the AI row").toBe(true);

    const facts = statusFacts(watched.final!);
    expect(facts.execution_id).toBe(executionId);
    expect(facts.outcome).toBe("completed");
    expect(facts.tokens.total, "the runner's usage aggregate reached the status").toBeGreaterThan(0);
    expect(facts.model_reported, "the priced model is on the aggregate").not.toBe("");

    const timing = await awaitTimingLines(target.runnerLogFile!(), executionId);
    expect(timing.turn_phases, "the runtime wrote a turn_phases line for this execution").not.toBeNull();
    expect(timing.execution_setup, "the adapter wrote an execution_setup line for this execution").not.toBeNull();
    expect(timing.turn_phases?.context["harness"], "the line carries the runtime's harness label").toBe("deep-agent");
    const axes = axesFromTiming(timing);
    expect(axes.rounds, "the fold counted the scripted model round").toBe(1);
    expect(axes.runner_first_visible_token_ms, "the fold saw the first visible token").not.toBeNull();
    expect(axes.execution_setup_ms).not.toBeNull();

    const coordinates = target.engineCoordinates!();
    const history = await showWorkflow(coordinates.temporalHostPort, TEMPORAL_DEV_NAMESPACE, invokeWorkflowIdFor(executionId));
    const before = historyAxes(history, executeActivityNameFor("deep-agent"));
    expect(before.before_activity_ms, "the history shows the execute activity starting").not.toBeNull();
    expect(before.ensure_thread_ms, "the history shows the EnsureThread hop completing").not.toBeNull();
  });

  it("the graded agent call yields the judge's score, the judge's model and the child's id", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-graded"), instructions: BARE_AGENT_INSTRUCTIONS }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    const workflow = await clients.workflowCommand.create(
      makeGradedAgentCallWorkflow({
        org,
        name: uniqueName("wf-graded"),
        agentSlug: agent.metadata!.slug,
        message: "Reply with exactly: hello",
        rubric: "Score 1.0 if the reply is exactly the word hello, 0.0 otherwise.",
        harness: "native",
        judgeModel: LLM_TASK_MODEL,
      }),
    );
    fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));

    // The child's one text turn, then the judge's forced extract tool.
    mock.enqueue(anthropicText("hello"));
    mock.enqueue(anthropicToolUse("toolu_grade", EVAL_EXTRACT_TOOL_NAME, { score: 1, reasoning: "Exactly the word." }));

    const execution = await clients.workflowExecutionCommand.create(
      makeWorkflowExecution({ org, name: uniqueName("wfx-graded"), workflowId: workflow.metadata!.id }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));
    const final = await awaitWorkflowTerminal(clients, executionId, { timeoutMs: 120_000 });
    expect(
      final.status?.phase,
      `the graded workflow should complete (status.error: ${JSON.stringify(final.status?.error ?? "")})`,
    ).toBe(WorkflowPhase.EXECUTION_COMPLETED);

    const verdict = verdictOf(final);
    expect(verdict.outcome).toBe("completed");
    expect(verdict.score, "the judge's score is on the task output").toBe(1);
    expect(verdict.judge_model, "the eval activity recorded the judge model it used").not.toBe("");
    expect(verdict.agent_execution_id, "the agent task's output names the child execution").toMatch(/^aex_/);
    expect(mock.consumed(), "one child turn and one judge call").toBe(2);
  });
});
