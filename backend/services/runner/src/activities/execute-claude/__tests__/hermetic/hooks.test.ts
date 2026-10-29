/**
 * Hermetic goldens: the agent's own hooks on a Claude turn, on the real
 * engine, run in the gate in the Stigmer harness's order (`gate.ts`,
 * `hooks.ts`), each a real command.
 *
 * One turn, one call per step, under the shell default (which would ask
 * before every command):
 *  - a delete the hook refuses never runs; its row fails with the hook's
 *    reason, naming the hook;
 *  - `ls` the hook allows runs without a card, its row stamped as the
 *    hook's decision;
 *  - a draft the hook rewrites runs as rewritten;
 *  - a call the hook asks about and also rewrites is refused, since the
 *    card would show the model's call, not the one that would run;
 *  - a publish the hook asks about waits for a person on a card with the
 *    hook's reason; approved, it runs on the resumed run, the hook asked
 *    again and the person's answer standing for it;
 *  - every call that ran carries the `PostToolUse` hook's feedback on its
 *    row under "Hook feedback:", and the model read it with the result.
 *
 * A Cursor-format hook refuses a Claude shell call by its command, as on
 * Cursor's own engine; an unattended lane skips the hook's ask with the
 * hook recorded, and nothing runs.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-claude/__tests__/hermetic/hooks.test.ts -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { HookSourceSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { HookConfigSchema, HookFormat, HookGroupSchema, HookHandlerSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { ApprovalMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, rowsGolden, rowsGoldenPath, statusGolden, type ExecutionRecord } from "../../../../__test-utils__/hermetic-activity.js";
import { ApprovalAction, ApprovalPolicySource, ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { unattendedSkipMessage } from "../../../../shared/approval-policy.js";
import { askWithRewriteMessage, hookRefusalMessage } from "../../../../shared/hooks/messages.js";
import { anthropicText, anthropicToolUses, type WireConversation, type WireScript } from "../../__test-utils__/claude-wire.js";
import { claudeExecutionRecord, claudeScenarioFile, sessionWorkspaceDir } from "../../__test-utils__/hermetic-claude.js";

/** The agent's guard, answering as Claude Code's hooks do. */
const GUARD = `#!/usr/bin/env bash
input=$(cat)
case "$input" in
  *'"command":"rm -rf'*)
    echo "recursive deletes are not allowed" >&2
    exit 2 ;;
  *'"command":"ls'*)
    printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}' ;;
  *'"command":"echo draft'*)
    printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"command":"echo draft-dry-run >> ledger.txt"}}}' ;;
  *'"command":"echo sneaky'*)
    printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","updatedInput":{"command":"echo other"}}}' ;;
  *'"command":"echo publish'*)
    printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"publishing needs a person"}}' ;;
esac
exit 0
`;

/** A Cursor-format guard on a shell command, answering as Cursor's hooks do. */
const CURSOR_GUARD = `#!/usr/bin/env bash
input=$(cat)
case "$input" in
  *'rm -rf'*) printf '%s' '{"permission":"deny","agent_message":"no deletes from a Cursor hook"}' ;;
  *) printf '%s' '{"permission":"allow"}' ;;
esac
`;

const AUDIT = `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"audited"}}'`;

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const file = claudeScenarioFile(env, clock);

/** Each step once, in order, then `closing`. */
function steps(list: readonly { readonly id: string; readonly command: string }[], closing: string): WireScript {
  return (c: WireConversation) => {
    const next = list.find((step) => !c.issued.has(step.id));
    return next === undefined
      ? anthropicText(closing)
      : anthropicToolUses([{ toolCallId: next.id, toolName: "Bash", toolInput: { command: next.command, description: next.id } }]);
  };
}

/** Write a hook script outside the workspace and give its command. */
function script(name: string, body: string): string {
  const dir = join(env.workspaceRootDir, "hook-scripts");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return `"${path}"`;
}

function claudeHooks(): ReturnType<typeof create<typeof HookSourceSchema>> {
  return create(HookSourceSchema, {
    source: {
      case: "inline",
      value: create(HookConfigSchema, {
        format: HookFormat.CLAUDE_CODE,
        groups: [
          create(HookGroupSchema, { event: "PreToolUse", matcher: "Bash", handlers: [create(HookHandlerSchema, { command: script("guard", GUARD) })] }),
          create(HookGroupSchema, { event: "PostToolUse", matcher: "Bash", handlers: [create(HookHandlerSchema, { command: AUDIT })] }),
        ],
      }),
    },
  });
}

function ledger(): string[] {
  const path = join(sessionWorkspaceDir(env), "ledger.txt");
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean) : [];
}

function phaseOf(invocation: { readonly outcome: unknown }): unknown {
  return (invocation.outcome as { value?: Record<string, unknown> }).value?.phase;
}

