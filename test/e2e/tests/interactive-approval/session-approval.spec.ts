// HITL approval / live-disclosure end-to-end, made deterministic by the mock LLM
// proxy wired into the runner (STIGMER_E2E_MOCK_LLM). What this layer proves that
// the jsdom suite cannot: the web console's REAL wiring — SessionViewer ->
// useSessionPageFlow.submitApproval -> the submitApproval RPC -> the run resumes
// — plus genuine browser concerns (the orphan-vs-inline DOM split, scroll-driven
// peek bar). Determinism is from the mock, not a live model.
//
// The execution is SEEDED via the node SDK client (agent + native session +
// gated execution); the browser is used only to render and resolve the gate. The
// gated tool is the built-in `execute` (approval category `shell`), which gates
// fail-closed in EVERY stack shape with no MCP fixture or agent override. It
// deliberately is NOT `write_file`: this stack has a capture substrate (local
// artifact store), so file writes follow apply-then-review (phase-7 capture
// mode) and never gate — the file-write GATE surface lives in
// tool-card-ux.spec.ts against the file-gate stack (STIGMER_E2E_FILE_GATES).
//
// Serial + a shared single-FIFO mock queue: the project runs `--workers=1`
// (Makefile) and resets the queue per test.
import { test, expect } from "../../fixtures";
import { assertComposerEnabled } from "../../helpers/session";
import {
  MockControl,
  getMockControlUrl,
  seedGatedSession,
  shellBlock,
  awaitExecutionPhase,
  awaitExecutionTerminal,
  awaitMockRemaining,
  approveButton,
  approveAllButton,
  skipButton,
  rejectButton,
  bottomApprovalCard,
  approvalPeekBar,
  autoApproveIndicator,
  messageThread,
  type SeededGatedExecution,
} from "../../helpers/approval";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

const mockUrl = getMockControlUrl();

