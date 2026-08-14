import type { Page, Locator } from "@playwright/test";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { TerminateAgentExecutionInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import {
  anthropicText,
  anthropicToolUses,
  type ToolUseBlock,
} from "../fixtures/mock-llm";
import { getMockControlUrl, MockControl } from "./mock-llm-control";

// Mirrors seed-helpers.ts: the OSS single-tenant org every fixture runs in.
const DEFAULT_ORG = "default";

// The mock LLM control client moved to its own helper when the session specs
// became its second consumer (stigmer/stigmer#743); re-exported here so the
// approval specs' existing imports keep working.
export { getMockControlUrl, MockControl };

// ---------------------------------------------------------------------------
// Node-client seeding — gated AgentExecution rendered + resolved in the browser
// ---------------------------------------------------------------------------

/** A seeded execution sitting at (or heading toward) an approval gate. */
export interface SeededGatedExecution {
  readonly sessionId: string;
  readonly executionId: string;
  readonly cleanup: () => Promise<void>;
}

export interface SeedGatedSessionOptions {
  /** Org to seed in. Defaults to the OSS `default` org. */
  readonly org?: string;
  /**
   * The gated tool_use turn's blocks. Defaults to a single `write_file` call
   * (built-in, approval category `write`), which gates fail-closed in the native
   * runner with no MCP fixture or agent override. Pass two blocks to exercise
   * co-pending APPROVE_ALL.
   *
   * Shorthand for a single gated turn; mutually exclusive with `gateTurns`.
   */
  readonly gateBlocks?: ToolUseBlock[];
  /**
   * Multiple SEQUENTIAL gated tool_use turns, each served after the previous
   * gate resolves and the runner resumes. Use this for the multi-step
   * approve-A-then-B shape (one block per turn) — distinct from `gateBlocks`,
   * whose blocks are co-pending within a SINGLE turn. When set, `gateBlocks` is
   * ignored. Each turn becomes its own `WAITING_FOR_APPROVAL` gate.
   */
  readonly gateTurns?: ToolUseBlock[][];
  /** The user message that triggers the run. */
  readonly message?: string;
}

/** A single gated `write_file` block; `content` controls the inline preview height. */
export function writeFileBlock(
  toolCallId: string,
  filePath: string,
  content: string,
): ToolUseBlock {
  return { toolCallId, toolName: "write_file", toolInput: { file_path: filePath, content } };
}

/**
 * A single `execute` block (the deepagents built-in shell tool, approval
 * category `shell` — gated fail-closed in EVERY stack shape, capture substrate
 * or not). The approval-FLOW specs seed with this: since apply-then-review
 * (phase-7 capture mode) file writes no longer gate on a substrate-backed
 * stack, shell is the stable interactive-gate vehicle there. The file-write
 * GATE surface itself is pinned by tool-card-ux.spec.ts against the file-gate
 * stack (STIGMER_E2E_FILE_GATES), where writes still gate pre-execution.
 */
export function shellBlock(toolCallId: string, command: string): ToolUseBlock {
  return { toolCallId, toolName: "execute", toolInput: { command } };
}

/**
 * Seeds an agent + a NATIVE-harness session + a gated AgentExecution via the
 * node SDK client, and programs the mock LLM to drive the run to its gate.
 *
 * The browser is then used only to render and resolve the gate, so the test
 * isolates exactly the changed surface (disclosure + the SessionViewer ->
 * submitApproval wiring) from the new-session launcher's agent/model/harness
 * defaults.
 *
 * Ordering matters: the mock turns are enqueued BEFORE the execution is created,
 * because the runner begins consuming the queue the moment Temporal dispatches
 * the run. The script is N gated tool_use turns (one by default, more via
 * `gateTurns` for the multi-step shape) followed by a single terminating text
 * turn (served after the LAST gate resolves and its tool executes).
 *
 * `executionConfig` is intentionally left unset to mirror the proven conformance
 * path: the runner's default native model is anthropic, so traffic routes through
 * the mock proxy's `/v1/messages` path. Pinning a model id here would risk an
 * unresolved-registry id (the user-facing id is `claude-sonnet-4.6`, the api id
 * `claude-sonnet-4-6`) for no determinism gain.
 */
export async function seedGatedSession(
  client: Stigmer,
  control: MockControl,
  opts: SeedGatedSessionOptions = {},
): Promise<SeededGatedExecution> {
  const org = opts.org ?? DEFAULT_ORG;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  // Normalize to a single source of truth: a list of sequential gated turns.
  // `gateTurns` (multi-step) wins; else `gateBlocks` as one co-pending turn;
  // else the default single `execute` (shell) gate — the category that gates
  // fail-closed in EVERY stack shape. (A write_file default would silently
  // not gate on a capture-substrate stack, where writes apply-then-review.)
  const gateTurns: ToolUseBlock[][] =
    opts.gateTurns ??
    [opts.gateBlocks ?? [shellBlock("call_shell_1", "echo 'hello from e2e'")]];

  const agent = await client.agent.create({
    name: `e2e-approval-agent-${stamp}`,
    org,
    instructions: "You are a test assistant for the HITL approval e2e.",
  });
  const agentId = agent.metadata!.id;
  const agentInstanceId = agent.status!.defaultInstanceId;

  const session = await client.session.create({
    name: `e2e-approval-session-${stamp}`,
    org,
    agentInstanceId,
    harness: Harness.NATIVE,
  });
  const sessionId = session.metadata!.id;

  // Program the run: each gated tool_use turn in order, then the single
  // terminating text turn the agent calls for once the LAST gate resolves and
  // its tool has executed. Enqueued FIFO so the runner consumes them in sequence
  // as it pauses and resumes through each gate.
  for (const turn of gateTurns) {
    await control.enqueue(anthropicToolUses(turn));
  }
  await control.enqueue(anthropicText("Done."));

  const execution = await client.agentExecution.create({
    name: `e2e-approval-exec-${stamp}`,
    org,
    sessionId,
    message: opts.message ?? "Please write the file.",
  });
  const executionId = execution.metadata!.id;

  return {
    sessionId,
    executionId,
    cleanup: async () => {
      // A test that failed before resolving the gate leaves the execution paused
      // at the approval interrupt with a live Temporal workflow. Deleting it in
      // that state blocks (the delete waits on the still-running workflow), which
      // would hang afterEach for the full test timeout. Terminate first to drive
      // it terminal, then delete — and bound EVERY call so cleanup can never hang
      // the suite regardless of backend state.
      await withTimeout(
        client.agentExecution.terminate(
          create(TerminateAgentExecutionInputSchema, {
            id: executionId,
            reason: "e2e approval spec teardown",
          }),
        ),
        3_000,
      ).catch(() => {});
      await withTimeout(client.agentExecution.delete(executionId), 5_000).catch(() => {});
      await withTimeout(client.session.delete(sessionId), 5_000).catch(() => {});
      await withTimeout(client.agent.delete(agentId), 5_000).catch(() => {});
    },
  };
}

// ---------------------------------------------------------------------------
// Node-client seeding — ungated tool run that completes (for disclosure specs)
// ---------------------------------------------------------------------------

/** A single `read_file` block (built-in, approval category `read` — never gated). */
export function readFileBlock(toolCallId: string, filePath: string): ToolUseBlock {
  return { toolCallId, toolName: "read_file", toolInput: { file_path: filePath } };
}

export interface SeedToolRunSessionOptions {
  /** Org to seed in. Defaults to the OSS `default` org. */
  readonly org?: string;
  /**
   * SEQUENTIAL tool_use turns to run to completion. Defaults to a single
   * `write_file` turn. Every call runs un-gated because the execution is created
   * with `auto_approve_all`, so the run drives straight through to
   * `EXECUTION_COMPLETED` with no approval interrupt — the deterministic shape a
   * disclosure spec needs to assert that *settled* rows persist.
   *
   * NOTE on tool choice: the native deep-agent harness exposes the `deepagents`
   * built-ins (write_file / read_file / ls / edit_file / task); `shell` is a
   * sub-agent type, not a directly-callable tool. So the e2e exercises a
   * write/read row (the persistence guarantee is category-agnostic); the
   * shell/MCP *bounded-preview* rendering is proven exhaustively at the jsdom
   * layer, where the result shape is controllable without a live MCP fixture.
   */
  readonly toolTurns?: ToolUseBlock[][];
  /** The user message that triggers the run. */
  readonly message?: string;
}

/**
 * Seeds an agent + native session + an `auto_approve_all` AgentExecution that
 * runs the given tool turns to completion, then a terminating text turn. Sibling
 * of {@link seedGatedSession} (the seeding shape is deliberately parallel; the
 * one difference is `autoApproveAll: true` + no gate), kept separate so the
 * proven, sensitive gated path is untouched.
 *
 * The browser is then used only to assert the *rendered timeline* — that
 * completed tool rows stay visible after the run settles, rather than collapsing
 * behind a single "Ran N tools" pill.
 */
export async function seedToolRunSession(
  client: Stigmer,
  control: MockControl,
  opts: SeedToolRunSessionOptions = {},
): Promise<SeededGatedExecution> {
  const org = opts.org ?? DEFAULT_ORG;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const toolTurns: ToolUseBlock[][] =
    opts.toolTurns ??
    [[writeFileBlock("call_run_1", "/tmp/e2e-tool-run.txt", "hello from e2e")]];

  const agent = await client.agent.create({
    name: `e2e-toolrun-agent-${stamp}`,
    org,
    instructions: "You are a test assistant for the tool-disclosure e2e.",
  });
  const agentId = agent.metadata!.id;
  const agentInstanceId = agent.status!.defaultInstanceId;

  const session = await client.session.create({
    name: `e2e-toolrun-session-${stamp}`,
    org,
    agentInstanceId,
    harness: Harness.NATIVE,
  });
  const sessionId = session.metadata!.id;

  for (const turn of toolTurns) {
    await control.enqueue(anthropicToolUses(turn));
  }
  await control.enqueue(anthropicText("Done."));

  const execution = await client.agentExecution.create({
    name: `e2e-toolrun-exec-${stamp}`,
    org,
    sessionId,
    message: opts.message ?? "Please run the tools.",
    // The whole point: no gate, so the run settles deterministically and the
    // spec can assert on the COMPLETED timeline.
    autoApproveAll: true,
  });
  const executionId = execution.metadata!.id;

  return {
    sessionId,
    executionId,
    cleanup: async () => {
      await withTimeout(
        client.agentExecution.terminate(
          create(TerminateAgentExecutionInputSchema, {
            id: executionId,
            reason: "e2e tool-run spec teardown",
          }),
        ),
        3_000,
      ).catch(() => {});
      await withTimeout(client.agentExecution.delete(executionId), 5_000).catch(() => {});
      await withTimeout(client.session.delete(sessionId), 5_000).catch(() => {});
      await withTimeout(client.agent.delete(agentId), 5_000).catch(() => {});
    },
  };
}

/**
 * Resolves `p`, or rejects after `ms` — so a best-effort cleanup call against a
 * wedged backend can never block the suite. The losing promise is abandoned
 * (its eventual settlement is harmless), which is acceptable for teardown.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Execution phase polling (node client)
// ---------------------------------------------------------------------------

const TERMINAL_PHASES: ReadonlySet<ExecutionPhase> = new Set([
  ExecutionPhase.EXECUTION_COMPLETED,
  ExecutionPhase.EXECUTION_FAILED,
  ExecutionPhase.EXECUTION_CANCELLED,
  ExecutionPhase.EXECUTION_TERMINATED,
]);

/** Polls the execution until it reaches a specific phase, or throws on timeout. */
export async function awaitExecutionPhase(
  client: Stigmer,
  executionId: string,
  phase: ExecutionPhase,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  await pollExecution(
    client,
    executionId,
    (p) => p === phase,
    `phase ${ExecutionPhase[phase]}`,
    opts,
  );
}

/** Polls the execution until it reaches any terminal phase. Returns that phase. */
export async function awaitExecutionTerminal(
  client: Stigmer,
  executionId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<ExecutionPhase> {
  return pollExecution(
    client,
    executionId,
    (p) => TERMINAL_PHASES.has(p),
    "a terminal phase",
    opts,
  );
}

async function pollExecution(
  client: Stigmer,
  executionId: string,
  predicate: (phase: ExecutionPhase) => boolean,
  label: string,
  opts: { timeoutMs?: number; intervalMs?: number },
): Promise<ExecutionPhase> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let last = ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  let lastGetError: unknown;
  while (Date.now() < deadline) {
    // Bound EACH get: if the backend wedges (e.g. an execution that doesn't
    // progress to terminal after an approval), a single hung RPC must not stall
    // the deadline check — otherwise the whole poll blocks until Playwright's
    // test timeout and reports an opaque "Test timeout" with no phase context.
    // Capping the call keeps the loop honoring `timeoutMs`, so a stuck backend
    // surfaces as a fast, phase-annotated failure instead of a 90s hang.
    try {
      const exec = await withTimeout(client.agentExecution.get(executionId), 5_000);
      last = exec.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
      lastGetError = undefined;
      if (predicate(last)) return last;
    } catch (err) {
      lastGetError = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const errSuffix =
    lastGetError !== undefined
      ? ` (last get() failed: ${lastGetError instanceof Error ? lastGetError.message : String(lastGetError)})`
      : "";
  throw new Error(
    `execution ${executionId} did not reach ${label} within ${timeoutMs}ms ` +
      `(last phase: ${ExecutionPhase[last]})${errSuffix}`,
  );
}

/**
 * Polls the mock proxy's remaining queue depth until it reaches `target`.
 *
 * The proxy consumes one queued turn per LLM call the runner makes, so the depth
 * is a deterministic, cross-process progress signal driven by the runner itself
 * — not by UI timing. The multi-step spec uses it to know the runner has resumed
 * past gate A and served gate B's turn BEFORE asserting on B, which sidesteps the
 * stale-phase race (the coarse `WAITING_FOR_APPROVAL` phase has not yet cleared
 * the instant gate A is approved).
 */
export async function awaitMockRemaining(
  control: MockControl,
  target: number,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < deadline) {
    last = await control.remaining();
    if (last === target) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `mock queue did not reach ${target} remaining within ${timeoutMs}ms (last: ${last})`,
  );
}

// ---------------------------------------------------------------------------
// Approval / disclosure locators
// ---------------------------------------------------------------------------

/** The inline "Approve" button rendered on a gated tool row (and bottom card). */
export function approveButton(scope: Page | Locator): Locator {
  return scope.locator('[data-cursor-target="approve-button"]');
}

/** The inline "Approve all <class>" escalation button. */
export function approveAllButton(scope: Page | Locator): Locator {
  return scope.locator('[data-cursor-target="approve-all-button"]');
}

/** The "Skip" decision button (aria-label). */
export function skipButton(scope: Page | Locator): Locator {
  return scope.getByRole("button", { name: "Skip", exact: true });
}

/** The "Reject" decision button (aria-label). */
export function rejectButton(scope: Page | Locator): Locator {
  return scope.getByRole("button", { name: "Reject", exact: true });
}

/**
 * The DETACHED bottom approval card (the orphan backstop). An inline gate must
 * NOT produce one of these, so specs assert its count is 0 for a built-in tool.
 */
export function bottomApprovalCard(page: Page): Locator {
  return page.getByRole("alert").filter({ hasText: /Approval required for/ });
}

/** The floating "N approval(s) needed" peek bar. */
export function approvalPeekBar(page: Page): Locator {
  return page.getByRole("button", { name: /approvals? needed/ });
}

/** The session-scoped auto-approve indicator (shown after APPROVE_ALL). */
/**
 * The file-review card's bulk "Keep all" decision button. On a
 * capture-substrate stack, flowed file writes pause the run at the review
 * boundary (apply-then-review — even under `auto_approve_all`, by design:
 * capture is gate-independent), and this is the real UI that resolves it.
 */
export function fileReviewApproveButton(page: Page): Locator {
  return page.locator('[data-cursor-target="file-review-approve"]');
}

/**
 * Drive a seeded write-bearing run through its review boundary to settled:
 * wait for the apply-then-review pause, open the session, resolve the review
 * with the card's bulk "Keep all", and wait for the terminal phase. Returns
 * with the page ON the session, showing the settled timeline. Shared by the
 * disclosure and file-review specs — the canonical way a capture-stack write
 * run reaches EXECUTION_COMPLETED.
 */
export async function settleThroughFileReview(
  page: Page,
  client: Stigmer,
  seeded: SeededGatedExecution,
): Promise<void> {
  await awaitExecutionPhase(
    client,
    seeded.executionId,
    ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
  );
  await page.goto(`/sessions/${seeded.sessionId}`);
  await fileReviewApproveButton(page).click({ timeout: 30_000 });
  const phase = await awaitExecutionTerminal(client, seeded.executionId);
  if (phase !== ExecutionPhase.EXECUTION_COMPLETED) {
    throw new Error(
      `review-resolved run should complete, got ${ExecutionPhase[phase]}`,
    );
  }
}

export function autoApproveIndicator(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: /Auto-approving tool calls/ });
}

