/**
 * @regression file-hitl-phase0 — pins the no-storage deny-gate exact-apply seam
 * (see _projects/2026-06/20260630.01.file-change-hitl-redesign/tasks/T01_3_regression-manifest.md)
 *
 * Deterministic integration proof of the Cursor deny-gate "what you approve is
 * what gets applied" guarantee, driven through the REAL composition and the REAL
 * deny-oracle hook — the achievable substitute for a pure-Go offline e2e, which
 * is structurally infeasible (no offline Cursor agent driver; see DD-23).
 *
 * It replays the exact chain (and ORDER) `execute-cursor/index.ts` runs on a
 * deny-gate resume, against a REAL {@link LocalWorkspaceBackend} on a temp
 * non-git workspace with NO artifact storage (the `!captureMode` branch):
 *
 *   reconstructAdjudicatedApprovals  (Phase 3, before apply)
 *     -> applyApprovedWholeFileWrites (Phase 5b3, flips applied calls COMPLETED)
 *     -> excludeAppliedFromGrants     (Phase 5c)
 *     -> buildApprovalGrants          (Phase 5c)
 *     -> the generated bash hook       (the pre-write deny-oracle)
 *
 * The order is load-bearing: `reconstructAdjudicatedApprovals` filters on
 * WAITING_APPROVAL and index.ts computes the adjudicated set ONCE (before apply
 * flips status) and never re-derives it, so `excludeAppliedFromGrants` is the
 * only thing that keeps an exact-applied write out of the grants. Seeded tool
 * calls therefore carry BOTH `args` (structured — exact-apply's whole-file
 * source) AND `argsPreview` (grant-identity source).
 *
 * The reinvocation prompt split (an applied write rendered "already applied") is
 * covered separately in build-prompt.test.ts and is NOT re-asserted here.
 *
 * Deterministic; no Cursor API key. The hook cases are skipped where bash is
 * unavailable.
 */

import { describe, it, expect, onTestFinished } from "vitest";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type {
  AgentMessage,
  ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  MessageType,
  ToolCallStatus,
  ApprovalAction,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyApprovedWholeFileWrites, excludeAppliedFromGrants } from "../exact-apply.js";
import { reconstructAdjudicatedApprovals, buildApprovalGrants } from "../approval-state.js";
import type { ApprovalGrant } from "../approval-state.js";
import { LocalWorkspaceBackend } from "../../../shared/workspace/local-backend.js";
import {
  setupCursorHookHarness,
  hasBash,
  hookWrite,
  hookShell,
} from "../__test-utils__/cursor-hook-harness.js";

const EXEC_ID = "exec-deny-gate";

// `deriveCaptureMode` (the decision that arms this deny-gate/exact-apply path) is
// truth-table-tested at its shared home: shared/filereview/__tests__/capture.test.ts.

// ── builders ─────────────────────────────────────────────────────────────────

/** A fresh temp workspace root (real disk), auto-removed at test end. */
function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "deny-gate-exact-apply-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A WAITING_APPROVAL tool call carrying BOTH the structured `args` (exact-apply
 * reads the whole-file content here) AND `argsPreview` (reconstructAdjudicated-
 * Approvals + buildApprovalGrants read grant identity here) — the fixture shape
 * index.ts sees on a deny-gate resume.
 */
function adjudicatedCall(
  id: string,
  name: string,
  args: Record<string, unknown>,
  approvalAction: ApprovalAction,
): ToolCall {
  return create(ToolCallSchema, {
    id,
    name,
    status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    approvalAction,
    args: args as JsonObject,
    argsPreview: JSON.stringify(args),
  });
}

function messagesOf(...toolCalls: ToolCall[]): AgentMessage[] {
  return [create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls })];
}

/**
 * Replay the deny-gate resume chain in the SAME ORDER index.ts runs it (see the
 * module docstring). Returns every intermediate so a test can assert on the exact
 * seam the activity wires.
 */
async function replayDenyGateResume(root: string, messages: AgentMessage[]): Promise<{
  applied: ReadonlySet<string>;
  grantApprovals: ReturnType<typeof reconstructAdjudicatedApprovals>["pendingApprovals"];
  grants: ApprovalGrant[];
}> {
  const adjudicated = reconstructAdjudicatedApprovals(messages); // Phase 3 (pre-apply)
  const applied = await applyApprovedWholeFileWrites({
    messages,
    workspaceBackend: new LocalWorkspaceBackend(root),
    workspaceDirs: [root],
    executionId: EXEC_ID,
  }); // Phase 5b3 (mutates applied calls to COMPLETED)
  const grantApprovals = excludeAppliedFromGrants(adjudicated.pendingApprovals, applied); // Phase 5c
  const grants = buildApprovalGrants(grantApprovals, adjudicated.decisions, adjudicated.contentDigests);
  return { applied, grantApprovals, grants };
}

