// Smoke: the live harness benchmark's readers, its session driver and its
// judge still read and drive what the engine writes today.
// - One scripted bare-agent turn on the mock. Each reader returns a value for
//   it: the runner's `turn_phases` and `execution_setup` lines by execution id
//   in the tee'd log, the execute activity's start and the EnsureThread hop in
//   the Temporal history, the first visible token and the terminal phase on
//   the subscribe stream, the usage aggregate on the terminal status.
// - The working agent (support/working-agent.ts), provisioned as the live run
//   provisions it: the target's MCP fixture, memory through a real
//   Organization, eight skills, a sub-agent, a seeded non-git workspace
//   outside the repository. A scripted turn calls the order tool and writes a
//   file. The session driver stops at review, approves, and follows the
//   reconcile to the end. Every count the report lifts is present, and the
//   written bytes are on disk.
// - Two provisionings of the working agent send the model byte-identical
//   system prompts and tool surfaces: the instrument's own claim that its
//   fixed names keep the provider's prompt cache as warm as a user's.
// - A composed subject graded by the eval-only judge workflow, with a
//   scripted multi-criteria verdict read back with its criteria, and a
//   verdict missing a criterion refused as a judge failure.
// Domain: conformance harness (the benchmark instrument's wiring).
//
// Why a smoke and not a facet: nothing here is a contract of the platform; it
// is the instrument's dependence on the runner's current field names, ids and
// task outputs, which the live benchmark (`make benchmark-harnesses`, an
// experiment that spends real money) would otherwise discover at the owner's
// run. No NUMBER is asserted — a scripted model makes every timing meaningless
// — only presence and shape, so the live half stays an experiment and this
// stays a test. The Cursor harness is never reached: its model calls do not
// pass through the mock, so its side is proven by the live run alone.
//
// Gated on the two accessors the readers need: the target's Temporal address
// (`engineCoordinates`, absent on the cloud targets whose runner discovers
// Temporal through the control plane) and the runner's tee'd log
// (`runnerLogFile`, present only on targets that spawn the runner). The
// working-agent arms are gated as well on the MCP tool fixture and on
// first-party memory capture. Where any is missing the arms report SKIPPED,
// the IPC smoke's shape.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { judge } from "../benchmark/quality";
import type { QualityTask } from "../benchmark/quality-tasks";
import { measureSession, type SessionStack } from "../benchmark/session";
import { composeSubject } from "../benchmark/subject";
import { changedFiles, readWorkspaceFile } from "../benchmark/workspace-facts";
import { statusFacts, visibleRows } from "../benchmark/status-facts";
import { subscribeTo, watchExecution } from "../benchmark/stream-watch";
import { executeActivityNameFor, historyAxes, invokeWorkflowIdFor, showWorkflow } from "../benchmark/temporal-history";
import { awaitTimingLines, axesFromTiming } from "../benchmark/timing-lines";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "../harness/mock-llm";
import { LOOKUP_ORDER_TOOL_NAME } from "../harness/mcp-server";
import { anthropicText, anthropicToolUse } from "../harness/mock-llm";
import { readAnthropicRequest, type AnthropicRequestBody } from "../harness/llm-wire";
import { TEMPORAL_DEV_NAMESPACE } from "../harness/temporal";
import { BARE_AGENT_INSTRUCTIONS, makeAgent } from "../support/agents";
import { makeAgentExecution, requireLlmProxy, requireMcpFixture } from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { renderSystemPrompt, renderToolSurface } from "../support/request-shape";
import {
  provisionWorkingAgent,
  seedWorkingWorkspace,
  WORKING_AGENT_FIXTURE_DIR,
  WORKING_AGENT_MCP_TOOLS,
  WORKING_AGENT_WORKSPACE_NAME,
  workingAgentSessionSpec,
} from "../support/working-agent";
import { EVAL_EXTRACT_TOOL_NAME, LLM_TASK_MODEL } from "../support/workflows";
import { createTarget, type TargetProfile } from "../targets";

const probe = createTarget();
const hasReaders = probe.engineCoordinates !== undefined && probe.runnerLogFile !== undefined;
const hasWorkingAgent = hasReaders && probe.mcpFixture !== undefined && probe.capabilities.firstPartyMemoryCapture;