/** The scrollable message thread container. */
export function messageThread(page: Page): Locator {
  return page.getByRole("log");
}

// ---------------------------------------------------------------------------
// Tool-call disclosure locators (persistent-row timeline)
// ---------------------------------------------------------------------------

/** A persistent tool-call row in the timeline. */
export function toolCallRow(scope: Page | Locator): Locator {
  return scope.locator('[data-cursor-target="tool-call-row"]');
}

/** A folded "Read N files" run chip. */
export function toolRunGroup(scope: Page | Locator): Locator {
  return scope.locator('[data-cursor-target="tool-run-group"]');
}

/** A preview category's always-visible body (holds the diff/terminal + reveal). */
export function toolPreview(scope: Page | Locator): Locator {
  return scope.locator('[data-cursor-target="tool-preview"]');
}

/**
 * The in-place "Show more"/"Show less" reveal on a settled edit/write card's
 * bounded diff body. (The diff is the one block that uses the pixel clamp; it
 * carries the `tool-detail-expand` hook from ToolCallDetail's edit/write branch.)
 */
export function toolPreviewExpand(scope: Page | Locator): Locator {
  return scope.locator('[data-cursor-target="tool-detail-expand"]');
}

/** The in-place "Show more"/"Show less" reveal on a bounded diff body (gate, edit detail). */
export function fileDiffExpand(scope: Page | Locator): Locator {
  return scope.locator('[data-cursor-target="file-diff-expand"]');
}

/**
 * A rendered file diff — the post-execution edit/write preview/detail, or the
 * before/after diff inside an approval gate. Filename-first header + hunks.
 */
export function fileDiff(scope: Page | Locator): Locator {
  return scope.locator('[data-cursor-target="file-diff"]');
}
