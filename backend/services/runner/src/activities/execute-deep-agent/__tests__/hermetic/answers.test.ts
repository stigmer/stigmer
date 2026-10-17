/**
 * Hermetic: asking before an edit on the native engine, the twin of the
 * Cursor arm in `execute-cursor/__tests__/hermetic/answers.test.ts`.
 *
 * The agent's own hook asks on `Write` with file review off. The model's
 * `write_file` waits for a person (WAITING_FOR_APPROVAL); between turns the
 * record does what the server's answer core does, appending the person's
 * deny to the session's log and stamping the row; the reinvocation reads it
 * through the runtime's door (`harness/approval-answers.ts`), the gate refuses
 * the write, and the turn completes. The file is byte-identical, and the log
 * holds the `ask` tool use, the deny and an `is_error` result.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { HookSourceSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { HookConfigSchema, HookFormat, HookGroupSchema, HookHandlerSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, type HermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
  sessionWorkspaceDir,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { CLOSING_TURN } from "../../__test-utils__/hitl-script.js";
import { ApprovalAction } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const BEFORE = "# Notes\n";

describe("ExecuteDeepAgent hermetic — asking before an edit", () => {
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

  it("the agent's hook asks on Write, the person denies, and the file is untouched", async () => {
    clock.reset();
    const asksOnWrite = create(HookSourceSchema, {
      source: {
        case: "inline",
        value: create(HookConfigSchema, {
          format: HookFormat.CLAUDE_CODE,
          groups: [create(HookGroupSchema, {
            event: "PreToolUse",
            matcher: "Write",
            handlers: [create(HookHandlerSchema, {
              command: "/bin/echo",
              args: ['{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"edits need a person"}}'],
            })],
          })],
        }),
      },
    });
    const record = deepAgentExecutionRecord({ message: "Change the notes.", hooks: [asksOnWrite] });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      checkpointer: "sqlite",
      script: () => ({
        turns: [
          { text: "Changing the notes.", toolCalls: [{ id: "call-native-edit", name: "write_file", args: { file_path: "/notes.md", content: "# Notes\nchanged\n" } }] },
          CLOSING_TURN,
        ],
      }),
    });

    // The scenario's start resets the session's workspace; the file is laid down after it.
    mkdirSync(sessionWorkspaceDir(env), { recursive: true });
    const file = join(sessionWorkspaceDir(env), "notes.md");
    writeFileSync(file, BEFORE, "utf-8");

    await runDeepAgentTurn(scenario, { turnSeq: 0 });
    expect(record.persistedPhases.at(-1), "the hook's ask holds the write for a person").toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
    expect(record.decideWaitingToolCalls(ApprovalAction.REJECT, "2026-01-01T00:00:30.000Z")).toBe(1);

    await runDeepAgentTurn(scenario, { turnSeq: 1 });
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    expect(readFileSync(file, "utf-8"), "the denied write never touched the file").toBe(BEFORE);

    const log = record.sessionEvents;
    const use = log.find((e) => e.event.case === "agentToolUse" && e.event.value.evaluatedPermission === "ask");
    expect(use, "the log holds the edit as a tool use that asked").toBeDefined();
    const useId = use!.event.case === "agentToolUse" ? use!.event.value.id : "";
    const confirmation = log.find((e) => e.event.case === "userToolConfirmation" && e.event.value.toolUseId === useId);
    expect(confirmation?.event.case === "userToolConfirmation" && confirmation.event.value.result).toBe("deny");
    const result = log.find((e) => e.event.case === "agentToolResult" && e.event.value.toolUseId === useId);
    expect(result?.event.case === "agentToolResult" && result.event.value.isError, "the edit's result is an error").toBe(true);
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
  });
});