// The native harness's built-in file tool, as the runner binds it.
const WRITE_FILE_TOOL = "write_file";

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

  describe.skipIf(!hasWorkingAgent)("the working agent", () => {
    let base: string;
    let workspaceDir: string;
    let stack: SessionStack;

    beforeAll(async () => {
      base = await mkdtemp(join(tmpdir(), "benchmark-smoke-"));
      workspaceDir = join(base, WORKING_AGENT_WORKSPACE_NAME);
      stack = {
        clients,
        runnerLogFile: target.runnerLogFile!(),
        temporal: { hostPort: target.engineCoordinates!().temporalHostPort, namespace: TEMPORAL_DEV_NAMESPACE },
      };
    });

    afterAll(async () => {
      await rm(base, { recursive: true, force: true });
    });

    const provision = () =>
      provisionWorkingAgent(clients, fixtures, {
        mcpUrl: requireMcpFixture(target).url(WORKING_AGENT_MCP_TOOLS),
        workspaceDir,
      });

    it("provisions, runs a tool-and-edit turn through review, and lifts every count the report carries", async () => {
      const agent = await provision();
      mock.enqueue(anthropicToolUse("toolu_lookup", LOOKUP_ORDER_TOOL_NAME, { order_id: "ORD-4821" }));
      mock.enqueue(anthropicToolUse("toolu_write", WRITE_FILE_TOOL, { file_path: "NOTES.md", content: "ORD-4821 shipped\n" }));
      mock.enqueue(anthropicText("Wrote NOTES.md."));

      const [turn] = await measureSession(
        stack,
        {
          org: agent.org,
          agentId: agent.agentId,
          harness: "deep-agent",
          modelRequested: null,
          sessionSpec: workingAgentSessionSpec(agent, Harness.NATIVE, "benchmark readers smoke"),
          prompts: ["Look up ORD-4821 and note its status in NOTES.md."],
          label: "smoke/working",
        },
        { log: () => undefined },
      );
      const sample = turn!.sample;
      expect(sample.outcome, `the turn should complete (${JSON.stringify(sample.failure)})`).toBe("completed");
      expect(sample.failure).toBeUndefined();
      expect(turn!.reply).toBe("Wrote NOTES.md.");
      expect(mock.consumed(), "the three scripted rounds, and nothing after the approval").toBe(3);

      const m = sample.measures;
      expect(m.review_ready_ms, "the driver stopped at review before the end").not.toBeNull();
      expect(m.end_to_end_ms, "and followed the reconcile to the terminal phase").not.toBeNull();
      expect(m.mcp_server_count, "the one declared MCP server").toBe(1);
      expect(m.attachment_count, "memory is the one platform attachment").toBe(1);
      expect(m.skill_count).toBe(8);
      expect(m.workspace_entry_count).toBe(1);
      expect(m.mcp_connect_ms, "native connects its servers inside setup").not.toBeNull();
      expect(m.cursor_send_returned_ms, "a native turn writes no Cursor first-event line").toBeNull();
      expect(m.tool_calls).toBe(2);
      expect(m.sub_agent_calls).toBe(0);
      expect(sample.timing.turn_first_event).toBeNull();

      expect(await readFile(join(workspaceDir, "NOTES.md"), "utf8"), "the approved write is on disk").toBe("ORD-4821 shipped\n");
      expect(await changedFiles(join(WORKING_AGENT_FIXTURE_DIR, "workspace"), workspaceDir)).toEqual([
        { path: "NOTES.md", change: "added" },
      ]);
    });

    it("two provisionings send the model byte-identical system prompts and tool surfaces", async () => {
      const firstTurn = async (): Promise<AnthropicRequestBody> => {
        const agent = await provision();
        const before = mock.scriptedRequests().length;
        mock.enqueue(anthropicText("Hello."));
        const [turn] = await measureSession(
          stack,
          {
            org: agent.org,
            agentId: agent.agentId,
            harness: "deep-agent",
            modelRequested: null,
            sessionSpec: workingAgentSessionSpec(agent, Harness.NATIVE, "benchmark readers smoke"),
            prompts: ["Hello."],
            label: "smoke/stable",
          },
          { log: () => undefined },
        );
        expect(turn!.sample.outcome).toBe("completed");
        return readAnthropicRequest(mock.scriptedRequests()[before]!.body);
      };
      const first = await firstTurn();
      const second = await firstTurn();
      expect(renderSystemPrompt(second), "a fresh org, the same fixed names: the same system prompt").toBe(renderSystemPrompt(first));
      expect(renderToolSurface(second), "and the same tool surface").toBe(renderToolSurface(first));
    });

    it("the judge grades a composed subject by its criteria, and refuses a verdict missing one", async () => {
      const { org } = await target.provisionTenancy();
      await seedWorkingWorkspace(workspaceDir);
      const task: QualityTask = {
        id: "smoke-task",
        placeholder: false,
        turns: ["Explain ParseMinutes."],
        files: ["duration/duration.go"],
        checks: [],
        rubric: "Grade the explanation of ParseMinutes against the file.",
        criteria: [
          { name: "accurate", description: "The explanation matches the code.", weight: 3 },
          { name: "concise", description: "It is short.", weight: 1 },
        ],
      };
      const subject = composeSubject({
        turns: [{ prompt: task.turns[0]!, reply: "It sums hours and minutes.", outcome: "completed" }],
        filesChanged: await changedFiles(join(WORKING_AGENT_FIXTURE_DIR, "workspace"), workspaceDir),
        namedFiles: [{ path: "duration/duration.go", content: await readWorkspaceFile(workspaceDir, "duration/duration.go") }],
        checks: [],
      });

      mock.enqueue(
        anthropicToolUse("toolu_grade", EVAL_EXTRACT_TOOL_NAME, {
          criteria: [
            { name: "accurate", score: 1, reasoning: "Matches the code." },
            { name: "concise", score: 0.5, reasoning: "A little long." },
          ],
        }),
      );
      const graded = await judge(clients, fixtures, { org, task, subject, judgeModel: LLM_TASK_MODEL, timeoutMs: 120_000 });
      expect(graded.outcome, JSON.stringify(graded.failure)).toBe("completed");
      expect(graded.score, "the eval weighted the two criteria").toBeCloseTo(0.875, 5);
      expect(graded.criteria.map((criterion) => [criterion.name, criterion.weight, criterion.score])).toEqual([
        ["accurate", 3, 1],
        ["concise", 1, 0.5],
      ]);
      expect(graded.judge_model, "the eval recorded the judge model it used").not.toBe("");
      expect(graded.workflow_execution_id, "the grade names the judge run it came from").not.toBe("");

      mock.enqueue(
        anthropicToolUse("toolu_grade_short", EVAL_EXTRACT_TOOL_NAME, {
          criteria: [{ name: "accurate", score: 1, reasoning: "Matches the code." }],
        }),
      );
      const refused = await judge(clients, fixtures, { org, task, subject, judgeModel: LLM_TASK_MODEL, timeoutMs: 120_000 });
      expect(refused.score, "a skipped criterion is never read as a grade").toBeNull();
      expect(refused.failure?.stage).toBe("judge");
    });
  });
});
