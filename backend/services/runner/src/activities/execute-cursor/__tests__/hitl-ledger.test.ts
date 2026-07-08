/**
 * @regression file-hitl-phase0 — pins file-edit HITL fixes #1, #2, #3, #5 (see _projects/2026-06/20260630.01.file-change-hitl-redesign/tasks/T01_3_regression-manifest.md)
 *
 * Unit tests for the Cursor-harness HITL denial-ledger flow.
 *
 * These cover the architecture the platform converges on: the preToolUse hook
 * records denials to a ledger, the runner marks the gated tool calls
 * WAITING_APPROVAL, and the backend projects pending_approvals from that
 * tool-call status. The tests are deterministic and need no Cursor API key.
 *
 * Specifically they pin:
 * - the denial ledger reset/read contract (per-turn freshness, tolerant parse)
 * - token-correlated overlay of WAITING_APPROVAL onto streamed tool calls,
 *   INCLUDING the regression where a denied tool was reported as "completed"
 *   (the green-checkmark bug) — it must become WAITING_APPROVAL, not success
 * - the gate's before-reading diff capture: a whole-file rewrite renders a true
 *   before/after, an edit renders a HUNK — via the shared gate-file-change builder
 * - in-place collapse of a same-turn duplicate denial twin (one card, not two)
 * - synthesis of a tool call when a denial produced no stream event
 * - reconstruction of adjudicated approvals from tool calls on reinvocation
 *   (pending_approvals is empty by then because the backend cleared it)
 * - the generated hook script wiring (records denials in both deny branches)
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type {
  AgentMessage,
  ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  MessageType,
  ToolCallStatus,
  ApprovalAction,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import {
  resetDenialLedger,
  readDenialLedger,
  denialLedgerPath,
  reconstructAdjudicatedApprovals,
  buildApprovalGrants,
  grantToken,
  watchDenialLedger,
  approvalDenials,
  denialKindOf,
} from "../approval-state.js";
import {
  reconcileDeniedToolCalls,
  clearProvisionalPostDenialNarration,
  collapseRedundantToolCallTwins,
  toolCallIdentityToken,
  detectUnattributedHookBlocks,
  HOOK_BLOCK_ERROR_MARKERS,
} from "../message-translator.js";
import { mockWorkspaceBackend } from "../../../__test-utils__/mock-workspace.js";
import type { WorkspaceBackend } from "../../../shared/workspace/types.js";
import { generateHookScript } from "../hook-script.js";
import type { MergedToolPolicy } from "../approval-policy.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "hitl-ledger-"));
  tempDirs.push(dir);
  return dir;
}

// The gate now reads each denied file's pre-edit `before` from a WorkspaceBackend
// (the tool was denied, so disk still holds the old content). These fakes back
// the two reads the gate uses (exists/readFile) from an in-memory map so the
// before/after capture is deterministic with no real IO. Rooted at "/root" so the
// existing absolute-path assertions hold.
const ROOT = "/root";

/** A backend whose files are absent (rooted at ROOT for path assertions). */
function rootBackend(): WorkspaceBackend {
  return mockWorkspaceBackend({ rootDir: ROOT });
}

// Stream tool calls use the lowercase SDK taxonomy (edit/shell/delete); the
// denial ledger uses the hook taxonomy (Write/Shell/Delete) + a canonical
// category+salient token. The two correlate via approvalCategory — that cross-
// taxonomy match is exactly what these tests pin.
function toolCall(overrides: MessageInitShape<typeof ToolCallSchema>): ToolCall {
  return create(ToolCallSchema, {
    id: "call-1",
    name: "edit",
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    ...overrides,
  });
}

function aiMessageWith(toolCalls: ToolCall[]): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "",
    toolCalls,
  });
}

describe("denial ledger reset/read", () => {
  it("reset creates an empty ledger that reads as no denials", async () => {
    const ws = makeWorkspace();
    const path = await resetDenialLedger(ws);
    expect(path).toBe(denialLedgerPath(ws));
    expect(await readDenialLedger(ws)).toEqual([]);
  });

  it("returns no denials when the ledger file does not exist", async () => {
    const ws = makeWorkspace();
    expect(await readDenialLedger(ws)).toEqual([]);
  });

  it("parses appended JSONL denials and tolerates blank/partial lines", async () => {
    const ws = makeWorkspace();
    await resetDenialLedger(ws);
    const writeToken = grantToken("write", "gated.txt");
    const shellToken = grantToken("shell", "rm -rf build");
    // Simulate the hook appending records, including a trailing partial line.
    await writeFile(
      denialLedgerPath(ws),
      `{"toolName":"Write","token":"${writeToken}"}\n` +
        `\n` +
        `{"toolName":"Shell","token":"${shellToken}"}\n` +
        `{"toolName":"Partial","tok`,
      "utf-8",
    );

    const entries = await readDenialLedger(ws);
    expect(entries).toEqual([
      { toolName: "Write", token: writeToken },
      { toolName: "Shell", token: shellToken },
    ]);
  });

  it("decodes the base64 tool_input the hook captures, tolerating absence and garbage", async () => {
    const ws = makeWorkspace();
    await resetDenialLedger(ws);
    const token = grantToken("write", "notes.md");
    const input = { path: "notes.md", contents: "# Notes\n" };
    const inputB64 = Buffer.from(JSON.stringify(input), "utf-8").toString("base64");
    await writeFile(
      denialLedgerPath(ws),
      // 1) full capture, 2) no input field (grep fallback), 3) garbage input.
      `{"toolName":"Write","token":"${token}","input":"${inputB64}"}\n` +
        `{"toolName":"Write","token":"${grantToken("write", "b.txt")}"}\n` +
        `{"toolName":"Write","token":"${grantToken("write", "c.txt")}","input":"!!!not-base64!!!"}\n`,
      "utf-8",
    );

    const entries = await readDenialLedger(ws);
    expect(entries).toHaveLength(3);
    expect(entries[0].input).toEqual(input);
    expect(entries[1].input).toBeUndefined();
    expect(entries[2].input).toBeUndefined();
  });

  it("parses the kind tag, defaulting an absent/garbled kind to approval", async () => {
    const ws = makeWorkspace();
    await resetDenialLedger(ws);
    await writeFile(
      denialLedgerPath(ws),
      // 1) pre-kind format (no kind field), 2) explicit approval, 3) secret,
      // 4) garbled kind (non-string), 5) unknown future kind.
      `{"toolName":"Write","token":"${grantToken("write", "a.txt")}"}\n` +
        `{"toolName":"Shell","token":"${grantToken("shell", "rm x")}","kind":"approval"}\n` +
        `{"toolName":"Write","token":"${grantToken("write", ".env")}","kind":"secret"}\n` +
        `{"toolName":"Write","token":"${grantToken("write", "b.txt")}","kind":42}\n` +
        `{"toolName":"Write","token":"${grantToken("write", "c.txt")}","kind":"quarantine"}\n`,
      "utf-8",
    );

    const entries = await readDenialLedger(ws);
    expect(entries.map((e) => denialKindOf(e))).toEqual([
      "approval", // absent → the pre-kind format
      "approval",
      "secret",
      "approval", // garbled (non-string) degrades to approval
      "quarantine", // an unknown kind is preserved, not coerced
    ]);
  });

  it("approvalDenials selects only the entries allowed to pause the run", async () => {
    const ws = makeWorkspace();
    await resetDenialLedger(ws);
    await writeFile(
      denialLedgerPath(ws),
      `{"toolName":"Write","token":"${grantToken("write", "a.txt")}","kind":"approval"}\n` +
        `{"toolName":"Write","token":"${grantToken("write", ".env")}","kind":"secret"}\n` +
        `{"toolName":"Write","token":"${grantToken("write", "app.log")}","kind":"capture-error"}\n` +
        `{"toolName":"Write","token":"${grantToken("write", "b.txt")}","kind":"fail-closed"}\n` +
        // Pre-kind format counts as approval; an unknown kind must NOT pause.
        `{"toolName":"Shell","token":"${grantToken("shell", "rm x")}"}\n` +
        `{"toolName":"Write","token":"${grantToken("write", "c.txt")}","kind":"quarantine"}\n`,
      "utf-8",
    );

    const entries = await readDenialLedger(ws);
    expect(entries).toHaveLength(6);
    expect(approvalDenials(entries).map((e) => e.token)).toEqual([
      grantToken("write", "a.txt"),
      grantToken("shell", "rm x"),
    ]);
  });
});

