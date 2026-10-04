/**
 * Hermetic: an agent's tool lists through the whole `ExecuteDeepAgent`
 * activity — the resolved scope on the turn context, the tool-scope
 * middleware on the graph, and what reaches the timeline.
 *
 * Invariants pinned:
 *  - A call to a tool the agent's lists exclude reaches the transcript as ONE
 *    failed tool row whose result is the lists' message: no approval card, no
 *    provenance, no engine version, the handler never ran, and the turn
 *    completes. It holds under auto-approve-all, where no gate is installed,
 *    and inside a sub-agent whose own lists narrow the agent's.
 *  - A `tools` list that names nothing the turn has refuses the turn before
 *    a model is asked: EXECUTION_FAILED on the actionable surface, with the
 *    resolution error's own sentence (naming the agent and its entries) as
 *    `status.error` and the one `Execution failed:` row.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SubAgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import {
  ApprovalPolicySource,
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { ToolListResolutionError, ToolScope, outOfScopeMessage } from "../../../../shared/tool-lists.js";
import {
  FIXTURE,
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
  sessionWorkspaceDir,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { recordedModelBuilds } from "../../__test-utils__/scripted-model-module.js";

const CALL_ID = "call-hermetic-listed-out-0001";
const AGENT_OWNER = `Agent "${FIXTURE.agentName}"`;

describe("ExecuteDeepAgent hermetic — tool lists", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  for (const autoApproveAll of [false, true]) {
    it(`a listed-out call is one failed row with the lists' message, no card and no provenance (auto-approve-all ${autoApproveAll})`, async () => {
      const lists = { tools: [], disallowedTools: ["Write"] };
      const record = deepAgentExecutionRecord({
        message: "Write a file.",
        autoApproveAll,
        disallowedTools: lists.disallowedTools,
      });
      const scenario = beginDeepAgentScenario({
        env,
        clock,
        record,
        script: () => ({
          turns: [
            { text: "Writing.", toolCalls: [{ id: CALL_ID, name: "write_file", args: { file_path: "/out.txt", content: "x" } }] },
            { text: "I cannot write files here." },
          ],
        }),
      });
      const workspace = sessionWorkspaceDir(env);
      mkdirSync(workspace, { recursive: true });

      const invocation = await runDeepAgentTurn(scenario);

      expect(invocation.outcome.kind).toBe("returned");
      expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);
      const rows = record.toolCalls();
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.id).toBe(CALL_ID);
      expect(row.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
      expect(row.result || row.error).toContain(
        outOfScopeMessage("write_file", ToolScope.of(AGENT_OWNER, lists)),
      );
      expect(row.requiresApproval, "no card").toBe(false);
      expect(row.approvalPolicySource, "no provenance").toBe(ApprovalPolicySource.UNSPECIFIED);
      expect(row.policyEngineVersion).toBe("");
      expect(() => readFileSync(join(workspace, "out.txt")), "the write never ran").toThrow();
    });
  }

  it("a sub-agent's own lists refuse its call: one failed row in its transcript, nothing ran", async () => {
    const WORKER = "You are the hermetic worker.";
    const worker = create(SubAgentSchema, { name: "worker", description: "Works.", instructions: WORKER, tools: ["Read"] });
    // A second sub-agent with no lists of its own: it is not checked, and runs under the agent's scope.
    const helper = create(SubAgentSchema, { name: "helper", description: "Helps.", instructions: "You help." });
    const record = deepAgentExecutionRecord({ message: "Delegate.", subAgents: [worker, helper] });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: (_tools, context) =>
        context.systemPrompt.includes(WORKER)
          ? {
              turns: [
                { toolCalls: [{ id: "call-sub-shell", name: "execute", args: { command: "echo ran > marker.txt" } }] },
                { text: "I may not run commands." },
              ],
            }
          : {
              turns: [
                { toolCalls: [{ id: "call-task", name: "task", args: { description: "Run it.", subagent_type: "worker" } }] },
                { text: "Done." },
              ],
            },
    });
    const workspace = sessionWorkspaceDir(env);
    mkdirSync(workspace, { recursive: true });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    const subRows = record.lastFullStatus!.subAgentExecutions.flatMap((sa) => sa.messages.flatMap((m) => m.toolCalls));
    expect(subRows.map((r) => [r.id, r.status])).toEqual([["call-sub-shell", ToolCallStatus.TOOL_CALL_FAILED]]);
    expect(subRows[0].error).toContain('Sub-agent "worker": tools [Read]');
    expect(subRows[0].approvalPolicySource).toBe(ApprovalPolicySource.UNSPECIFIED);
    expect(() => readFileSync(join(workspace, "marker.txt")), "the shell never ran").toThrow();
  });

  it("a tools list that names nothing the turn has refuses the turn with the resolution error's sentence", async () => {
    const tools = ["mcp__nowhere", "NoSuchTool"];
    const record = deepAgentExecutionRecord({ message: "Never reaches a model.", tools });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => {
        throw new Error("the model must never be asked when the lists resolve to nothing");
      },
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind, "a deterministic refusal RETURNS").toBe("returned");
    const final = record.lastFullStatus!;
    const message = new ToolListResolutionError(AGENT_OWNER, tools).message;
    expect(final.phase).toBe(ExecutionPhase.EXECUTION_FAILED);
    expect(final.error).toBe(message);
    expect(final.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content)).toEqual([
      `Execution failed: ${message}`,
    ]);
    expect(recordedModelBuilds().length, "the model is built, never asked").toBeLessThanOrEqual(1);
  });
});
