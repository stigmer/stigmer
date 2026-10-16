// Smoke: the live harness benchmark's readers, its session driver and its
// judge still read and drive what the engine writes today.
// - One scripted bare-agent turn on the mock. Each reader returns a value for
//   it: the runner's `turn_phases` and `execution_setup` lines by execution id
//   in the tee'd log, the execute activity's start and the EnsureThread hop in
//   the Temporal history, the first visible token and the turn's end on the
//   session's event stream, the usage aggregate on the terminal status.
// - The working agent (support/working-agent.ts), provisioned as the live run
//   provisions it: the target's MCP fixture, memory through a real
//   Organization, eight skills, a sub-agent, a seeded non-git workspace
//   outside the repository. A scripted turn calls the order tool and writes a
//   file. The benchmark's sessions leave file review off, so the turn ends on
//   its own with nothing to review. Every count the report lifts is present,
//   and the written bytes are on disk.
// - Two provisionings of the working agent send the model byte-identical
//   system prompts and tool surfaces: the instrument's own claim that its
//   fixed names keep the provider's prompt cache as warm as a user's.
// - The quality arm: the working agent's plugin pushed, one of its eval
//   cases run by an eval run about the plugin on the scripted model (its
//   order lookup answered by the suite's own mock), the eval run's result
//   document kept as the report's `quality`, and the operator's table read
//   from it. Gated as well on the runner creating the try's run.
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
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { JUDGE_MODEL, PARITY_MODEL } from "../benchmark/cells";
import { renderQuality, runQualityEval } from "../benchmark/quality-eval";
import { measureSession, type SessionStack } from "../benchmark/session";
import { changedFiles } from "../benchmark/workspace-facts";
import { statusFacts, visibleRows } from "../benchmark/status-facts";
import { streamSessionEvents, watchTurn } from "../benchmark/stream-watch";
import { executeActivityNameFor, historyAxes, invokeWorkflowIdFor, showWorkflow } from "../benchmark/temporal-history";
import { awaitTimingLines, axesFromTiming } from "../benchmark/timing-lines";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { LOOKUP_ORDER_TOOL_NAME } from "../harness/mcp-server";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { readAnthropicRequest, type AnthropicRequestBody } from "@stigmer/test-support/llm-wire";
import { TEMPORAL_DEV_NAMESPACE } from "@stigmer/test-support/temporal";
import { BARE_AGENT_INSTRUCTIONS, agentRefOf, makeAgent } from "../support/agents";
import { makeAgentExecution, requireLlmProxy, requireMcpFixture, sessionIdOf } from "../support/runs";
import { uniqueName } from "../support/naming";
import { renderSystemPrompt, renderToolSurface } from "../support/request-shape";
import {
  provisionWorkingAgent,
  seedWorkingWorkspace,
  WORKING_AGENT_FIXTURE_DIR,
  WORKING_AGENT_WORKSPACE_FIXTURE_DIR,
  WORKING_AGENT_MCP_TOOLS,
  WORKING_AGENT_WORKSPACE_NAME,
  workingAgentSessionSpec,
} from "../support/working-agent";
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
        agentRef: agentRefOf(agent),
        sessionSpec: { subject: "benchmark readers smoke" },
        message: "Say hello.",
        autoApproveAll: true,
      }),
    );
    const executionId = created.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const watched = await watchTurn(streamSessionEvents(clients, sessionIdOf(created)), executionId, {
      startedAtMs,
      timeoutMs: 60_000,
    });
    expect(watched.outcome, "the session's stream reached the turn's end").toBe("until");
    expect(watched.turn?.status?.phase).toBe("completed");
    expect(watched.client_first_visible_token_ms, "the watcher saw the assistant's text arrive").not.toBeNull();
    expect(watched.end_to_end_ms, "the watcher stamped the turn's end").not.toBeNull();
    expect(visibleRows(watched.turn).text, "the ended turn carries the agent's message").toBe(true);

    const ended = await clients.agentExecutionQuery.get({ value: executionId });
    expect(ended.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const facts = statusFacts(ended);
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

  it.skipIf(!probe.capabilities.runnerActsAsRunCreator)(
    "the quality arm runs an eval run about the working agent's plugin and keeps its result document",
    async () => {
      // One case of the suite, one try, on the scripted model: the order
      // lookup answered by the suite's own mock, then the answer, then the
      // llm grader's three votes.
      mock.enqueue(anthropicToolUse("call_lookup", "lookup_order", { order_id: "ORD-4821" }));
      mock.enqueue(
        anthropicText("ORD-4821 is shipped: UPS, tracking 1Z999AA10123456784, shipped 2026-09-24, arriving 2026-09-29."),
      );
      const vote = anthropicText(JSON.stringify({ "invents-nothing": { result: "passed", reason: "Every detail matches." } }));
      for (let i = 0; i < 3; i++) mock.enqueue(vote);

      const quality = await runQualityEval(
        clients,
        [{ id: "quality/deep-agent", harness: "deep-agent", modelRequested: PARITY_MODEL["deep-agent"] }],
        { runs: 1, judgeModel: JUDGE_MODEL, concurrency: 1, caseGlob: "tool-lookup", timeoutMs: 240_000 },
        { log: () => undefined },
      );
      expect(quality.failure, JSON.stringify(quality.failure)).toBeUndefined();
      expect(quality.eval_id).toMatch(/^evr_/);
      expect(quality.plugin).toBe("working-agent");
      const document = quality.document as {
        schemaVersion: number;
        plugins: { schemaVersion: number; cases: { name: string; aggregates: { score: number | null } }[] }[];
      };
      expect(document.schemaVersion).toBe(1);
      expect(document.plugins.map((block) => block.schemaVersion)).toEqual([1]);
      expect(document.plugins[0]!.cases.map((c) => [c.name, c.aggregates.score])).toEqual([["tool-lookup", 1]]);
      expect(renderQuality(quality)).toContain(`| tool-lookup | native/${PARITY_MODEL["deep-agent"]} | 1.00 | yes |`);
    },
    300_000,
  );

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

    it("provisions, runs a tool-and-edit turn to its end, and lifts every count the report carries", async () => {
      const agent = await provision();
      mock.enqueue(anthropicToolUse("toolu_lookup", LOOKUP_ORDER_TOOL_NAME, { order_id: "ORD-4821" }));
      mock.enqueue(anthropicToolUse("toolu_write", WRITE_FILE_TOOL, { file_path: "NOTES.md", content: "ORD-4821 shipped\n" }));
      mock.enqueue(anthropicText("Wrote NOTES.md."));

      const [turn] = await measureSession(
        stack,
        {
          org: agent.org,
          agentRef: agent.agentRef,
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
      expect(mock.consumed(), "the three scripted rounds, and nothing after them").toBe(3);

      const m = sample.measures;
      expect(m.review_ready_ms, "review is off: nothing was offered for review").toBeNull();
      expect(m.end_to_end_ms, "the turn ran to its terminal phase").not.toBeNull();
      expect(m.mcp_server_count, "the one declared MCP server").toBe(1);
      expect(m.attachment_count, "memory is the one platform attachment").toBe(1);
      expect(m.skill_count).toBe(8);
      expect(m.workspace_entry_count).toBe(1);
      expect(m.mcp_connect_ms, "native connects its servers inside setup").not.toBeNull();
      expect(m.cursor_send_returned_ms, "a native turn writes no Cursor first-event line").toBeNull();
      expect(m.tool_calls).toBe(2);
      expect(m.sub_agent_calls).toBe(0);
      expect(sample.timing.turn_first_event).toBeNull();

      expect(await readFile(join(workspaceDir, "NOTES.md"), "utf8"), "the write is on disk").toBe("ORD-4821 shipped\n");
      expect(await changedFiles(WORKING_AGENT_WORKSPACE_FIXTURE_DIR, workspaceDir)).toEqual([
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
            agentRef: agent.agentRef,
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
  });
});
