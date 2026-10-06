// An agent's hooks deciding its tool calls, rendered in the web console
// against the real stack, made deterministic by the mock LLM proxy
// (STIGMER_E2E_MOCK_LLM). The agent is seeded with an inline PreToolUse hook
// in Claude Code's format, a shell-form command that prints the decision, so
// the run and the hook are real and only the model is scripted.
//
// Two shapes:
// - a hook that asks on Bash (the runner shows the native `execute` tool to a
//   hook as Claude Code's `Bash`): the gate says the agent's hook decided it,
//   and its approve-all offers to approve all of what the agent's hooks ask
//   about;
// - a hook that refuses, under `auto_approve_all`: no gate opens, the run
//   completes, and the settled call shows the hook's reason. A hook's refusal
//   binds even when every approval is skipped.
//
// Serial + a shared single-FIFO mock queue: the project runs `--workers=1` and
// resets the queue per test.
import type { HookSourceInput } from "@stigmer/sdk";
import { HookFormat } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { test, expect } from "../../fixtures";
import {
  MockControl,
  getMockControlUrl,
  approveAllButton,
  approveButton,
  awaitRunPhase,
  awaitRunTerminal,
  seedGatedSession,
  seedToolRunSession,
  shellBlock,
  type SeededGatedRun,
} from "../../helpers/approval";

const mockUrl = getMockControlUrl();

/** An inline PreToolUse hook on Bash whose command prints `decision` with `reason`. */
function bashHook(decision: "ask" | "deny", reason: string): HookSourceInput[] {
  const output = JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason },
  });
  return [
    {
      inline: {
        format: HookFormat.CLAUDE_CODE,
        groups: [{ event: "PreToolUse", matcher: "Bash", handlers: [{ command: `printf '%s' '${output}'` }] }],
      },
    },
  ];
}

test.describe("Hooks deciding tool calls (deterministic mock LLM)", () => {
  test.skip(mockUrl === null, "Requires the mock-LLM stack — run via `make test-e2e-approval` (STIGMER_E2E_MOCK_LLM=1)");
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  const control = new MockControl(mockUrl ?? "");
  let seeded: SeededGatedRun | null = null;

  test.afterEach(async () => {
    if (seeded) {
      await seeded.cleanup();
      seeded = null;
    }
    await control.reset();
  });

  test("a hook that asks: the gate names the agent's hook, and approve-all names its asks", async ({ page, stigmerClient }) => {
    seeded = await seedGatedSession(stigmerClient, control, {
      gateBlocks: [shellBlock("call_hook_ask", "echo asked-by-a-hook")],
      agentHooks: bashHook("ask", "the e2e hook wants a person to look"),
    });
    await awaitRunPhase(stigmerClient, seeded.runId, RunPhase.RUN_WAITING_FOR_APPROVAL);

    await page.goto(`/sessions/${seeded.sessionId}`);
    await expect(approveButton(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("decided by the agent's hook")).toBeVisible();
    await expect(approveAllButton(page)).toContainText("the agent's hooks ask about");

    await approveButton(page).click();
    const phase = await awaitRunTerminal(stigmerClient, seeded.runId);
    expect(phase, "approved run completes").toBe(RunPhase.RUN_COMPLETED);
  });

  test("a hook that refuses binds under auto-approve: no gate, the reason on the settled call", async ({ page, stigmerClient }) => {
    seeded = await seedToolRunSession(stigmerClient, control, {
      toolTurns: [[shellBlock("call_hook_deny", "echo refused-by-a-hook")]],
      agentHooks: bashHook("deny", "the e2e hook refuses this command"),
    });
    const phase = await awaitRunTerminal(stigmerClient, seeded.runId);
    expect(phase, "the run completes around the refusal").toBe(RunPhase.RUN_COMPLETED);

    await page.goto(`/sessions/${seeded.sessionId}`);
    await expect(page.getByText(/the e2e hook refuses this command/).first()).toBeVisible({ timeout: 30_000 });
    await expect(approveButton(page)).toHaveCount(0);
  });
});
