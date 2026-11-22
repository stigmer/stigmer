// The app's own tools in the console, end to end on the real stack with the
// mock model: a session declares a tool its app answers (`custom_tools`), the
// agent calls it, and the console's viewer (which registers no card for it)
// draws the call with the kit's own row: it says the agent waits for the
// app and offers no answer. The app's answer goes through the SDK as the
// conversation's owner; the turn resumes and ends on the agent's answer,
// with the call answered in its "How it got there" fold, and a reload
// replays the same, in order.
//
// Serial + a shared single-FIFO mock queue, as session-approval.spec.ts: the
// project runs `--workers=1` and resets the queue per test.
import { defineCustomTool } from "@stigmer/client";
import { create } from "@bufbuild/protobuf";
import { AnswerCustomToolUseInputSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  MockControl,
  getMockControlUrl,
  seedGatedSession,
  awaitRunPhase,
  awaitRunTerminal,
  approveButton,
  denyButton,
  messageThread,
  toolCallRow,
  type SeededGatedRun,
} from "../../helpers/approval";

const mockUrl = getMockControlUrl();

const REGISTER = defineCustomTool({
  name: "register_cloud_account",
  description: "Show the person the cloud account registration form, filled in.",
  inputSchema: {
    type: "object",
    properties: { account_name: { type: "string" }, auth_method: { type: "string" } },
    required: ["account_name"],
  },
});

const CALL_ID = "call_register_1";

/** Opens the finished turn's "How it got there" and finds the call there, answered: no longer waiting. */
async function expectAnsweredInFold(page: Page): Promise<void> {
  const thread = messageThread(page);
  await thread.getByRole("button", { name: /How it got there/ }).click();
  const row = toolCallRow(thread).filter({ hasText: /Register cloud account/i });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("Waiting for the app");
}

test.describe("the app's own tools in the console (deterministic mock LLM)", () => {
  test.skip(
    mockUrl === null,
    "Requires the mock-LLM stack — run via `make test-e2e-approval` (STIGMER_E2E_MOCK_LLM=1)",
  );
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

  test("a waiting call reads as waiting for the app, the SDK's answer resumes the turn, and a reload replays it", async ({
    page,
    stigmerClient,
  }) => {
    seeded = await seedGatedSession(stigmerClient, control, {
      customTools: [REGISTER],
      gateBlocks: [{ toolCallId: CALL_ID, toolName: REGISTER.name!, toolInput: { account_name: "payments-prod", auth_method: "role" } }],
      message: "Connect our payments production account.",
    });
    // A call of the app's own tools parks the run as an approval does.
    await awaitRunPhase(stigmerClient, seeded.runId, RunPhase.RUN_WAITING_FOR_APPROVAL);

    await page.goto(`/sessions/${seeded.sessionId}`);
    const thread = messageThread(page);
    const row = toolCallRow(thread).filter({ hasText: /Register cloud account/i });

    // Our own row: the step and whom it waits on, and no answer of any kind
    // (no card is registered, and an approval never answers it).
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText("Waiting for the app");
    await expect(approveButton(page)).toHaveCount(0);
    await expect(denyButton(page)).toHaveCount(0);

    // The app answers from its own side, as the conversation's owner.
    await stigmerClient.session.answerCustomToolUse(
      create(AnswerCustomToolUseInputSchema, {
        sessionId: seeded.sessionId,
        customToolUseId: `${seeded.runId}.${CALL_ID}`,
        content: [{ type: "text", text: "Registered payments-prod as acct_7Q2F" }],
      }),
    );
    const phase = await awaitRunTerminal(stigmerClient, seeded.runId);
    expect(phase, "the answered turn completes").toBe(RunPhase.RUN_COMPLETED);

    // Live: the turn ends on the agent's answer, and its steps fold under
    // "How it got there", where the call reads answered.
    await expect(thread.getByText("Done.", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expectAnsweredInFold(page);

    // Reload: the stored record replays the same, in order: the person's
    // message, the agent's answer, then the call in the fold.
    await page.reload();
    const replayed = messageThread(page);
    const asked = replayed.getByText("Connect our payments production account.", { exact: true });
    const done = replayed.getByText("Done.", { exact: true });
    await expect(done).toBeVisible({ timeout: 30_000 });
    const askedBox = await asked.boundingBox();
    const doneBox = await done.boundingBox();
    expect(askedBox !== null && doneBox !== null && askedBox.y < doneBox.y, "the person's message comes before the agent's answer").toBe(true);
    await expectAnsweredInFold(page);
  });
});
