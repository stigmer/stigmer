/**
 * Hermetic goldens: a person's answers on the Cursor engine, read from the
 * session's log, through two real `ExecuteCursor` invocations with the REAL
 * bash gate as the out-of-process half.
 *
 * Between turns the record does what the server's answer core does: it
 * appends the `user.tool_confirmation` (and, for "allow for the rest of the
 * turn", the `stigmer.permission.grant`) to the session's log and stamps the
 * row (`ExecutionRecord.decideWaitingToolCalls`). The reinvocation reads the
 * answer through the runtime's one door (`harness/approval-answers.ts`).
 *
 *  - A deny with a reason: the gated shell call never runs; the resumed
 *    prompt names the refused action with the person's reason; the row
 *    settles SKIPPED with `Rejected by user`; COMPLETED. Golden
 *    `reject.turn2`.
 *  - Allow for the rest of the turn: the gated build runs, and a second
 *    shell call of the same class runs without asking (the shell lease);
 *    COMPLETED. Golden `approve-all.turn2`.
 *  - Asking before an edit: the agent's own hook asks on `Write` with file
 *    review off; the person denies; the file is byte-identical, and the log
 *    holds the `ask` tool use, the deny and an `is_error` result. Its native
 *    twin is `execute-deep-agent/__tests__/hermetic/answers.test.ts`.
 *
 * Skipped where `bash` is unavailable — reported as SKIPPED, never a silent pass.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { HookSourceSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { HookConfigSchema, HookFormat, HookGroupSchema, HookHandlerSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("@cursor/sdk", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
);
vi.mock("@cursor/sdk/sqlite", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSqliteModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
  statusGolden,
  rowsGolden,
  rowsGoldenPath,
} from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { hasBash, hookBuiltin, hookShell } from "../../__test-utils__/cursor-hook-harness.js";
import { ScriptedCursorAgent, sdkEvents, step } from "../../__test-utils__/scripted-agent.js";
import {
  FIXTURE,
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
  runWorkspaceHook,
  runWorkspaceHooks,
  sessionWorkspaceDir,
} from "../../__test-utils__/hermetic-cursor.js";
import { ApprovalAction, ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import {  type AgentMessage } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

const DECIDED_AT = "2026-01-01T00:00:30.000Z";
const FINISH = { inputTokens: 1_000, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 };


const row = (rows: { readonly messages: readonly AgentMessage[] }, id: string) => rows.messages.flatMap((m) => m.toolCalls).find((tc) => tc.id === id);

describe.skipIf(!hasBash)("ExecuteCursor hermetic — a person's answers, read from the log", () => {
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

  it("a deny with a reason: the call never runs, the resumed prompt carries the reason, the turn completes", async () => {
    clock.reset();
    const workspaceRoot = sessionWorkspaceDir(env);
    const decisions: string[] = [];
    const command = "rm -rf build/";
    const ev1 = sdkEvents("agent-answer-reject", "run-answer-reject-1");
    const ev2 = sdkEvents("agent-answer-reject", "run-answer-reject-2");
    const agent = new ScriptedCursorAgent({
      agentId: "agent-answer-reject",
      runIds: ["run-answer-reject-1", "run-answer-reject-2"],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev1.init()),
          step.event(ev1.toolCall("call-clean", "shell", "running", { command })),
          step.effect("hook: expect deny", () => {
            decisions.push(runWorkspaceHook(workspaceRoot, hookShell(command)).permission);
          }),
          step.event(ev1.toolCall("call-clean", "shell", "error", { command }, "Blocked by hook")),
          step.finished({ result: "never" }),
        ],
        [
          step.event(ev2.assistant("Understood: I will use make clean instead.")),
          step.turnEnded(FINISH),
          step.finished({ result: "Understood: I will use make clean instead.", model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: "Clean the build." });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    await runCursorTurn(scenario, { threadId: "", turnSeq: 0 });
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
    expect(record.decideWaitingToolCalls(ApprovalAction.REJECT, DECIDED_AT, undefined, "use make clean instead")).toBe(1);

    await runCursorTurn(scenario, { threadId: "agent-answer-reject", turnSeq: 1 });
    expect(decisions).toEqual(["deny"]);
    expect(String(agent.sends[1]?.message), "the resumed prompt names the refusal with its reason").toContain(
      "(the user said: use make clean instead)",
    );
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    const final = record.lastFullStatus!;
    const clean = row(record.rowsOf(final), "call-clean")!;
    expect([clean.status, clean.approvalAction, clean.error]).toEqual([
      ToolCallStatus.TOOL_CALL_SKIPPED,
      ApprovalAction.REJECT,
      "Rejected by user",
    ]);
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    await expect(statusGolden(final)).toMatchFileSnapshot("./goldens/reject.turn2.status.json");
    await expect(rowsGolden(record.rowsOf(final))).toMatchFileSnapshot(rowsGoldenPath("./goldens/reject.turn2.status.json"));
    await expect(record.eventsGolden()).toMatchFileSnapshot("./goldens/reject.turn2.events.json");
  });

  it("allow for the rest of the turn: the gated build runs and a second shell call of the class runs unasked", async () => {
    clock.reset();
    const workspaceRoot = sessionWorkspaceDir(env);
    const decisions: string[] = [];
    const hook = (command: string) =>
      step.effect(`hook: ${command}`, () => {
        decisions.push(runWorkspaceHook(workspaceRoot, hookShell(command)).permission);
      });
    const ev1 = sdkEvents("agent-answer-all", "run-answer-all-1");
    const ev2 = sdkEvents("agent-answer-all", "run-answer-all-2");
    const agent = new ScriptedCursorAgent({
      agentId: "agent-answer-all",
      runIds: ["run-answer-all-1", "run-answer-all-2"],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev1.init()),
          step.event(ev1.toolCall("call-build", "shell", "running", { command: "npm run build" })),
          hook("npm run build"),
          step.event(ev1.toolCall("call-build", "shell", "error", { command: "npm run build" }, "Blocked by hook")),
          step.finished({ result: "never" }),
        ],
        [
          hook("npm run build"),
          step.event(ev2.toolCall("call-build-again", "shell", "running", { command: "npm run build" })),
          step.event(ev2.toolCall("call-build-again", "shell", "completed", { command: "npm run build" }, "build ok\n")),
          hook("npm test"),
          step.event(ev2.toolCall("call-test", "shell", "running", { command: "npm test" })),
          step.event(ev2.toolCall("call-test", "shell", "completed", { command: "npm test" }, "tests ok\n")),
          step.event(ev2.assistant("Built and tested.")),
          step.turnEnded(FINISH),
          step.finished({ result: "Built and tested.", model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: "Build and test." });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    await runCursorTurn(scenario, { threadId: "", turnSeq: 0 });
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE_ALL, DECIDED_AT)).toBe(1);
    expect(
      record.sessionEvents.filter((e) => e.event.case === "stigmerPermissionGrant").map((e) => e.event.case === "stigmerPermissionGrant" && e.event.value.lease?.category),
      "the grant names the shell class",
    ).toEqual(["shell"]);

    await runCursorTurn(scenario, { threadId: "agent-answer-all", turnSeq: 1 });
    expect(decisions, "the grant lets the build through and the lease the next shell call").toEqual(["deny", "allow", "allow"]);
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    const final = record.lastFullStatus!;
    expect(row(record.rowsOf(final), "call-build")?.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row(record.rowsOf(final), "call-build")?.approvalAction).toBe(ApprovalAction.APPROVE_ALL);
    expect(row(record.rowsOf(final), "call-test")?.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    await expect(statusGolden(final)).toMatchFileSnapshot("./goldens/approve-all.turn2.status.json");
    await expect(rowsGolden(record.rowsOf(final))).toMatchFileSnapshot(rowsGoldenPath("./goldens/approve-all.turn2.status.json"));
    await expect(record.eventsGolden()).toMatchFileSnapshot("./goldens/approve-all.turn2.events.json");
  });

  it("asking before an edit: the agent's hook asks on Write, the person denies, and the file is untouched", async () => {
    clock.reset();
    const workspaceRoot = sessionWorkspaceDir(env);
    const file = join(workspaceRoot, "notes.md");
    const before = "# Notes\n";
    writeFileSync(file, before, "utf-8");
    const answers: string[] = [];
    const ev1 = sdkEvents("agent-answer-edit", "run-answer-edit-1");
    const ev2 = sdkEvents("agent-answer-edit", "run-answer-edit-2");
    const args = { path: "notes.md", content: "# Notes\nchanged\n" };
    const agent = new ScriptedCursorAgent({
      agentId: "agent-answer-edit",
      runIds: ["run-answer-edit-1", "run-answer-edit-2"],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev1.init()),
          step.event(ev1.toolCall("call-edit", "edit", "running", args)),
          step.effect("hook: Write (expect the ask to deny until a person answers)", async () => {
            const input = { ...hookBuiltin("Write", { file_path: file, content: args.content }), tool_use_id: "call-edit" };
            const answer = await runWorkspaceHooks(workspaceRoot, input);
            answers.push(answer.permission);
            // The SDK writes only when the hook allows.
            if (answer.permission === "allow") writeFileSync(file, args.content, "utf-8");
          }),
          step.event(ev1.toolCall("call-edit", "edit", "error", args, "Blocked by hook")),
          step.finished({ result: "never" }),
        ],
        [
          step.event(ev2.assistant("Leaving notes.md as it is.")),
          step.turnEnded(FINISH),
          step.finished({ result: "Leaving notes.md as it is.", model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
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
    const record = cursorExecutionRecord({ message: "Change the notes.", hooks: [asksOnWrite] });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    await runCursorTurn(scenario, { threadId: "", turnSeq: 0 });
    expect(answers, "the hook's ask holds the write for a person").toEqual(["deny"]);
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
    expect(record.decideWaitingToolCalls(ApprovalAction.REJECT, DECIDED_AT)).toBe(1);

    await runCursorTurn(scenario, { threadId: "agent-answer-edit", turnSeq: 1 });
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    expect(readFileSync(file, "utf-8"), "the denied write never touched the file").toBe(before);

    const log = record.sessionEvents;
    const use = log.find((e) => e.event.case === "agentToolUse" && e.event.value.evaluatedPermission === "ask");
    expect(use, "the log holds the edit as a tool use that asked").toBeDefined();
    const useId = use!.event.case === "agentToolUse" ? use!.event.value.id : "";
    const confirmation = log.find((e) => e.event.case === "userToolConfirmation" && e.event.value.toolUseId === useId);
    expect(confirmation?.event.case === "userToolConfirmation" && confirmation.event.value.result).toBe("deny");
    const result = log.find((e) => e.event.case === "agentToolResult" && e.event.value.toolUseId === useId);
    expect(result?.event.case === "agentToolResult" && result.event.value.isError, "the edit's result is an error").toBe(true);
  });
});
