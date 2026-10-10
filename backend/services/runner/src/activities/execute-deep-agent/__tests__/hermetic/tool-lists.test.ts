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
 *    a model is asked: RUN_FAILED on the actionable surface, with the
 *    resolution error's own sentence (naming the agent and its entries) as
 *    `status.error` and the one `Execution failed:` row.
 *  - A turn's own lists (`spec.tools`, `spec.disallowed_tools`) are one more
 *    layer over the agent's: they refuse a call the agent allows, never admit
 *    one it excludes, and a turn `tools` the agent leaves nothing of refuses
 *    the turn in the turn's name.
 *  - A turn whose lists deny `Skill` shows no skills section, though the
 *    agent references a skill, and its `read_file` of a skill's `SKILL.md`
 *    is refused; the same agent without the deny lists and reads it.
 *  - `spec.append_system_prompt` ends the system prompt Stigmer composes; only
 *    the to-do middleware's own line follows it in what the model is given.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SubAgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import {
  ApprovalPolicySource,
  RunPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

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
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
  sessionWorkspaceDir,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { recordedModelBuilds } from "../../__test-utils__/scripted-model-module.js";
import { TODO_SYSTEM_PROMPT } from "../../todo-list.js";

const CALL_ID = "call-hermetic-listed-out-0001";
const AGENT_OWNER = "The agent";

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
      expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
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
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    const subRows = record.lastFullStatus!.subAgentRuns.flatMap((sa) => sa.messages.flatMap((m) => m.toolCalls));
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
    expect(final.phase).toBe(RunPhase.RUN_FAILED);
    expect(final.error).toBe(message);
    expect(final.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content)).toEqual([
      `Execution failed: ${message}`,
    ]);
    expect(recordedModelBuilds().length, "the model is built, never asked").toBeLessThanOrEqual(1);
  });

  it("a turn's disallowed_tools refuses a call the agent allows, naming the turn's layer", async () => {
    const record = deepAgentExecutionRecord({ message: "Write a file.", turnDisallowedTools: ["Write"] });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({
        turns: [
          { toolCalls: [{ id: "call-turn-write", name: "write_file", args: { file_path: "/out.txt", content: "x" } }] },
          { text: "I may not write here." },
        ],
      }),
    });
    const workspace = sessionWorkspaceDir(env);
    mkdirSync(workspace, { recursive: true });

    await runDeepAgentTurn(scenario);

    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    const [row] = record.toolCalls();
    expect(row!.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(row!.result || row!.error).toContain("The turn: disallowed_tools [Write]");
    expect(() => readFileSync(join(workspace, "out.txt")), "the write never ran").toThrow();
  });

  it("a turn's tools cannot widen the agent's: a list the agent leaves nothing of refuses the turn in the turn's name", async () => {
    const record = deepAgentExecutionRecord({ message: "Never reaches a model.", disallowedTools: ["Bash"], turnTools: ["Bash"] });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => {
        throw new Error("the model must never be asked when the turn's list resolves to nothing");
      },
    });

    await runDeepAgentTurn(scenario);

    const final = record.lastFullStatus!;
    expect(final.phase).toBe(RunPhase.RUN_FAILED);
    expect(final.error).toBe(new ToolListResolutionError("The turn", ["Bash"]).message);
  });

  for (const hidden of [true, false]) {
    it(`Skill ${hidden ? "denied by the turn: no skills section, and a read of the skill is refused" : "not denied: the skill is listed and reads"}`, async () => {
      const record = deepAgentExecutionRecord({
        message: "Use your skill.",
        skills: [{ slug: "alpha", description: "The alpha skill", skillMd: "# alpha\nDo alpha things." }],
        ...(hidden ? { turnDisallowedTools: ["Skill"] } : {}),
      });
      const prompts: string[] = [];
      const scenario = beginDeepAgentScenario({
        env,
        clock,
        record,
        script: (_tools, context) => {
          prompts.push(context.systemPrompt);
          return {
            turns: [
              { toolCalls: [{ id: "call-skill-read", name: "read_file", args: { file_path: "/.stigmer/skills/alpha/SKILL.md" } }] },
              { text: "Done." },
            ],
          };
        },
      });
      mkdirSync(sessionWorkspaceDir(env), { recursive: true });

      await runDeepAgentTurn(scenario);

      expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
      expect(prompts.length).toBeGreaterThan(0);
      for (const prompt of prompts) expect(prompt.includes("## Skills")).toBe(!hidden);
      const [row] = record.toolCalls();
      if (hidden) {
        expect(row!.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
        expect(row!.result || row!.error).toContain("The turn: disallowed_tools [Skill]");
      } else {
        expect(row!.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
        expect(row!.result).toContain("Do alpha things.");
      }
    });
  }

  it("append_system_prompt ends the composed system prompt, before only the to-do middleware's line", async () => {
    const APPENDED = "Always answer in exactly one sentence.";
    const record = deepAgentExecutionRecord({ message: "Hello.", appendSystemPrompt: APPENDED });
    const prompts: string[] = [];
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: (_tools, context) => {
        prompts.push(context.systemPrompt);
        return { turns: [{ text: "Hello." }] };
      },
    });
    mkdirSync(sessionWorkspaceDir(env), { recursive: true });

    await runDeepAgentTurn(scenario);

    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    expect(prompts.length).toBeGreaterThan(0);
    // The to-do middleware's own line is added after the composed prompt; the
    // appended text closes everything Stigmer composes.
    for (const prompt of prompts) expect(prompt.endsWith(`\n\n${APPENDED}\n\n${TODO_SYSTEM_PROMPT}`)).toBe(true);
  });
});