// ── the seam (no hook / bash needed) ─────────────────────────────────────────

describe("deny-gate exact-apply seam (real LocalWorkspaceBackend, storage off)", () => {
  it("approve: writes the EXACT bytes to a root-level path, marks the tool COMPLETED, and issues NO grant for it", async () => {
    const root = tempWorkspace();
    const path = "notes.md";
    const content = "# Notes\n- Planton\n";
    const write = adjudicatedCall("tc-write", "write", { file_path: path, content }, ApprovalAction.APPROVE);

    const { applied, grantApprovals, grants } = await replayDenyGateResume(root, messagesOf(write));

    // The runner applied exactly the approved bytes to real disk...
    expect(applied).toEqual(new Set(["tc-write"]));
    expect(readFileSync(join(root, path), "utf-8")).toBe(content);
    expect(write.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    // ...and excluded it from the grants, so a further write to it will re-gate.
    expect(grantApprovals.map((pa) => pa.toolCallId)).not.toContain("tc-write");
    expect(grants).toHaveLength(0);
  });

  it("reject / undecided: applies nothing and grants nothing", async () => {
    const root = tempWorkspace();
    const rejected = adjudicatedCall("tc-rej", "write", { file_path: "drop.txt", content: "x" }, ApprovalAction.REJECT);
    const undecided = adjudicatedCall("tc-und", "write", { file_path: "maybe.txt", content: "y" }, ApprovalAction.UNSPECIFIED);

    const { applied, grants } = await replayDenyGateResume(root, messagesOf(rejected, undecided));

    expect(applied.size).toBe(0);
    expect(existsSync(join(root, "drop.txt"))).toBe(false);
    expect(existsSync(join(root, "maybe.txt"))).toBe(false);
    // A REJECT is never granted; an UNSPECIFIED never even enters the adjudicated set.
    expect(grants).toHaveLength(0);
  });

  it("safety: an approved write to a not-yet-existing subdirectory falls back (no mkdir, no partial write)", async () => {
    // LocalWorkspaceBackend created without a platformDir does not mkdir parents,
    // so exact-apply's write throws ENOENT and degrades to the grant+reinvocation
    // path — never a partial/corrupt file. This documents that pre-existing, safe
    // behavior (see the plan's out-of-scope note).
    const root = tempWorkspace();
    const nested = adjudicatedCall("tc-nested", "write", { file_path: "sub/nested.txt", content: "z" }, ApprovalAction.APPROVE);

    const { applied } = await replayDenyGateResume(root, messagesOf(nested));

    expect(applied.size).toBe(0);
    expect(existsSync(join(root, "sub"))).toBe(false);
    expect(existsSync(join(root, "sub", "nested.txt"))).toBe(false);
    // Left for the existing grant + reinvocation path.
    expect(nested.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });
});

// ── the full loop through the REAL deny-oracle hook (needs bash) ──────────────

const withBash = hasBash ? describe : describe.skip;

withBash("deny-gate exact-apply seam through the real hook", () => {
  it("re-gates a further write to the exact-applied path (DENY) while a co-approved shell still flows (ALLOW)", async () => {
    const root = tempWorkspace();
    const appliedPath = "app.ts";
    const write = adjudicatedCall("tc-write", "write", { file_path: appliedPath, content: "export const x = 1;\n" }, ApprovalAction.APPROVE);
    const shell = adjudicatedCall("tc-shell", "shell", { command: "npm test" }, ApprovalAction.APPROVE);

    const { applied, grants } = await replayDenyGateResume(root, messagesOf(write, shell));

    // The write was exact-applied and excluded; the shell (never applied) kept its grant.
    expect(applied).toEqual(new Set(["tc-write"]));
    expect(grants.map((g) => g.toolName)).toEqual(["shell"]);

    // Drive the REAL generated hook (non-git, capture off) with exactly those grants.
    const hook = setupCursorHookHarness({ grants, gitWorkspace: false, captureMode: false });

    // A further write to the exact-applied path has no grant at all -> re-gated.
    expect(hook.decide(hookWrite(appliedPath)).permission).toBe("deny");
    // The co-approved shell is allowed by its (coarse) grant.
    expect(hook.decide(hookShell("npm test")).permission).toBe("allow");
  });
});