async function goldens(record: ExecutionRecord, name: string): Promise<void> {
  const final = record.lastFullStatus!;
  const json = statusGolden(final);
  expect(json, "no temp path reaches the status").not.toContain(env.workspaceRootDir);
  await expect(json).toMatchFileSnapshot(`./goldens/${name}.status.json`);
  await expect(rowsGolden(record.rowsOf(final))).toMatchFileSnapshot(rowsGoldenPath(`./goldens/${name}.status.json`));
  await expect(record.eventsGolden()).toMatchFileSnapshot(`./goldens/${name}.events.json`);
}

describe("ExecuteClaude hermetic — the agent's hooks", () => {
  beforeAll(() => file.start());
  afterAll(() => file.stop());

  it("refuse, allow, rewrite and ask in the gate, an ask with a rewrite refused, and feedback on every row that ran", async () => {
    const record = claudeExecutionRecord({ message: "Tidy up and publish.", hooks: [claudeHooks()] });
    const turn = steps(
      [
        { id: "toolu_rm", command: "rm -rf build" },
        { id: "toolu_ls", command: "ls" },
        { id: "toolu_draft", command: "echo draft >> ledger.txt" },
        { id: "toolu_sneaky", command: "echo sneaky >> ledger.txt" },
        { id: "toolu_publish", command: "echo publish >> ledger.txt" },
      ],
      "Published.",
    );
    expect(phaseOf(await file.run(record, turn))).toBe("RUN_WAITING_FOR_APPROVAL");

    const row = (id: string) => record.toolCalls().find((r) => r.id === id)!;
    expect([row("toolu_rm").status, row("toolu_rm").error]).toEqual([ToolCallStatus.TOOL_CALL_FAILED, hookRefusalMessage("", "recursive deletes are not allowed")]);
    expect([row("toolu_ls").status, row("toolu_ls").approvalPolicySource]).toEqual([ToolCallStatus.TOOL_CALL_COMPLETED, ApprovalPolicySource.HOOK]);
    expect(row("toolu_ls").result).toMatch(/\n\nHook feedback:\naudited$/);
    expect(row("toolu_draft").status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect([row("toolu_sneaky").status, row("toolu_sneaky").error]).toEqual([ToolCallStatus.TOOL_CALL_FAILED, askWithRewriteMessage("")]);
    const [waiting] = record.waitingToolCalls();
    expect([waiting?.id, waiting?.approvalMessage, waiting?.approvalPolicySource]).toEqual(["toolu_publish", "publishing needs a person", ApprovalPolicySource.HOOK]);
    expect(ledger(), "the draft ran as rewritten; nothing else ran").toEqual(["draft-dry-run"]);
    expect(file.wire().conversations.some((c) => c.toolResults.get("toolu_ls")?.text.includes("Hook feedback:\naudited")), "the model read the feedback with the result").toBe(true);

    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, "2026-01-01T00:00:30.000Z")).toBe(1);
    expect(phaseOf(await file.resume(record, turn, { turnSeq: 1 }))).toBe("RUN_COMPLETED");
    expect(ledger()).toEqual(["draft-dry-run", "publish"]);
    expect([row("toolu_publish").status, row("toolu_publish").approvalPolicySource]).toEqual([ToolCallStatus.TOOL_CALL_COMPLETED, ApprovalPolicySource.HOOK]);
    expect(row("toolu_publish").result).toMatch(/Hook feedback:\naudited$/);
    await goldens(record, "hooks");
  });

  it("a Cursor-format hook refuses a Claude shell call by its command", async () => {
    const cursor = create(HookSourceSchema, {
      source: {
        case: "inline",
        value: create(HookConfigSchema, {
          format: HookFormat.CURSOR,
          groups: [create(HookGroupSchema, { event: "beforeShellExecution", handlers: [create(HookHandlerSchema, { command: script("cursor-guard", CURSOR_GUARD) })] })],
        }),
      },
    });
    const record = claudeExecutionRecord({ message: "Clean the build.", hooks: [cursor], autoApproveAll: true });
    expect(phaseOf(await file.run(record, steps([{ id: "toolu_cursor_rm", command: "rm -rf build" }], "Could not.")))).toBe("RUN_COMPLETED");
    const row = record.toolCalls().find((r) => r.id === "toolu_cursor_rm")!;
    expect([row.status, row.error]).toEqual([ToolCallStatus.TOOL_CALL_FAILED, hookRefusalMessage("", "no deletes from a Cursor hook")]);
  });

  it("an unattended lane skips the hook's ask, the hook recorded, and nothing runs", async () => {
    const record = claudeExecutionRecord({ message: "Publish.", hooks: [claudeHooks()], approvalMode: ApprovalMode.UNATTENDED });
    expect(phaseOf(await file.run(record, steps([{ id: "toolu_skip", command: "echo publish >> ledger.txt" }], "Skipped.")))).toBe("RUN_COMPLETED");
    const row = record.toolCalls().find((r) => r.id === "toolu_skip")!;
    expect([row.status, row.approvalPolicySource]).toEqual([ToolCallStatus.TOOL_CALL_SKIPPED, ApprovalPolicySource.UNATTENDED_SKIP]);
    expect(file.wire().conversations.at(-1)!.toolResults.get("toolu_skip")?.text).toContain(unattendedSkipMessage("Bash"));
    expect(ledger()).toEqual([]);
  });
});