test.describe("HITL approval flow (deterministic mock LLM)", () => {
  // Skip cleanly unless the stack was booted in mock mode (`make test-e2e-approval`).
  test.skip(
    mockUrl === null,
    "Requires the mock-LLM stack — run via `make test-e2e-approval` (STIGMER_E2E_MOCK_LLM=1)",
  );
  // Serial (shared single-FIFO mock queue) with generous headroom: each test
  // boots a real execution to a gate and resolves it through the browser, on top
  // of first-route Next compilation.
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  const control = new MockControl(mockUrl ?? "");
  let seeded: SeededGatedExecution | null = null;

  test.afterEach(async () => {
    if (seeded) {
      await seeded.cleanup();
      seeded = null;
    }
    // Drop any turns a test left unconsumed so they can't leak into the next.
    await control.reset();
  });

  test("renders the gate inline on the tool row and Approve completes the run", async ({
    page,
    stigmerClient,
  }) => {
    seeded = await seedGatedSession(stigmerClient, control);
    await awaitExecutionPhase(
      stigmerClient,
      seeded.executionId,
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    );

    await page.goto(`/sessions/${seeded.sessionId}`);

    // The gate renders INLINE on the execute row: its decision buttons are
    // present and there is NO detached bottom approval card (a built-in tool's
    // approval has an inline home, so the orphan backstop must not duplicate it).
    await expect(approveButton(page)).toBeVisible({ timeout: 30_000 });
    await expect(skipButton(page)).toBeVisible();
    await expect(rejectButton(page)).toBeVisible();
    await expect(bottomApprovalCard(page)).toHaveCount(0);

    await approveButton(page).click();

    // The real submitApproval RPC fired and the run resumed to completion.
    const phase = await awaitExecutionTerminal(stigmerClient, seeded.executionId);
    expect(phase, "approved execution completes").toBe(ExecutionPhase.EXECUTION_COMPLETED);
    await assertComposerEnabled(page);
  });

  test("Skip resolves the gate and the run completes", async ({ page, stigmerClient }) => {
    seeded = await seedGatedSession(stigmerClient, control);
    await awaitExecutionPhase(
      stigmerClient,
      seeded.executionId,
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    );

    await page.goto(`/sessions/${seeded.sessionId}`);
    await expect(skipButton(page)).toBeVisible({ timeout: 30_000 });
    await skipButton(page).click();

    const phase = await awaitExecutionTerminal(stigmerClient, seeded.executionId);
    expect(phase, "skipped execution completes").toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });

  test("Reject resolves the gate and the run completes", async ({ page, stigmerClient }) => {
    seeded = await seedGatedSession(stigmerClient, control);
    await awaitExecutionPhase(
      stigmerClient,
      seeded.executionId,
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    );

    await page.goto(`/sessions/${seeded.sessionId}`);
    await expect(rejectButton(page)).toBeVisible({ timeout: 30_000 });
    await rejectButton(page).click();

    // REJECT fails the tool, not the run: the agent is told and continues to
    // completion (matches the conformance + Go HITL contract).
    const phase = await awaitExecutionTerminal(stigmerClient, seeded.executionId);
    expect(phase, "rejected execution still completes").toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });

  test("Approve-all clears co-pending gates and arms the auto-approve indicator", async ({
    page,
    stigmerClient,
  }) => {
    // Two execute calls in one assistant turn -> two co-pending approvals,
    // both inline. One APPROVE_ALL resolves the whole class (a run-lifetime
    // lease on the `shell` category) and flips the session-scoped
    // auto-approve preference.
    seeded = await seedGatedSession(stigmerClient, control, {
      gateBlocks: [
        shellBlock("call_all_1", "echo co-pending-one"),
        shellBlock("call_all_2", "echo co-pending-two"),
      ],
    });
    await awaitExecutionPhase(
      stigmerClient,
      seeded.executionId,
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    );

    await page.goto(`/sessions/${seeded.sessionId}`);
    // Both gates render inline (one approve-all per row); no bottom backstop.
    await expect(approveAllButton(page)).toHaveCount(2, { timeout: 30_000 });
    await expect(bottomApprovalCard(page)).toHaveCount(0);

    await approveAllButton(page).first().click();

    // The session-scoped auto-approve indicator appears (APPROVE_ALL flips it),
    // and the run completes un-gated (a plain APPROVE would have re-gated the
    // second call and never settled).
    await expect(autoApproveIndicator(page)).toBeVisible({ timeout: 15_000 });
    const phase = await awaitExecutionTerminal(stigmerClient, seeded.executionId);
    expect(phase, "approve-all completes the run un-gated").toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });

  // Sequential-gate regression backstop. Under the OSS-default memory
  // checkpointer the workflow's post-approval re-invocation replays the graph
  // from scratch (the checkpoint is recreated empty), so on resume past gate A
  // the runner used to rebuild its status from an empty proto and emit a single
  // turn-message carrying ONLY gate B — dropping gate A's committed tool-call id.
  // The append-only-at-identity guard (controller/update_status.go
  // nonTerminalTranscriptRegression) then rejected the update, and gate B landed
  // as WAITING_FOR_APPROVAL with pending_approvals_count=0 and auto-resumed with
  // no approval. The fix seeds status from the persisted transcript whenever the
  // execution already has history (execute-deep-agent/index.ts
  // shouldSeedFromPersistedTranscript), so gate B's update is a superset of gate
  // A rather than a replacement. Unit-pinned by
  // execute-deep-agent/__tests__/sequential-gate-resume.test.ts.
  test("Multi-step: approve gate A, then a fresh gate B, then the run completes", async ({
    page,
    stigmerClient,
  }) => {
    // Two SEQUENTIAL gated turns (not co-pending): command A pauses; approving
    // it resumes the run, which then calls command B and pauses again. This is
    // the resume-to-next-gate chain — the exact shape the runner's transcript
    // guard + workflow watchdog coordinate on. Scope note: this drives the
    // NATIVE deep-agent harness, not the Cursor SDK; it is a cross-stack
    // runner->guard->watchdog->UI contract backstop, not a Cursor reproduction.
    //
    // A plain APPROVE (not approve-all) is deliberate: it must NOT flip the
    // session auto-approve, so gate B re-gates rather than sailing through.
    //
    // The gate rows are keyed by distinct sentinel strings inside each command:
    // the shell row renders its command text, so the sentinel proves WHICH gate
    // is on screen (B's only renders after the resume consumed turn 2).
    const nameA = "e2e-step-a-sentinel";
    const nameB = "e2e-step-b-sentinel";
    seeded = await seedGatedSession(stigmerClient, control, {
      gateTurns: [
        [shellBlock("call_step_a", `echo ${nameA}`)],
        [shellBlock("call_step_b", `echo ${nameB}`)],
      ],
    });

    // Gate A. Mock queue depth after the runner serves turn A: [B, text] = 2.
    await awaitExecutionPhase(
      stigmerClient,
      seeded.executionId,
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    );

    await page.goto(`/sessions/${seeded.sessionId}`);
    // A's gate is inline on A's row (keyed by its distinct path), no orphan card.
    // B has not been served yet, so its row must be absent.
    await expect(page.getByText(nameA, { exact: false })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(nameB, { exact: false })).toHaveCount(0);
    await expect(approveButton(page)).toBeVisible();
    await expect(bottomApprovalCard(page)).toHaveCount(0);

    await approveButton(page).click();

    // Resume past A: the runner serves turn B, dropping the queue to [text] = 1.
    // Waiting on this deterministic signal (not the coarse phase, which has not
    // yet cleared A's gate) is what makes the next assertion target gate B.
    await awaitMockRemaining(control, 1);
    await awaitExecutionPhase(
      stigmerClient,
      seeded.executionId,
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    );

    // Gate B is now the live, inline gate — proven by B's distinct row appearing
    // (it only renders after the resume consumed turn 2).
    await expect(page.getByText(nameB, { exact: false })).toBeVisible({ timeout: 30_000 });
    await expect(approveButton(page)).toBeVisible();

    await approveButton(page).click();

    // Approving B drains the terminating text turn (queue -> 0) and the run ends.
    const phase = await awaitExecutionTerminal(stigmerClient, seeded.executionId);
    expect(phase, "second approval completes the multi-step run").toBe(
      ExecutionPhase.EXECUTION_COMPLETED,
    );
    expect(await control.remaining(), "mock script consumed exactly").toBe(0);
    await assertComposerEnabled(page);
  });

  // The peek bar is a scroll-driven affordance, so this case uses a short
  // viewport to force the thread to overflow with a single (tall, auto-expanded)
  // gated row — no dependency on extra tools dispatching.
  test.describe("peek bar", () => {
    test.use({ viewport: { width: 1000, height: 300 } });

    test("surfaces the off-screen gate and jumps back to it", async ({ page, stigmerClient }) => {
      // A tall multi-line command auto-expands the gate row past the short
      // viewport, forcing the thread to overflow (same role the 24-line file
      // content played when this spec seeded a write gate).
      const tallCommand = Array.from({ length: 24 }, (_, i) => `echo "line ${i + 1}"`).join("\n");
      seeded = await seedGatedSession(stigmerClient, control, {
        gateBlocks: [shellBlock("call_peek", tallCommand)],
      });
      await awaitExecutionPhase(
        stigmerClient,
        seeded.executionId,
        ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      );

      await page.goto(`/sessions/${seeded.sessionId}`);
      await expect(approveButton(page)).toBeVisible({ timeout: 30_000 });

      // Scroll away from the live frontier (the bottom): isFollowing flips false
      // and, with a pending approval, the peek bar takes the jump button's slot.
      await messageThread(page).evaluate((el) => {
        el.scrollTop = 0;
        el.dispatchEvent(new Event("scroll"));
      });
      await expect(approvalPeekBar(page)).toBeVisible();

      // Clicking it jumps back to the frontier, landing on the inline gate.
      await approvalPeekBar(page).click();
      await expect(approveButton(page)).toBeInViewport();

      // Resolve so the run terminates cleanly (and the queue drains).
      await approveButton(page).click();
      const phase = await awaitExecutionTerminal(stigmerClient, seeded.executionId);
      expect(phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    });
  });
});
