/**
 * Hermetic: a saved subagent runs with its own context through the REAL
 * `ExecuteDeepAgent` activity.
 *
 * The root agent lists the saved agent `notes` and hands it a task. Pinned:
 *  - its model: its own run defaults name a native model the registry lists,
 *    so its graph is built on that model, not the turn's;
 *  - its shell: the command it runs sees its own value (`ExecutionValues.subagents`)
 *    and never the agent's;
 *  - its hooks: on its call the conversation's hooks run first, in the
 *    agent's environment, then its own block, in its own; both allow the
 *    command, which then runs without a card;
 *  - one level: its model is never offered the `task` tool;
 *  - plan mode: neither the root nor the subagent is offered a shell.
 *
 * The values fetch is overridden to answer the agent's and the subagent's
 * keys; every hook is a real shell command writing what it saw into the
 * workspace.
 */

import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { HookSourceSchema, type HookSource } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { HookConfigSchema, HookFormat, HookGroupSchema, HookHandlerSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { InteractionMode, RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ExecutionValuesSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/values_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { savedAgentFixture } from "../../../../__test-utils__/execution-record-fixture.js";
import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { REGISTRY_DOCUMENT, stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
  sessionWorkspaceDir,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { recordedModelBuilds } from "../../__test-utils__/scripted-model-module.js";
import { ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const NOTES_INSTRUCTIONS = "You are the hermetic notes subagent.";
const NOTES_MODEL = "claude-sonnet-4-6";
const ALLOW = '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}';

/** An inline block whose one Bash hook writes the two keys it sees into `file`, then allows. */
function envWritingHook(file: string): HookSource {
  const command = `printf '%s|%s' "$NOTES_KEY" "$AGENT_KEY" > "$CLAUDE_PROJECT_DIR/${file}"; printf '%s' '${ALLOW}'`;
  return create(HookSourceSchema, {
    source: {
      case: "inline",
      value: create(HookConfigSchema, {
        format: HookFormat.CLAUDE_CODE,
        groups: [create(HookGroupSchema, { event: "PreToolUse", matcher: "Bash", handlers: [create(HookHandlerSchema, { command })] })],
      }),
    },
  });
}

describe("ExecuteDeepAgent hermetic — a saved subagent's own context", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch({
      document: {
        models: [
          ...REGISTRY_DOCUMENT.models,
          { ...REGISTRY_DOCUMENT.models[0], id: NOTES_MODEL, displayName: "Claude Sonnet 4.6 (hermetic fixture)" },
        ],
      },
    });
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  it("runs on its own model, in its own shell, under the conversation's hooks then its own, with no task tool", async () => {
    const notes = savedAgentFixture("notes", {
      description: "Writes notes.",
      instructions: NOTES_INSTRUCTIONS,
      harness: Harness.NATIVE,
      runConfig: { modelName: NOTES_MODEL },
      hooks: [envWritingHook("subagent-hook.txt")],
    });
    const record = deepAgentExecutionRecord({
      message: "Ask notes to record its key.",
      subagents: [notes],
      hooks: [envWritingHook("conversation-hook.txt")],
    });
    const offered: string[][] = [];
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      clientOverrides: {
        fetchExecutionValues: vi.fn(async () =>
          create(ExecutionValuesSchema, {
            agent: { AGENT_KEY: "agent-secret" },
            subagents: [{ name: "notes", values: { NOTES_KEY: "notes-secret" } }],
          }),
        ),
      },
      script: (tools, context) => {
        if (context.systemPrompt.includes(NOTES_INSTRUCTIONS)) {
          offered.push([...tools]);
          return {
            turns: [
              { toolCalls: [{ id: "call-notes-shell", name: "execute", args: { command: `printf '%s|%s' "$NOTES_KEY" "$AGENT_KEY" > shell-env.txt` } }] },
              { text: "Recorded." },
            ],
          };
        }
        return {
          turns: [
            { toolCalls: [{ id: "call-task", name: "task", args: { description: "Record your key.", subagent_type: "notes" } }] },
            { text: "Done." },
          ],
        };
      },
    });
    const workspace = sessionWorkspaceDir(env);
    mkdirSync(workspace, { recursive: true });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    const subRows = record.lastFullRows!.subAgentRuns.flatMap((sa) => sa.messages.flatMap((m) => m.toolCalls));
    expect(subRows.map((r) => [r.id, r.status]), "both hooks allowed it: no card").toEqual([["call-notes-shell", ToolCallStatus.TOOL_CALL_COMPLETED]]);

    expect(readFileSync(join(workspace, "shell-env.txt"), "utf8"), "its shell holds its value, never the agent's").toBe("notes-secret|");
    expect(readFileSync(join(workspace, "conversation-hook.txt"), "utf8"), "the conversation's hook runs in the agent's environment").toBe("|agent-secret");
    expect(readFileSync(join(workspace, "subagent-hook.txt"), "utf8"), "its own hook runs in its environment").toBe("notes-secret|");

    expect(recordedModelBuilds().map((b) => b.modelName), "its graph is built on its own model").toContain(NOTES_MODEL);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.flat(), "one level").not.toContain("task");
    expect(offered[0], "its shell").toContain("execute");
  });

  it("gives neither the root nor the subagent a shell in plan mode", async () => {
    const notes = savedAgentFixture("notes", { description: "Writes notes.", instructions: NOTES_INSTRUCTIONS });
    const record = deepAgentExecutionRecord({ message: "Plan with notes.", subagents: [notes] });
    record.execution.spec!.interactionMode = InteractionMode.PLAN;
    const offered = { root: [] as string[][], notes: [] as string[][] };
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: (tools, context) => {
        if (context.systemPrompt.includes(NOTES_INSTRUCTIONS)) {
          offered.notes.push([...tools]);
          return { turns: [{ text: "Nothing to run." }] };
        }
        offered.root.push([...tools]);
        return {
          turns: [
            { toolCalls: [{ id: "call-task", name: "task", args: { description: "Plan it.", subagent_type: "notes" } }] },
            { text: "Planned." },
          ],
        };
      },
    });
    mkdirSync(sessionWorkspaceDir(env), { recursive: true });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect(offered.root.flat()).not.toContain("execute");
    expect(offered.notes.length).toBeGreaterThan(0);
    expect(offered.notes.flat(), "plan mode gives the subagent no shell").not.toContain("execute");
  });
});