describe("reconcileDeniedToolCalls", () => {
  it("overlays WAITING_APPROVAL onto the REAL denied tool reported as completed (the green-check bug)", async () => {
    // Stream reports the file mutation as `edit` (RUNNING/COMPLETED); the hook
    // denied it as `Write`. The category+salient token bridges the two so the
    // overlay lands on this exact streamed tool call — no synthesized placeholder.
    const tc = toolCall({
      id: "c1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      completedAt: "2026-06-07T00:00:00Z",
      result: "wrote file",
      args: { path: "gated.txt" },
      argsPreview: JSON.stringify({ path: "gated.txt" }),
    });
    const messages = [aiMessageWith([tc])];

    const reconciled = await reconcileDeniedToolCalls(messages, [
      { toolName: "Write", token: grantToken("write", "gated.txt") },
    ]);

    expect(reconciled).toHaveLength(1);
    // The overlay marked the REAL streamed tool call — no synthesized placeholder
    // and no orphan was appended.
    expect(reconciled[0]).toBe(tc);
    expect(messages[0].toolCalls).toHaveLength(1);
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(tc.requiresApproval).toBe(true);
    expect(tc.approvalMessage).toContain("gated.txt");
    expect(tc.approvalRequestedAt).not.toBe("");
    // The tool never actually ran — terminal/result fields must be cleared so the
    // UI does not render it as a completed success.
    expect(tc.completedAt).toBe("");
    expect(tc.result).toBe("");
    expect(tc.error).toBe("");
  });

  it("resolves the MCP policy message for a denied MCP tool", async () => {
    const tc = toolCall({
      id: "c1",
      name: "apply_x",
      mcpServerSlug: "planton",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
    });
    const messages = [aiMessageWith([tc])];
    const policies = new Map<string, MergedToolPolicy>([
      ["planton/apply_x", {
        toolName: "apply_x",
        mcpServerSlug: "planton",
        requiresApproval: true,
        approvalMessage: "Apply infrastructure change",
        source: "classifier_default",
      }],
    ]);

    // MCP tools are keyed name-only (their name is consistent across layers).
    await reconcileDeniedToolCalls(messages, [
      { toolName: "apply_x", token: grantToken("apply_x", "") },
    ], policies);

    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(tc.approvalMessage).toBe("Apply infrastructure change");
  });

  it("leaves non-denied tool calls untouched while overlaying the denied one", async () => {
    const denied = toolCall({
      id: "c1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { path: "gated.txt" },
    });
    const allowed = toolCall({
      id: "c2",
      name: "read",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { path: "readme.md" },
    });
    const messages = [aiMessageWith([denied, allowed])];

    const reconciled = await reconcileDeniedToolCalls(messages, [
      { toolName: "Write", token: grantToken("write", "gated.txt") },
    ]);

    // Only the denied call is gated; the read-only call keeps its status and no
    // spurious approval is synthesized (the ledger token matched a real call).
    expect(reconciled).toHaveLength(1);
    expect(denied.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(allowed.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(messages[0].toolCalls).toHaveLength(2);
  });

  it("collapses repeated same-resource denials to one gate and one hidden twin", async () => {
    // Two completed-but-denied edits of the same file (the green-check duplicate).
    // The first becomes the single gate; the second is a content-less twin that
    // must be collapsed IN PLACE to a hidden SKIPPED row, not left as a second
    // settled card. Neither carries file_changes, so the collapse is safe.
    const first = toolCall({ id: "c1", name: "edit", args: { path: "gated.txt" } });
    const second = toolCall({ id: "c2", name: "edit", args: { path: "gated.txt" } });
    const messages = [aiMessageWith([first, second])];

    const reconciled = await reconcileDeniedToolCalls(messages, [
      { toolName: "Write", token: grantToken("write", "gated.txt") },
    ]);

    // One approval anchor (so the backend gate resolves cleanly on one decision).
    expect(reconciled).toHaveLength(1);
    expect(first.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    // The twin is collapsed in place: SKIPPED, content-less, no approval — the SDK
    // hides it (isCollapsedToolCall), so one resource renders one card. Its id is
    // preserved, so the backend append-only guard accepts the finalize.
    expect(second.id).toBe("c2");
    expect(second.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(second.requiresApproval).toBe(false);
    expect(second.argsPreview).toBe("");
    expect(second.error).toBe("");
    expect(second.result).toBe("");
  });

  it("synthesizes a WAITING_APPROVAL tool call when a denial produced no stream event", async () => {
    const messages = [aiMessageWith([])];

    const reconciled = await reconcileDeniedToolCalls(messages, [
      { toolName: "Shell", token: grantToken("shell", "rm -rf build") },
    ]);

    expect(reconciled).toHaveLength(1);
    const synthesized = messages[0].toolCalls[0];
    expect(synthesized.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(synthesized.requiresApproval).toBe(true);
    // The synthesized fallback shows the hook's raw tool name for display...
    expect(synthesized.name).toBe("Shell");
    expect(synthesized.approvalMessage).toContain("rm -rf build");
    // ...and carries the salient so the grant rebuilt from it keys on the same
    // resource the hook will see on the re-attempt.
    expect(synthesized.argsPreview).toContain("rm -rf build");
  });

  it("is a no-op when the ledger is empty", async () => {
    const tc = toolCall({ id: "c1", status: ToolCallStatus.TOOL_CALL_COMPLETED });
    const messages = [aiMessageWith([tc])];
    expect(await reconcileDeniedToolCalls(messages, [])).toEqual([]);
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });
});

// One resource emitted twice in a turn produced two cards: the gate plus a
// settled "No preview available" twin. The runner collapses that twin in place
// (it cannot drop the committed id) to a hidden SKIPPED row. These pin the
// collapse and its safety guard (a twin carrying its own change is never hidden).
describe("reconcileDeniedToolCalls — duplicate denial-twin collapse", () => {
  it("collapses a same-resource FAILED twin beside the overlaid gate", async () => {
    const gate = toolCall({
      id: "stream-1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "notes.md", old_string: "a", new_string: "b" },
      argsPreview: JSON.stringify({ path: "notes.md" }),
    });
    const twin = toolCall({
      id: "stream-2",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      error: "blocked by a hook",
      args: { path: "notes.md", old_string: "a", new_string: "b" },
      argsPreview: JSON.stringify({ path: "notes.md" }),
    });
    const messages = [aiMessageWith([gate, twin])];

    const reconciled = await reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Write", token: grantToken("write", "notes.md") }],
      undefined,
      rootBackend(),
    );

    // Exactly one gate; both committed ids are preserved (append-only).
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].id).toBe("stream-1");
    expect(messages[0].toolCalls.map((t) => t.id)).toEqual(["stream-1", "stream-2"]);

    expect(gate.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    // The twin is collapsed to a hidden SKIPPED row.
    expect(twin.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(twin.requiresApproval).toBe(false);
    expect(twin.error).toBe("");
    expect(twin.argsPreview).toBe("");
  });

  it("collapses a same-command SHELL twin too (the collapse is tool-agnostic, not edit-only)", async () => {
    // The duplicate is keyed on the identity token, so it folds for any gated
    // tool family — shell here, exercising the same collapse a delete or MCP twin
    // would receive. Both attempts at the same command were denied.
    const gate = toolCall({
      id: "sh-1",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { command: "rm -rf build" },
      argsPreview: JSON.stringify({ command: "rm -rf build" }),
    });
    const twin = toolCall({
      id: "sh-2",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      error: "blocked by a hook",
      args: { command: "rm -rf build" },
      argsPreview: JSON.stringify({ command: "rm -rf build" }),
    });
    const messages = [aiMessageWith([gate, twin])];

    const reconciled = await reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Shell", token: grantToken("shell", "rm -rf build") }],
      undefined,
      rootBackend(),
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].id).toBe("sh-1");
    expect(gate.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(twin.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(twin.requiresApproval).toBe(false);
    expect(twin.argsPreview).toBe("");
  });

  it("one gate per turn: surfaces the anchor (first denied) and defers a DISTINCT co-pending sibling", async () => {
    // Two edits to DIFFERENT files denied in one turn. Under the Cursor deny-only
    // one-gate-per-turn contract the FIRST denial (ledger[0] = a.md) is the single
    // surfaced gate; the distinct sibling b.md is blanked to a hidden SKIPPED row
    // and re-attempted (and re-gated) on the next turn — sequential gating, not a
    // lost intent. (The native harness keeps full in-turn co-pending; this rule is
    // cursor-only.)
    const gateA = toolCall({
      id: "edit-a",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "a.md", old_string: "1", new_string: "2" },
      argsPreview: JSON.stringify({ path: "a.md" }),
    });
    const gateB = toolCall({
      id: "edit-b",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "b.md", old_string: "3", new_string: "4" },
      argsPreview: JSON.stringify({ path: "b.md" }),
    });
    const messages = [aiMessageWith([gateA, gateB])];

    const reconciled = await reconcileDeniedToolCalls(
      messages,
      [
        // The hook records the content-exact token for an edit (its primary token).
        { toolName: "Write", token: toolCallIdentityToken(gateA) },
        { toolName: "Write", token: toolCallIdentityToken(gateB) },
      ],
      undefined,
      rootBackend(),
    );

    // Exactly one gate (the anchor); the sibling is hidden, not a second card.
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].id).toBe("edit-a");
    expect(gateA.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(gateB.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(gateB.requiresApproval).toBe(false);
    expect(gateB.argsPreview).toBe("");
  });

  it("collapses a same-path denied write twin onto the single gate (file rows carry no diff)", async () => {
    // Under apply-then-review a file row never carries an authoritative change (it
    // lives in the ledger), so a same-path denied write twin — even a distinct
    // edit — collapses onto the one gate (one gate per turn per resource).
    const gate = toolCall({
      id: "stream-1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "notes.md", old_string: "a", new_string: "b" },
    });
    const twin = toolCall({
      id: "stream-2",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "notes.md", old_string: "c", new_string: "d" },
    });
    const messages = [aiMessageWith([gate, twin])];

    await reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Write", token: grantToken("write", "notes.md") }],
      undefined,
      rootBackend(),
    );

    expect(gate.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(twin.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
  });
});

// One gate per turn (the H-F deny-only clean pause). When a denied edit is
// followed by a DIFFERENT-identity workaround (the classic `shell: cat > file`
// bypass) the first-denial stop races the SDK's auto-execution, so both denials
// can land in the ledger. The reconcile anchors on the FIRST denial and blanks
// every other denied identity to a hidden SKIPPED row — one card for one intent,
// regardless of whether the two calls share an assistant message. These pin the
// production shape (exec aex_01kw4p0cqgk0j8vvxbs5t8gv59: edit + shell in ONE
// message, no narration between them) that no positional or same-identity rule
// could fix.
describe("reconcileDeniedToolCalls — one gate per turn (deny-only workaround)", () => {
  it("collapses the edit+shell workaround in the SAME message to one gate (the production bug)", async () => {
    // edit notes.md (denied) then shell `cat > notes.md` (denied, reported as a
    // success by Cursor) — both attached to ONE AgentMessage with no narration
    // between, exactly as captured in production. The edit is the anchor; the
    // shell is a post-denial reaction and must be hidden, not a second card.
    const edit = toolCall({
      id: "edit-1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "notes.md", old_string: "", new_string: "hi" },
      argsPreview: JSON.stringify({ path: "notes.md" }),
    });
    const shell = toolCall({
      id: "shell-1",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: '""', // denied-reported-as-success degenerate result
      args: { command: "cat > notes.md" },
      argsPreview: JSON.stringify({ command: "cat > notes.md" }),
    });
    const messages = [aiMessageWith([edit, shell])];

    const reconciled = await reconcileDeniedToolCalls(
      messages,
      [
        { toolName: "Write", token: grantToken("write", "notes.md") },
        { toolName: "Shell", token: grantToken("shell", "cat > notes.md") },
      ],
      undefined,
      rootBackend(),
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].id).toBe("edit-1");
    expect(edit.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    // The workaround is hidden (SKIPPED), never surfaced, never COMPLETED.
    expect(shell.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(shell.requiresApproval).toBe(false);
    expect(shell.result).toBe("");
    expect(shell.argsPreview).toBe("");
    // Both ids are preserved in place (append-only finalize).
    expect(messages[0].toolCalls.map((t) => t.id)).toEqual(["edit-1", "shell-1"]);
  });

  it("collapses the workaround even when the shell lands in a LATER message (narration case)", async () => {
    // The narration variant: a new AgentMessage starts between the two tools.
    // The rule is identity/ledger-based, not positional, so the outcome matches
    // the same-message case above — proving it is robust to message segmentation.
    const edit = toolCall({
      id: "edit-1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "notes.md", old_string: "", new_string: "hi" },
      argsPreview: JSON.stringify({ path: "notes.md" }),
    });
    const shell = toolCall({
      id: "shell-1",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      error: "blocked by a hook",
      args: { command: "cat > notes.md" },
      argsPreview: JSON.stringify({ command: "cat > notes.md" }),
    });
    const messages = [aiMessageWith([edit]), aiMessageWith([shell])];

    const reconciled = await reconcileDeniedToolCalls(
      messages,
      [
        { toolName: "Write", token: grantToken("write", "notes.md") },
        { toolName: "Shell", token: grantToken("shell", "cat > notes.md") },
      ],
      undefined,
      rootBackend(),
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].id).toBe("edit-1");
    expect(edit.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(shell.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
  });

  it("anchors on the FIRST denial by ledger order (shell first -> shell is the gate)", async () => {
    // The anchor is the first denial of the turn, whatever its family. Here the
    // shell was denied first, so it is the surfaced gate and the later edit is
    // the deferred sibling.
    const shell = toolCall({
      id: "shell-1",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { command: "echo hi > notes.md" },
      argsPreview: JSON.stringify({ command: "echo hi > notes.md" }),
    });
    const edit = toolCall({
      id: "edit-1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "notes.md", old_string: "", new_string: "hi" },
      argsPreview: JSON.stringify({ path: "notes.md" }),
    });
    const messages = [aiMessageWith([shell, edit])];

    const reconciled = await reconcileDeniedToolCalls(
      messages,
      [
        { toolName: "Shell", token: toolCallIdentityToken(shell) },
        { toolName: "Write", token: toolCallIdentityToken(edit) },
      ],
      undefined,
      rootBackend(),
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].id).toBe("shell-1");
    expect(shell.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(edit.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
  });

  it("anchors an MCP gate and collapses a built-in reaction", async () => {
    // The anchor can be an MCP tool; a built-in workaround denied in the same
    // turn is still the deferred sibling.
    const mcp = toolCall({
      id: "mcp-1",
      name: "fetch",
      mcpServerSlug: "web",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      argsPreview: JSON.stringify({ url: "https://x" }),
    });
    const edit = toolCall({
      id: "edit-1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "notes.md", old_string: "", new_string: "hi" },
      argsPreview: JSON.stringify({ path: "notes.md" }),
    });
    const messages = [aiMessageWith([mcp, edit])];

    const reconciled = await reconcileDeniedToolCalls(
      messages,
      [
        { toolName: "fetch", token: toolCallIdentityToken(mcp) },
        { toolName: "Write", token: toolCallIdentityToken(edit) },
      ],
      undefined,
      rootBackend(),
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].id).toBe("mcp-1");
    expect(mcp.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(edit.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
  });

  it("regression lock: a lone denial is unchanged (one gate, nothing collapsed)", async () => {
    const edit = toolCall({
      id: "edit-1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "notes.md", old_string: "", new_string: "hi" },
      argsPreview: JSON.stringify({ path: "notes.md" }),
    });
    const messages = [aiMessageWith([edit])];

    const reconciled = await reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Write", token: grantToken("write", "notes.md") }],
      undefined,
      rootBackend(),
    );

    expect(reconciled).toHaveLength(1);
    expect(edit.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });

  it("round-trip: approving the anchor never grants the collapsed workaround", async () => {
    // After the user approves the surfaced gate, the grant set keys only on the
    // original write — the shell, hidden as SKIPPED, never becomes a pending
    // approval and so can never be granted (approving the write != approving the
    // shell). This is the safety property the duplicate cards used to violate.
    const edit = toolCall({
      id: "edit-1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "notes.md", old_string: "", new_string: "hi" },
      argsPreview: JSON.stringify({ path: "notes.md" }),
    });
    const shell = toolCall({
      id: "shell-1",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: '""',
      args: { command: "cat > notes.md" },
      argsPreview: JSON.stringify({ command: "cat > notes.md" }),
    });
    const messages = [aiMessageWith([edit, shell])];

    const reconciled = await reconcileDeniedToolCalls(
      messages,
      [
        { toolName: "Write", token: grantToken("write", "notes.md") },
        { toolName: "Shell", token: grantToken("shell", "cat > notes.md") },
      ],
      undefined,
      rootBackend(),
    );

    // The backend projects pending approvals from WAITING_APPROVAL tool calls —
    // only the anchor qualifies. Simulate the user approving every surfaced gate.
    const pendingApprovals = reconciled.map((tc) =>
      create(PendingApprovalSchema, {
        toolCallId: tc.id,
        toolName: tc.name,
        mcpServerSlug: tc.mcpServerSlug,
        argsPreview: tc.argsPreview,
      }),
    );
    const decisions = new Map(
      pendingApprovals.map((pa) => [pa.toolCallId, ApprovalAction.APPROVE]),
    );
    const grants = buildApprovalGrants(pendingApprovals, decisions);
    const grantTokens = grants.map((g) => grantToken(g.key, g.salient));

    expect(grantTokens).toContain(grantToken("write", "notes.md"));
    expect(grantTokens).not.toContain(grantToken("shell", "cat > notes.md"));
  });
});

// The terminal/resume path has no denial ledger (the tool is already granted), so
// reconcileDeniedToolCalls never runs. The shared routine runs directly at the
// terminal finalize and must collapse the duplicate-edit shapes observed in
// production data while preserving genuine distinct work and every non-file tool.
describe("reconcileDeniedToolCalls — interrupted non-terminal rows (raced workaround)", () => {
  function aiText(content: string): AgentMessage {
    return create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content });
  }
  function thinking(content: string): AgentMessage {
    return create(AgentMessageSchema, { type: MessageType.MESSAGE_THINKING, content });
  }

  it("collapses a workaround stuck RUNNING whose denial never reached the ledger, and the redaction then blanks the whole reaction block (production shape aex_01kwj07f7g23c3wp9sn8496z5g)", async () => {
    // The forensic transcript: the anchor shell was denied (ledger entry), the
    // model reacted with thinking + narration + a python-write shell workaround,
    // and the run.cancel() landed before the workaround's own hook denial
    // reached the ledger read — so the token-scoped collapse could not see it.
    // It persisted as RUNNING + requiresApproval forever, and its tool-bearing
    // message stopped the narration redaction from blanking anything.
    const seqCommand = "for i in $(seq 1 5000); do echo line $i; done > big.txt";
    const anchor = toolCall({
      id: "shell-anchor",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { command: seqCommand },
      argsPreview: JSON.stringify({ command: seqCommand }),
      requiresApproval: true,
    });
    const workaround = toolCall({
      id: "shell-workaround",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_RUNNING,
      args: { command: "python3 -c \"open('big.txt','w').write('...')\"" },
      argsPreview: JSON.stringify({ command: "python3 -c ..." }),
      requiresApproval: true,
    });
    const narration = aiText("Generating the file with a script since the shell command needs approval.");
    narration.toolCalls = [workaround];
    const messages: AgentMessage[] = [
      aiMessageWith([anchor]),
      thinking("Shell commands were blocked. The Write tool will be used instead."),
      narration,
    ];

    // Only the anchor's denial is in the ledger — the workaround's raced it.
    const reconciled = await reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Shell", token: toolCallIdentityToken(anchor) }],
      undefined,
      rootBackend(),
    );

    expect(reconciled).toHaveLength(1);
    expect(anchor.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    // The interrupted workaround is finalized to the hidden SKIPPED shape —
    // never an eternal spinner, never a second approval card.
    expect(workaround.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(workaround.requiresApproval).toBe(false);
    expect(workaround.args).toBeUndefined();

    // With the workaround hidden, its message is trailing narration again and
    // the whole reaction block blanks — thinking included.
    const redacted = clearProvisionalPostDenialNarration(messages, reconciled);
    expect(redacted).toHaveLength(2);
    expect(messages[1].content).toBe("");
    expect(messages[2].content).toBe("");
    // Ids preserved in place (append-only finalize).
    expect(messages[2].toolCalls.map((t) => t.id)).toEqual(["shell-workaround"]);
  });

  it("leaves terminal rows untouched: a completed tool after the gate is real activity and still stops the redaction walk", async () => {
    const anchor = toolCall({
      id: "shell-anchor",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { command: "rm -rf build" },
      argsPreview: JSON.stringify({ command: "rm -rf build" }),
    });
    const completedRead = toolCall({
      id: "read-1",
      name: "read",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: "file contents",
      args: { path: "a.txt" },
    });
    const readMsg = aiMessageWith([completedRead]);
    const messages: AgentMessage[] = [
      aiMessageWith([anchor]),
      readMsg,
      create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content: "trailing reaction" }),
    ];

    const reconciled = await reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Shell", token: toolCallIdentityToken(anchor) }],
      undefined,
      rootBackend(),
    );

    // The completed read is terminal — the interrupted-row sweep never touches it.
    expect(completedRead.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(completedRead.result).toBe("file contents");

    // And as a VISIBLE tool-bearing message it bounds the redaction: only the
    // text after it blanks.
    const redacted = clearProvisionalPostDenialNarration(messages, reconciled);
    expect(redacted).toHaveLength(1);
    expect(messages[2].content).toBe("");
    expect(readMsg.toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });
});

describe("collapseRedundantToolCallTwins — terminal-path twin collapse", () => {
  function completedEdit(id: string, path: string): ToolCall {
    return toolCall({
      id,
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { path },
      argsPreview: JSON.stringify({ path }),
      result: "success",
    });
  }

  function bareEdit(id: string, path: string, overrides: MessageInitShape<typeof ToolCallSchema> = {}): ToolCall {
    return toolCall({
      id,
      name: "edit",
      args: { path },
      argsPreview: JSON.stringify({ path }),
      ...overrides,
    });
  }

  it("collapses a stuck RUNNING twin beside the settled COMPLETED edit (the screenshot)", () => {
    const settled = completedEdit("tool-approved", "notes.md");
    const zombie = bareEdit("tool-zombie", "notes.md", {
      status: ToolCallStatus.TOOL_CALL_RUNNING,
    });
    const messages = [aiMessageWith([settled, zombie])];

    const collapsed = collapseRedundantToolCallTwins(messages);

    expect(collapsed).toBe(1);
    // The settled attempt is the survivor (terminal preferred over the zombie).
    expect(settled.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(zombie.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(zombie.requiresApproval).toBe(false);
    expect(zombie.argsPreview).toBe("");
    // Both committed ids are preserved (append-only by construction).
    expect(messages[0].toolCalls.map((t) => t.id)).toEqual(["tool-approved", "tool-zombie"]);
  });

  it("keeps exactly one representative when every attempt produced no change", () => {
    // Two COMPLETED edits to one path, neither carrying a diff (both the empty-
    // result green-check). No diff-carrier and no gate — keep one card, hide the
    // rest, so the resource never renders as a duplicate.
    const first = bareEdit("tool-a", "notes.md", {
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: '""',
    });
    const second = bareEdit("tool-b", "notes.md", {
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: '""',
    });
    const messages = [aiMessageWith([first, second])];

    const collapsed = collapseRedundantToolCallTwins(messages);

    expect(collapsed).toBe(1);
    const visible = messages[0].toolCalls.filter(
      (t) => t.status !== ToolCallStatus.TOOL_CALL_SKIPPED,
    );
    expect(visible).toHaveLength(1);
  });

  it("prefers a settled attempt over a stuck RUNNING zombie as the survivor", () => {
    const zombie = bareEdit("tool-running", "notes.md", {
      status: ToolCallStatus.TOOL_CALL_RUNNING,
    });
    const done = bareEdit("tool-done", "notes.md", {
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: '""',
    });
    const messages = [aiMessageWith([zombie, done])];

    collapseRedundantToolCallTwins(messages);

    expect(done.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(zombie.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
  });

  it("hides a RUNNING twin beside a WAITING_APPROVAL gate, leaving the gate intact", () => {
    const gate = bareEdit("gate", "notes.md", {
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      requiresApproval: true,
    });
    const zombie = bareEdit("zombie", "notes.md", {
      status: ToolCallStatus.TOOL_CALL_RUNNING,
    });
    const messages = [aiMessageWith([gate, zombie])];

    const collapsed = collapseRedundantToolCallTwins(messages);

    expect(collapsed).toBe(1);
    expect(gate.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(zombie.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
  });

  it("makes a WAITING_APPROVAL gate the SOLE keeper: collapses a same-path write sibling", () => {
    // Two whole-file writes to one path in one turn: the gate (call A) is the
    // single review surface; the sibling (call B) is redundant (a file row carries
    // no authoritative change — the ledger does), so it must collapse — one gate.
    const gate = bareEdit("gate", "notes.md", {
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      requiresApproval: true,
    });
    const staleSibling = toolCall({
      id: "stale-sibling",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "notes.md", content: "stale\n" },
      argsPreview: JSON.stringify({ path: "notes.md" }),
    });
    const messages = [aiMessageWith([gate, staleSibling])];

    const collapsed = collapseRedundantToolCallTwins(messages);

    expect(collapsed).toBe(1);
    expect(gate.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(staleSibling.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    // Both committed ids are preserved (append-only by construction).
    expect(messages[0].toolCalls.map((t) => t.id)).toEqual(["gate", "stale-sibling"]);
  });

  it("keeps BOTH identical shell runs that each produced output (output is their change)", () => {
    const runA = toolCall({
      id: "sh-a",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { command: "ls" },
      argsPreview: JSON.stringify({ command: "ls" }),
      result: "file.txt",
    });
    const runB = toolCall({
      id: "sh-b",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { command: "ls" },
      argsPreview: JSON.stringify({ command: "ls" }),
      result: "file.txt",
    });
    const messages = [aiMessageWith([runA, runB])];

    const collapsed = collapseRedundantToolCallTwins(messages);

    expect(collapsed).toBe(0);
    expect(runA.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(runB.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });

  it("leaves an ungated read-only duplicate untouched (out of scope)", () => {
    const readA = toolCall({
      id: "r-a",
      name: "read",
      status: ToolCallStatus.TOOL_CALL_RUNNING,
      args: { path: "notes.md" },
      argsPreview: JSON.stringify({ path: "notes.md" }),
    });
    const readB = toolCall({
      id: "r-b",
      name: "read",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { path: "notes.md" },
      argsPreview: JSON.stringify({ path: "notes.md" }),
      result: "contents",
    });
    const messages = [aiMessageWith([readA, readB])];

    const collapsed = collapseRedundantToolCallTwins(messages);

    expect(collapsed).toBe(0);
    expect(readA.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
    expect(readB.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });
});

// The hook captures the COMPLETE proposed args (tool_input) at gate time — the
// authoritative source the stream may not have carried before the first-denial
// cancel. These pin that the runner overlays that input onto the gated call so
// the approval card renders the proposed change from `args`, for every tool kind,
// with a compact-but-valid args_preview that preserves the resume-grant salient,
// and stamps the content digest that binds the resume grant + re-gates a sibling.
describe("reconcileDeniedToolCalls — authoritative hook input overlay", () => {
  function parsePreview(tc: ToolCall): Record<string, unknown> {
    return JSON.parse(tc.argsPreview) as Record<string, unknown>;
  }
  function args(tc: ToolCall): Record<string, unknown> {
    return (tc.args ?? {}) as Record<string, unknown>;
  }

  it("stamps the authoritative write content + a salient-preserving preview + a digest", async () => {
    const tc = toolCall({
      id: "c1",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      argsPreview: JSON.stringify({ path: "src/new.ts" }),
    });
    const messages = [aiMessageWith([tc])];

    await reconcileDeniedToolCalls(
      messages,
      [{
        toolName: "Write",
        token: grantToken("write", "src/new.ts"),
        input: { file_path: "src/new.ts", content: "export const x = 1;\n" },
      }],
      undefined,
      rootBackend(),
    );

    // The full proposed content lives on args (the single source exact-apply reads).
    expect(args(tc).content).toBe("export const x = 1;\n");
    // args_preview reflects the authoritative input and stays parseable.
    expect(parsePreview(tc).file_path).toBe("src/new.ts");
    // The digest binds the resume grant / re-gates a diverging sibling.
    expect(tc.approvalContentDigest).not.toBe("");
  });

  it("does NOT overlay a secret-like write's content (DD-26 #2 defensive guard)", async () => {
    // Normally unreachable — the hook hard-blocks a secret write and records no
    // ledger entry — but if a hook classify failure fell one through with content,
    // that content must still never reach args / args_preview / the digest.
    const tc = toolCall({
      id: "c1",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      argsPreview: JSON.stringify({ path: ".env" }),
    });
    const messages = [aiMessageWith([tc])];

    await reconcileDeniedToolCalls(
      messages,
      [{
        toolName: "Write",
        token: grantToken("write", ".env"),
        input: { file_path: ".env", content: "API_KEY=super-secret" },
      }],
      undefined,
      rootBackend(),
    );

    expect(args(tc).content).toBeUndefined(); // content never overlaid
    expect(tc.argsPreview).not.toContain("super-secret");
    expect(tc.approvalContentDigest).toBe(""); // digest not stamped from secret content
  });

  it("stamps the captured edit old/new strings and a digest", async () => {
    const tc = toolCall({
      id: "c1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      argsPreview: JSON.stringify({ path: "src/app.ts" }),
    });
    const messages = [aiMessageWith([tc])];

    await reconcileDeniedToolCalls(
      messages,
      [{
        toolName: "StrReplace",
        token: grantToken("write", "src/app.ts"),
        input: { file_path: "src/app.ts", old_string: "alpha", new_string: "beta" },
      }],
      undefined,
      rootBackend(),
    );

    expect(args(tc).old_string).toBe("alpha");
    expect(args(tc).new_string).toBe("beta");
    expect(tc.approvalContentDigest).not.toBe("");
  });

  it("preserves a notebook edit's target_notebook salient in the preview", async () => {
    const tc = toolCall({
      id: "c1",
      name: "EditNotebook",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      argsPreview: JSON.stringify({ target_notebook: "nb.ipynb" }),
    });
    const messages = [aiMessageWith([tc])];

    await reconcileDeniedToolCalls(
      messages,
      [{
        toolName: "EditNotebook",
        token: grantToken("write", "nb.ipynb"),
        input: { target_notebook: "nb.ipynb", old_string: "x = 1", new_string: "x = 2" },
      }],
      undefined,
      rootBackend(),
    );

    expect(parsePreview(tc).target_notebook).toBe("nb.ipynb");
  });

  it("carries shell args so the gate shows the command", async () => {
    const tc = toolCall({
      id: "c1",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      argsPreview: JSON.stringify({ command: "rm -rf build" }),
    });
    const messages = [aiMessageWith([tc])];

    await reconcileDeniedToolCalls(
      messages,
      [{
        toolName: "Shell",
        token: grantToken("shell", "rm -rf build"),
        input: { command: "rm -rf build", cwd: "/root" },
      }],
      undefined,
      rootBackend(),
    );

    expect(parsePreview(tc).command).toBe("rm -rf build");
    expect(parsePreview(tc).cwd).toBe("/root");
  });

  it("upgrades a synthesized placeholder from path-only to the full captured args", async () => {
    // No streamed call matches (rare); the placeholder must still carry the real
    // proposed content from the captured input, not a bare {path}.
    const messages = [aiMessageWith([])];

    const reconciled = await reconcileDeniedToolCalls(
      messages,
      [{
        toolName: "Write",
        token: grantToken("write", "ghost.md"),
        input: { file_path: "ghost.md", content: "# Ghost\n" },
      }],
      undefined,
      rootBackend(),
    );

    expect(reconciled).toHaveLength(1);
    const tc = reconciled[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(args(tc).content).toBe("# Ghost\n");
  });

  it("keeps a large write's args_preview small, valid, and salient-preserving", async () => {
    const content = "x".repeat(50_000);
    const tc = toolCall({
      id: "c1",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      argsPreview: JSON.stringify({ path: "big.ts" }),
    });
    const messages = [aiMessageWith([tc])];

    await reconcileDeniedToolCalls(
      messages,
      [{
        toolName: "Write",
        token: grantToken("write", "big.ts"),
        input: { file_path: "big.ts", content },
      }],
      undefined,
      rootBackend(),
    );

    // The preview is bounded and parseable (resume reads it) with the salient
    // preserved; the full content lives on args (which exact-apply reads).
    expect(tc.argsPreview.length).toBeLessThan(1_000);
    expect(parsePreview(tc).file_path).toBe("big.ts");
    expect((args(tc).content as string).length).toBe(content.length);
  });
});

// The hook computes its denial identity token from the RAW path Cursor hands it
// (it is a bash script and cannot normalize against the workspace root), while
// the stream event may carry the same file under a different path FORM (the
// classic case: an ABSOLUTE file_path in the hook input vs. a RELATIVE path in
// the stream). Their raw tokens then differ, exact correlation misses, and the
// reconcile would synthesize a content-less WAITING_APPROVAL placeholder BESIDE
// the real streamed call — two cards for one edit, the gate showing "No preview
// available" because the synthesized placeholder carries no file_changes. These
// pin the runner-side normalized-path fallback that overlays the REAL streamed
// call instead (guard-safe: it reuses the already-committed id, never drops one,
// and the captured new-file content survives onto the gate).
describe("reconcileDeniedToolCalls — normalized-path fallback (abs/rel drift)", () => {
  it("overlays the real streamed write when the hook salient is absolute but the stream path is relative", async () => {
    // A denied write streamed (and was committed) as TOOL_CALL_FAILED; the hook
    // recorded the denial under the absolute path, so the raw tokens do not match.
    const streamed = toolCall({
      id: "stream-create",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "notes.md", contents: "# Notes\n" },
    });
    const messages = [aiMessageWith([streamed])];

    const reconciled = await reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Write", token: grantToken("write", "/root/notes.md") }],
      undefined,
      rootBackend(),
    );

    // No synthesized placeholder was appended; the only tool call is the real
    // streamed one (its committed id preserved → backend append-only guard-safe).
    const ids = messages.flatMap((m) => m.toolCalls.map((t) => t.id));
    expect(ids).toEqual(["stream-create"]);
    expect(ids.some((id) => id.startsWith("approval:"))).toBe(false);

    // The streamed call was overlaid in place as the single gate.
    expect(streamed.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(streamed.requiresApproval).toBe(true);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].id).toBe("stream-create");
  });

  it("overlays a denied EDIT under abs/rel drift via the shared overlay path", async () => {
    const streamed = toolCall({
      id: "stream-edit",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "src/app.ts", old_string: "alpha", new_string: "beta" },
    });
    const messages = [aiMessageWith([streamed])];

    await reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Write", token: grantToken("write", "/root/src/app.ts") }],
      undefined,
      rootBackend(),
    );

    const ids = messages.flatMap((m) => m.toolCalls.map((t) => t.id));
    expect(ids).toEqual(["stream-edit"]);
    expect(streamed.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });

  it("still synthesizes a placeholder when NO streamed call matches even after normalization", async () => {
    // The genuine no-stream-event denial (rare) must still surface a gate.
    const messages = [aiMessageWith([])];

    const reconciled = await reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Write", token: grantToken("write", "/root/ghost.md") }],
      undefined,
      rootBackend(),
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(reconciled[0].id.startsWith("approval:")).toBe(true);
  });

  it("does not overlay a DIFFERENT file that happens to be denied (no false normalized match)", async () => {
    // A streamed create for one file must not absorb a denial for another file
    // just because the fallback ran — normalization is per-path.
    const streamed = toolCall({
      id: "stream-other",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "other.md", contents: "x" },
    });
    const messages = [aiMessageWith([streamed])];

    const reconciled = await reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Write", token: grantToken("write", "/root/notes.md") }],
      undefined,
      rootBackend(),
    );

    // The unrelated streamed call is untouched; the denial is satisfied by a
    // synthesized placeholder for the actually-denied file.
    expect(streamed.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].id).toBe("approval:" + grantToken("write", "/root/notes.md"));
  });
});

describe("reconstructAdjudicatedApprovals", () => {
  it("reads decisions and rebuilds pending approvals from adjudicated tool calls", () => {
    const approved = toolCall({
      id: "c1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.APPROVE,
      approvalMessage: "Write file: gated.txt",
      argsPreview: JSON.stringify({ path: "gated.txt" }),
    });
    const undecided = toolCall({
      id: "c2",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.UNSPECIFIED,
    });
    const unrelated = toolCall({
      id: "c3",
      name: "read",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      approvalAction: ApprovalAction.APPROVE,
    });
    const messages = [aiMessageWith([approved, undecided, unrelated])];

    const { pendingApprovals, decisions } = reconstructAdjudicatedApprovals(messages);

    expect([...decisions.entries()]).toEqual([["c1", ApprovalAction.APPROVE]]);
    expect(pendingApprovals).toHaveLength(1);
    expect(pendingApprovals[0].toolCallId).toBe("c1");
    expect(pendingApprovals[0].toolName).toBe("edit");
    expect(pendingApprovals[0].argsPreview).toBe(JSON.stringify({ path: "gated.txt" }));
  });

  it("returns nothing when no tool call carries a decision", () => {
    const tc = toolCall({
      id: "c1",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.UNSPECIFIED,
    });
    const { pendingApprovals, decisions } = reconstructAdjudicatedApprovals([aiMessageWith([tc])]);
    expect(pendingApprovals).toEqual([]);
    expect(decisions.size).toBe(0);
  });
});

// When a Cursor turn pauses for approval, the model frequently reacts to the
// deny ("blocked by a hook; enable it in your Cursor settings") and that
// provisional verdict must NOT render next to the approval card. These pin the
// deterministic positional rule that BLANKS exactly the trailing reaction block
// (preserving the message count so the finalize stays append-only) and touches
// nothing load-bearing.
describe("clearProvisionalPostDenialNarration", () => {
  function aiText(content: string): AgentMessage {
    return create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content });
  }
  function thinking(content: string): AgentMessage {
    return create(AgentMessageSchema, { type: MessageType.MESSAGE_THINKING, content });
  }

  it("blanks the trailing assistant/thinking block after the last gated tool call without removing it", () => {
    const gated = toolCall({ id: "c1", name: "edit", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL });
    const messages: AgentMessage[] = [
      aiText("Let me create the file."),
      aiMessageWith([gated]),
      thinking("The hook blocked me; the environment must be misconfigured."),
      aiText("I couldn't do this — please enable the hook in your Cursor settings."),
    ];

    const redacted = clearProvisionalPostDenialNarration(messages, [gated]);

    expect(redacted).toHaveLength(2);
    // Append-only by construction: count is preserved, only content is blanked.
    expect(messages).toHaveLength(4);
    expect(messages[0].content).toBe("Let me create the file."); // pre-tool text untouched
    expect(messages[1].toolCalls[0]).toBe(gated); // gated call untouched
    expect(messages[2].content).toBe(""); // provisional thinking blanked
    expect(messages[2].isStreaming).toBe(false);
    expect(messages[3].content).toBe(""); // provisional verdict blanked
    expect(messages[3].isStreaming).toBe(false);
    // The redacted handles are the very messages still in the transcript.
    expect(redacted[0]).toBe(messages[2]);
    expect(redacted[1]).toBe(messages[3]);
  });

  it("preserves pre-tool narration and the gated call itself", () => {
    const gated = toolCall({ id: "c1", name: "edit", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL });
    const messages: AgentMessage[] = [aiText("Working on it."), aiMessageWith([gated])];

    const redacted = clearProvisionalPostDenialNarration(messages, [gated]);

    expect(redacted).toHaveLength(0);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("Working on it.");
  });

  it("stops at the first tool-bearing message so real post-gate activity is kept", () => {
    const gated = toolCall({ id: "c1", name: "edit", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL });
    const readAfter = toolCall({ id: "c2", name: "read", status: ToolCallStatus.TOOL_CALL_COMPLETED });
    const messages: AgentMessage[] = [
      aiMessageWith([gated]),
      aiText("checking something else"),
      aiMessageWith([readAfter]), // real activity — not trailing narration
    ];

    const redacted = clearProvisionalPostDenialNarration(messages, [gated]);

    // The read message is the last gated-or-activity boundary; iteration stops
    // there and the intermediate text is preserved (it is not "trailing").
    expect(redacted).toHaveLength(0);
    expect(messages).toHaveLength(3);
    expect(messages[1].content).toBe("checking something else");
  });

  it("is a no-op when there are no denied tool calls", () => {
    const messages: AgentMessage[] = [aiText("all good")];
    expect(clearProvisionalPostDenialNarration(messages, [])).toEqual([]);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("all good");
  });
});

// First-denial stop contract (index.ts stream loop). When the preToolUse hook
// records its first denial, the runner ends the turn immediately — before the
// model can react to Cursor's tool-failure surface with inter-tool narration or
// a second gated tool. These pin the COMPOSED outcome of that stop using the
// real ledger + reconcile + trim helpers; the live SDK orchestration is covered
// by the end-to-end integration test (cursor_hitl_test.go).
describe("first-denial stop contract", () => {
  type SimEvent =
    | { kind: "text"; content: string }
    | {
        kind: "tool";
        tool: ToolCall;
        denyToken?: { name: string; token: string; kind?: string };
        // When the hook's ledger append lands relative to the loop's read for
        // THIS event. "before-read" is the common case (the hook adjudicates as
        // the tool_call event surfaces); "after-read" reproduces the production
        // race where the append lands just after — the watcher's dirty flag
        // must then stop the turn on the NEXT event of any type.
        denyTiming?: "before-read" | "after-read";
      };

  // Faithfully mirrors the index.ts loop rule: process each event, then read
  // the denial ledger when the fs watcher flagged it dirty OR the event is a
  // tool_call (the backstop) — the instant an APPROVAL-kind denial appears,
  // cancel the run and stop consuming the stream (non-approval kinds — a secret
  // hard-block, a capture error — are attributable but never pause). The
  // watcher is simulated by flipping the dirty flag as the append happens (the
  // real fs.watch notification).
  async function runTurnWithFirstDenialStop(
    hitlDir: string,
    events: SimEvent[],
  ): Promise<{ messages: AgentMessage[]; cancelled: boolean; consumed: number }> {
    await resetDenialLedger(hitlDir);
    const messages: AgentMessage[] = [];
    let cancelled = false;
    let consumed = 0;
    let ledgerDirty = false;
    let pendingAppend: { name: string; token: string; kind?: string } | undefined;

    const appendDenial = async (deny: { name: string; token: string; kind?: string }) => {
      const kindField = deny.kind ? `,"kind":"${deny.kind}"` : "";
      await writeFile(
        denialLedgerPath(hitlDir),
        `{"toolName":"${deny.name}","token":"${deny.token}"${kindField}}\n`,
        { flag: "a" },
      );
      ledgerDirty = true;
    };

    for (const ev of events) {
      consumed++;
      // A raced append from the PREVIOUS event lands as this event arrives.
      if (pendingAppend) {
        await appendDenial(pendingAppend);
        pendingAppend = undefined;
      }
      if (ev.kind === "text") {
        messages.push(create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content: ev.content }));
      } else {
        messages.push(aiMessageWith([ev.tool]));
        if (ev.denyToken) {
          if ((ev.denyTiming ?? "before-read") === "before-read") {
            await appendDenial(ev.denyToken);
          } else {
            pendingAppend = ev.denyToken;
          }
        }
      }
      if (ledgerDirty || ev.kind === "tool") {
        ledgerDirty = false;
        const denials = approvalDenials(await readDenialLedger(hitlDir));
        if (denials.length > 0) {
          cancelled = true;
          break;
        }
      }
    }

    return { messages, cancelled, consumed };
  }

  it("stops at the first gated tool, never consuming the inter-tool narration or a second gated tool", async () => {
    const ws = makeWorkspace();
    const edit = toolCall({ id: "c1", name: "edit", status: ToolCallStatus.TOOL_CALL_COMPLETED, args: { path: "gated.txt" } });
    const shell = toolCall({ id: "c2", name: "shell", status: ToolCallStatus.TOOL_CALL_COMPLETED, args: { command: "echo hi > gated.txt" } });

    // The full turn the model WOULD produce if left running: pre-tool text, the
    // gated edit (denied), a defeatist reaction, then a shell workaround (also
    // gated). The stop must cut the turn after the gated edit.
    const { messages, cancelled, consumed } = await runTurnWithFirstDenialStop(ws, [
      { kind: "text", content: "Let me create the file." },
      { kind: "tool", tool: edit, denyToken: { name: "Write", token: grantToken("write", "gated.txt") } },
      { kind: "text", content: "I'm blocked by a hook — I'll try the shell instead." },
      { kind: "tool", tool: shell, denyToken: { name: "Shell", token: grantToken("shell", "echo hi > gated.txt") } },
    ]);

    expect(cancelled).toBe(true);
    expect(consumed).toBe(2); // pre-tool text + gated edit only
    // The second gated tool and the inter-tool narration were never consumed.
    expect(messages).toHaveLength(2);
    expect(messages.some((m) => m.content.includes("try the shell"))).toBe(false);

    // Phase 12 reconcile + redact on the stopped transcript yields the clean shape.
    const denied = await reconcileDeniedToolCalls(messages, await readDenialLedger(ws));
    expect(denied).toHaveLength(1);
    expect(edit.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    const redacted = clearProvisionalPostDenialNarration(messages, denied);
    expect(redacted).toHaveLength(0); // nothing trailing to redact — the stop already did it
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("Let me create the file.");
    expect(messages[1].toolCalls[0]).toBe(edit);
  });

  it("does not stop a turn with no denials (auto-approved / read-only tools run to completion)", async () => {
    const ws = makeWorkspace();
    const read = toolCall({ id: "c1", name: "read", status: ToolCallStatus.TOOL_CALL_COMPLETED, args: { path: "a.txt" } });

    const { cancelled, consumed } = await runTurnWithFirstDenialStop(ws, [
      { kind: "text", content: "Reading the file." },
      { kind: "tool", tool: read },
      { kind: "text", content: "Here is the content." },
    ]);

    expect(cancelled).toBe(false);
    expect(consumed).toBe(3); // the whole turn is consumed
  });

  it("does NOT stop on a non-approval denial (secret hard-block: the agent continues)", async () => {
    // The kinded ledger now records a secret hard-block for attribution (issue
    // #205), and the append fires the fs watcher — but the model was told to
    // move on, so the run must NOT be cancelled and no approval may surface.
    const ws = makeWorkspace();
    const secretWrite = toolCall({
      id: "c1", name: "edit", status: ToolCallStatus.TOOL_CALL_FAILED,
      error: "blocked by a hook", args: { path: ".env" },
    });
    const read = toolCall({ id: "c2", name: "read", status: ToolCallStatus.TOOL_CALL_COMPLETED, args: { path: "a.txt" } });

    const { cancelled, consumed } = await runTurnWithFirstDenialStop(ws, [
      { kind: "tool", tool: secretWrite, denyToken: { name: "Write", token: grantToken("write", ".env"), kind: "secret" } },
      { kind: "text", content: "That file is protected — moving on." },
      { kind: "tool", tool: read },
    ]);

    expect(cancelled).toBe(false);
    expect(consumed).toBe(3); // the whole turn is consumed
    // And the boundary reconcile manufactures no gate from it either.
    const denied = await reconcileDeniedToolCalls([], await readDenialLedger(ws));
    expect(denied).toEqual([]);
  });

  it("stops on the NEXT event of any type when the denial lands after the tool_call read (the watcher rule)", async () => {
    // The production race (aex_01kwj07f7g23c3wp9sn8496z5g): the hook's ledger
    // append landed just after the gated tool's own tool_call-event read, so the
    // old tool_call-only rule consumed the model's ENTIRE reaction (thinking,
    // narration, a workaround shell) before the next tool_call finally saw the
    // ledger. The watcher flags the append the moment it lands; the very next
    // event — a mere text delta — must end the turn.
    const ws = makeWorkspace();
    const shell = toolCall({ id: "c1", name: "shell", status: ToolCallStatus.TOOL_CALL_RUNNING, args: { command: "seq 1 5000 > big.txt" } });
    const workaround = toolCall({ id: "c2", name: "shell", status: ToolCallStatus.TOOL_CALL_RUNNING, args: { command: "python3 -c ..." } });

    const { messages, cancelled, consumed } = await runTurnWithFirstDenialStop(ws, [
      { kind: "text", content: "Let me create the file." },
      { kind: "tool", tool: shell, denyToken: { name: "Shell", token: grantToken("shell", "seq 1 5000 > big.txt") }, denyTiming: "after-read" },
      { kind: "text", content: "Shell was blocked — generating with a script instead." },
      { kind: "tool", tool: workaround, denyToken: { name: "Shell", token: grantToken("shell", "python3 -c ...") } },
    ]);

    expect(cancelled).toBe(true);
    // The reaction text event triggers the dirty-flag read and is the LAST
    // event consumed; the workaround tool is never consumed at all.
    expect(consumed).toBe(3);
    expect(messages).toHaveLength(3);
    expect(messages.some((m) => m.toolCalls.includes(workaround))).toBe(false);

    // Phase 12 on the stopped transcript: the anchor gates, and the one raced
    // reaction message is blanked by the trim backstop.
    const denied = await reconcileDeniedToolCalls(messages, await readDenialLedger(ws), undefined, rootBackend());
    expect(denied).toHaveLength(1);
    expect(shell.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    const redacted = clearProvisionalPostDenialNarration(messages, denied);
    expect(redacted).toHaveLength(1);
    expect(messages[2].content).toBe("");
  });
});

describe("watchDenialLedger", () => {
  it("flags dirty when the hook appends a denial to the ledger", async () => {
    const ws = makeWorkspace();
    await resetDenialLedger(ws);
    let dirty = false;
    const stop = watchDenialLedger(ws, () => {
      dirty = true;
    });
    try {
      // Give the watcher a beat to arm, then simulate the hook's append.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await writeFile(
        denialLedgerPath(ws),
        `{"toolName":"Shell","token":"${grantToken("shell", "echo hi")}"}\n`,
        { flag: "a" },
      );
      await vi.waitFor(() => expect(dirty).toBe(true), { timeout: 3_000 });
    } finally {
      stop();
    }
  });

  it("close is idempotent and safe after the directory is gone", async () => {
    const ws = makeWorkspace();
    await resetDenialLedger(ws);
    const stop = watchDenialLedger(ws, () => {});
    stop();
    stop(); // second close must not throw
  });
});

// Issue #205: a FOREIGN `.cursor/hooks.json` hook (preserved by the merge) can
// deny the runner's tools without writing our denial ledger; the SDK has no
// structured "denied by hook" signal, so the only stream trace is Cursor's
// generic hook-block error text on the FAILED call. The detector matches this
// turn's hook-blocked FAILED rows against the FULL ledger (all kinds) and
// reports the leftovers — which the activity surfaces as EXECUTION_FAILED
// instead of the silent completion the issue describes. These pin the whole
// attribution matrix.
describe("detectUnattributedHookBlocks (issue #205)", () => {
  // Cursor's generic replacement text for a hook deny (Phase 0 ground truth).
  const HOOK_BLOCK = "Command blocked by a hook. Check the hooks configuration.";

  const failedShell = (id: string, command: string, error: string = HOOK_BLOCK) =>
    toolCall({ id, name: "shell", status: ToolCallStatus.TOOL_CALL_FAILED, error, args: { command } });
  const failedEdit = (id: string, path: string, error: string = HOOK_BLOCK) =>
    toolCall({ id, name: "edit", status: ToolCallStatus.TOOL_CALL_FAILED, error, args: { path } });

  it("detects a hook-blocked call when the ledger is EMPTY (the reproduce-first #205 shape)", () => {
    const edit = failedEdit("f1", "notes.md");
    const blocks = detectUnattributedHookBlocks([aiMessageWith([edit])], 0, []);
    expect(blocks).toEqual([{ toolCallId: "f1", toolName: "edit", error: HOOK_BLOCK }]);
  });

  it("matches the marker case-insensitively (single-sourced marker family)", () => {
    expect(HOOK_BLOCK_ERROR_MARKERS).toContain("blocked by a hook");
    const edit = failedEdit("f1", "notes.md", "Tool was Blocked By A Hook.");
    expect(detectUnattributedHookBlocks([aiMessageWith([edit])], 0, [])).toHaveLength(1);
  });

  it("attributes our own denial by exact token — not reported", () => {
    const shell = failedShell("s1", "rm -rf build");
    const ledger = [{ toolName: "Shell", token: toolCallIdentityToken(shell), kind: "approval" }];
    expect(detectUnattributedHookBlocks([aiMessageWith([shell])], 0, ledger)).toEqual([]);
  });

  it("attributes a secret hard-block via its kind:'secret' entry — not reported", () => {
    // The agent continues past a secret block; its FAILED row must never be
    // misdiagnosed as a foreign hook (the false positive the kinded ledger
    // exists to prevent).
    const secretWrite = failedEdit("e1", ".env");
    const ledger = [{ toolName: "Write", token: toolCallIdentityToken(secretWrite), kind: "secret" }];
    expect(detectUnattributedHookBlocks([aiMessageWith([secretWrite])], 0, ledger)).toEqual([]);
  });

  it("attributes a capture-error deny via its kind:'capture-error' entry — not reported", () => {
    const write = failedEdit("e1", "app.log");
    const ledger = [{ toolName: "Write", token: toolCallIdentityToken(write), kind: "capture-error" }];
    expect(detectUnattributedHookBlocks([aiMessageWith([write])], 0, ledger)).toEqual([]);
  });

  it("attributes across abs-vs-rel path drift via the workspace-normalized salient", () => {
    // The hook records the RAW absolute path Cursor handed it; the stream row
    // carries the relative one. Exact tokens differ; the normalized (category,
    // path) must still attribute — the same drift reconcile's second pass heals.
    const edit = failedEdit("e1", "notes.md");
    const ledger = [{ toolName: "Write", token: grantToken("write", `${ROOT}/notes.md`), kind: "secret" }];
    // Without a workspace root the raw tokens cannot be reconciled…
    expect(detectUnattributedHookBlocks([aiMessageWith([edit])], 0, ledger)).toHaveLength(1);
    // …with it, the normalized pass attributes the block to our own entry.
    expect(detectUnattributedHookBlocks([aiMessageWith([edit])], 0, ledger, ROOT)).toEqual([]);
  });

  it("treats a fail-closed turn as attributed — the broken gate denied everything it saw", () => {
    // With the state file missing, EVERY gated tool was denied by OUR OWN
    // (broken) hook; per-call correlation is meaningless and none of it is a
    // foreign hook. The boundary logs the broken-gate condition separately.
    const shell = failedShell("s1", "make build");
    const edit = failedEdit("e1", "other.txt");
    const ledger = [{ toolName: "Shell", token: grantToken("shell", "make build"), kind: "fail-closed" }];
    expect(
      detectUnattributedHookBlocks([aiMessageWith([shell, edit])], 0, ledger),
    ).toEqual([]);
  });

  it("scopes to THIS turn only — seeded prior-turn rows never re-trigger", () => {
    const priorTurnRow = failedShell("old-1", "yarn deploy");
    const thisTurnRow = failedShell("new-1", "yarn build");
    const messages = [aiMessageWith([priorTurnRow]), aiMessageWith([thisTurnRow])];
    const blocks = detectUnattributedHookBlocks(messages, 1, []);
    expect(blocks.map((b) => b.toolCallId)).toEqual(["new-1"]);
  });

  it("mixed turn: reports the foreign block even when our own anchor denial is present", () => {
    // The caller pauses on the anchor (a pausing turn is never silent) and only
    // logs this — but the detector itself must still see the foreign block.
    const ourEdit = failedEdit("ours", "gated.txt");
    const foreignShell = failedShell("theirs", "terraform apply");
    const ledger = [{ toolName: "Write", token: toolCallIdentityToken(ourEdit), kind: "approval" }];
    const blocks = detectUnattributedHookBlocks(
      [aiMessageWith([ourEdit, foreignShell])], 0, ledger,
    );
    expect(blocks.map((b) => b.toolCallId)).toEqual(["theirs"]);
  });

  it("ignores ordinary tool failures without hook-block text", () => {
    const failed = failedShell("s1", "make test", "exit code 2: tests failed");
    const noError = toolCall({ id: "s2", name: "shell", status: ToolCallStatus.TOOL_CALL_FAILED, error: "", args: { command: "ls" } });
    expect(detectUnattributedHookBlocks([aiMessageWith([failed, noError])], 0, [])).toEqual([]);
  });

  it("ignores non-FAILED rows even when their output mentions the marker", () => {
    // Adversarial: the marker appearing in a tool's legitimate RESULT (e.g. the
    // agent grepped these very words) must never trigger — only a FAILED row's
    // error text reads as a hook block.
    const completed = toolCall({
      id: "c1", name: "shell", status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: 'found "blocked by a hook" in docs/hitl.md', args: { command: "grep -r hook docs" },
    });
    const waiting = toolCall({
      id: "w1", name: "edit", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, args: { path: "gated.txt" },
    });
    expect(detectUnattributedHookBlocks([aiMessageWith([completed, waiting])], 0, [])).toEqual([]);
  });

  it("reports every distinct foreign block in the turn", () => {
    const one = failedEdit("f1", "a.txt");
    const two = failedShell("f2", "rm -rf build");
    const blocks = detectUnattributedHookBlocks([aiMessageWith([one]), aiMessageWith([two])], 0, []);
    expect(blocks.map((b) => b.toolCallId)).toEqual(["f1", "f2"]);
  });
});

// The reconcile itself must never manufacture a pause from a non-approval
// denial, regardless of caller discipline (defense-in-depth for the kind split).
describe("reconcileDeniedToolCalls — non-approval kinds never gate", () => {
  it("returns no gates and leaves the transcript untouched for secret/capture-error/fail-closed entries", async () => {
    const secretRow = toolCall({
      id: "e1", name: "edit", status: ToolCallStatus.TOOL_CALL_FAILED,
      error: "blocked by a hook", args: { path: ".env" },
    });
    const messages = [aiMessageWith([secretRow])];
    const denied = await reconcileDeniedToolCalls(messages, [
      { toolName: "Write", token: toolCallIdentityToken(secretRow), kind: "secret" },
      { toolName: "Write", token: grantToken("write", "app.log"), kind: "capture-error" },
      { toolName: "Shell", token: grantToken("shell", "make"), kind: "fail-closed" },
    ]);
    expect(denied).toEqual([]);
    // No overlay, no collapse, no synthesized placeholder appended.
    expect(secretRow.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(messages).toHaveLength(1);
    expect(messages[0].toolCalls).toHaveLength(1);
  });

  it("gates the approval entry while ignoring a non-approval sibling in the same ledger", async () => {
    const gated = toolCall({
      id: "g1", name: "edit", status: ToolCallStatus.TOOL_CALL_FAILED,
      error: "blocked by a hook", args: { path: "gated.txt" },
    });
    const secretRow = toolCall({
      id: "e1", name: "edit", status: ToolCallStatus.TOOL_CALL_FAILED,
      error: "blocked by a hook", args: { path: ".env" },
    });
    const messages = [aiMessageWith([gated, secretRow])];
    const denied = await reconcileDeniedToolCalls(messages, [
      // Ledger order puts the secret FIRST: the anchor must still be the first
      // APPROVAL entry, never a non-approval kind.
      { toolName: "Write", token: toolCallIdentityToken(secretRow), kind: "secret" },
      { toolName: "Write", token: toolCallIdentityToken(gated), kind: "approval" },
    ]);
    expect(denied).toHaveLength(1);
    expect(gated.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(secretRow.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
  });
});

describe("generateHookScript ledger wiring", () => {
  it("bakes the active-turn pointer, derives the ledger from it, and records on EVERY deny arm", () => {
    const script = generateHookScript("/gate/active.json");

    // Stable script: it bakes the pointer path (not per-turn state/ledger), and
    // derives LEDGER_FILE from the pointer it reads each invocation.
    expect(script).toContain('ACTIVE_FILE="/gate/active.json"');
    expect(script).not.toContain('LEDGER_FILE="/');
    expect(script).toContain('>> "$LEDGER_FILE"');
    expect(script).toContain("record_denial()");
    // Every deny arm records a kind-tagged entry (issue #205 attribution):
    // the approval gates (built-in + MCP), both secret hard-block arms, the
    // CAS staging-error fail-closed deny, and the missing-state-file failsafe.
    expect(script).toContain('record_denial "$PRIMARY_TOKEN" "approval"');
    expect(script).toContain('record_denial "$MCP_TOKEN" "approval"');
    expect(script.split('"secret"').length - 1).toBeGreaterThanOrEqual(2);
    expect(script).toContain('record_denial "$PRIMARY_TOKEN" "capture-error"');
    expect(script).toContain('record_denial "$PRIMARY_TOKEN" "fail-closed"');
    expect(script).toContain('record_denial "$MCP_TOKEN" "fail-closed"');
    // The hoisting guard: under `set -euo pipefail` with our failClosed
    // hooks.json registration, a call-before-define would emit no decision and
    // block EVERY tool — so the definition must precede the first call.
    expect(script.indexOf("record_denial()")).toBeLessThan(script.indexOf('record_denial "'));
  });
});
