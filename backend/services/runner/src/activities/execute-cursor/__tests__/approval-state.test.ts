/**
 * @regression file-hitl-phase0 — pins file-edit HITL fix #6 (see _projects/2026-06/20260630.01.file-change-hitl-redesign/tasks/T01_3_regression-manifest.md)
 *
 * Resume-grant identity round-trip — the H1 lock.
 *
 * The Cursor HITL model has no pause primitive: a resumed agent re-issues an
 * approved tool with a BRAND-NEW call id, and the preToolUse hook allows it only
 * if its canonical `(category, salient)` identity matches an approved grant. So
 * the single safety-critical equality the whole resume round-trip rests on is:
 *
 *     grant minted on resume  ==  the identity the hook denied on the gated turn
 *
 * If those two ever drift, the approved tool is re-denied on every resume, the
 * run loops in WAITING_FOR_APPROVAL, and the edit is never applied — the exact
 * production failure class this suite exists to make impossible to reintroduce.
 *
 * Why this is a real risk worth a dedicated suite: the two identities are
 * computed by DIFFERENT code paths over the SAME tool call —
 *  - the denial/overlay token via {@link toolCallIdentityToken} -> toolCallArgs
 *    (prefers the structured `tc.args`), and
 *  - the resume grant via {@link buildApprovalGrants} -> parseArgs(argsPreview)
 *    (the JSON-string preview only).
 * They agree today only because both derive from the same stream `event.args`.
 * This suite drives the REAL stream path ({@link buildToolCallProto}) so any
 * future change that lets the dual path diverge fails here, loudly, per category.
 *
 * Deterministic; no Cursor API key, no bash. The hook-side half of the equality
 * (the bash hook recomputes the same token and ALLOWS it) is locked separately
 * in hook-script.test.ts; together they chain grant == overlay == hook token.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ApprovalAction,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage } from "@cursor/sdk";

import {
  buildToolCallProto,
  reconcileDeniedToolCalls,
  toolCallIdentityToken,
} from "../message-translator.js";
import {
  buildApprovalGrants,
  buildApprovalState,
  primaryToken,
  reconstructAdjudicatedApprovals,
  type ApprovalGrant,
  type DeniedLedgerEntry,
} from "../approval-state.js";

/** A built-in (non-MCP) stream tool_call event, as `@cursor/sdk` emits it. */
function builtInEvent(
  callId: string,
  name: string,
  args: Record<string, unknown>,
): Extract<SDKMessage, { type: "tool_call" }> {
  return {
    type: "tool_call",
    agent_id: "agent-1",
    run_id: "r1",
    call_id: callId,
    name,
    status: "running",
    args,
  };
}

/** An MCP stream tool_call event (name="mcp", real identity nested in args). */
function mcpEvent(
  callId: string,
  slug: string,
  toolName: string,
  innerArgs: Record<string, unknown>,
): Extract<SDKMessage, { type: "tool_call" }> {
  return {
    type: "tool_call",
    agent_id: "agent-1",
    run_id: "r1",
    call_id: callId,
    name: "mcp",
    status: "running",
    args: { providerIdentifier: slug, toolName, args: innerArgs },
  };
}

/**
 * Drive the full gated-turn -> approve -> resume round-trip for one stream event
 * and return the two identities that must be equal: the token the hook recorded
 * when it denied the gated call, and the grant token a resume mints after the
 * user approves it. Mirrors the activity's real sequence:
 *   buildToolCallProto (stream) -> deny overlay (reconcileDeniedToolCalls) ->
 *   persist APPROVE -> reconstructAdjudicatedApprovals -> buildApprovalGrants.
 */
async function roundTrip(event: Extract<SDKMessage, { type: "tool_call" }>): Promise<{
  denialToken: string;
  grantPrimaryToken: string;
  resumeStateToken: string | undefined;
  grant: ApprovalGrant;
}> {
  const tc = buildToolCallProto(event);

  // The gated turn: the hook denies the call, recording its identity token. The
  // runner's overlay (reconcileDeniedToolCalls) flips the same call to
  // WAITING_APPROVAL by matching that token — so the denial token IS the
  // canonical identity the resume grant must reproduce. For a file edit this is
  // the CONTENT-exact token (category, salient, digest); for shell/delete/MCP it
  // is the coarse token.
  const denialToken = toolCallIdentityToken(tc);
  const msg = create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "working",
    toolCalls: [tc],
  });
  const ledger: DeniedLedgerEntry[] = [{ toolName: tc.name, token: denialToken }];
  const denied = await reconcileDeniedToolCalls([msg], ledger);
  expect(denied, "the overlay must match the denial token and surface the gate").toHaveLength(1);

  // The user approves; the backend persists the decision on the tool call.
  tc.approvalAction = ApprovalAction.APPROVE;

  // The resume: reconstruct the adjudicated approvals from the persisted
  // transcript (pending_approvals is already cleared by this point) and mint the
  // grants the next turn's hook reads. The content digest threads through so the
  // grant reproduces the content-exact denial identity.
  const messages: AgentMessage[] = [msg];
  const { pendingApprovals, decisions, contentDigests } = reconstructAdjudicatedApprovals(messages);
  const grants = buildApprovalGrants(pendingApprovals, decisions, contentDigests);
  expect(grants, "an approved tool must yield exactly one grant").toHaveLength(1);

  const state = buildApprovalState(new Map(), false, new Set(), grants);

  return {
    denialToken,
    grantPrimaryToken: primaryToken(grants[0].key, grants[0].salient, grants[0].contentDigest),
    resumeStateToken: state.approvedGrantTokens[0],
    grant: grants[0],
  };
}

describe("Cursor resume-grant identity round-trip (H1 lock)", () => {
  // Each case is a real gated category with a representative salient. The shell
  // heredoc case is the deliberate stress: a multi-line command with quotes,
  // unicode, and embedded newlines — the bytes most likely to drift if any layer
  // re-serializes args differently.
  const cases: Array<{
    label: string;
    event: Extract<SDKMessage, { type: "tool_call" }>;
    expectedKey: string;
    expectedSalient: string;
  }> = [
    {
      label: "write (stream `edit`, path salient)",
      event: builtInEvent("c_write", "edit", { path: "/work/notes.md", content: "hello" }),
      expectedKey: "write",
      expectedSalient: "/work/notes.md",
    },
    {
      label: "write (stream `StrReplace`, path salient)",
      event: builtInEvent("c_replace", "StrReplace", {
        path: "/work/app.ts",
        old_string: "a",
        new_string: "b",
      }),
      expectedKey: "write",
      expectedSalient: "/work/app.ts",
    },
    {
      label: "delete (path salient)",
      event: builtInEvent("c_del", "delete", { path: "/work/old.tmp" }),
      expectedKey: "delete",
      expectedSalient: "/work/old.tmp",
    },
    {
      label: "shell (short command salient)",
      event: builtInEvent("c_sh", "shell", { command: "rm -rf build" }),
      expectedKey: "shell",
      expectedSalient: "rm -rf build",
    },
    {
      label: "shell (long heredoc with quotes/newlines/unicode)",
      event: builtInEvent("c_heredoc", "shell", {
        command: "cat > notes.md << 'EOF'\n# Notes — \"quoted\" café\nline 2\nEOF",
      }),
      expectedKey: "shell",
      expectedSalient: "cat > notes.md << 'EOF'\n# Notes — \"quoted\" café\nline 2\nEOF",
    },
    {
      label: "notebook (target_notebook salient)",
      event: builtInEvent("c_nb", "EditNotebook", {
        target_notebook: "/work/analysis.ipynb",
        cell_idx: 0,
        new_string: "x",
      }),
      expectedKey: "write",
      expectedSalient: "/work/analysis.ipynb",
    },
    {
      label: "MCP (name-scoped identity, salient empty)",
      event: mcpEvent("c_mcp", "open-computer-use", "click", { x: 10, y: 20 }),
      expectedKey: "click",
      expectedSalient: "",
    },
  ];

  for (const { label, event, expectedKey, expectedSalient } of cases) {
    it(`${label}: resume grant token == denial/overlay token`, async () => {
      const { denialToken, grantPrimaryToken, resumeStateToken, grant } = await roundTrip(event);

      // The decisive equality: what the hook denied is exactly what the resume
      // re-grants, so the re-issued call is ALLOWED, not re-gated.
      expect(grantPrimaryToken, `${label}: grant must reproduce the denial identity`).toBe(denialToken);

      // The grant carries the expected canonical identity (guards against a
      // silently-empty salient sneaking past the equality on a shared bug).
      expect(grant.key).toBe(expectedKey);
      expect(grant.salient).toBe(expectedSalient);

      // The state file the hook actually reads carries that same token verbatim.
      expect(resumeStateToken, `${label}: state file must carry the matching grant token`).toBe(
        denialToken,
      );
    });
  }

  it("sibling isolation: two DIFFERENT edits to the SAME file get distinct identities", () => {
    // The exact bug this change fixes: approving the rename must NOT authorize
    // the TODO edit. They share a path (same coarse token) but differ in content,
    // so the content-exact identity distinguishes them.
    const rename = buildToolCallProto(
      builtInEvent("c1", "edit", { path: "/work/notes.md", old_string: "Planton Cloud", new_string: "Planton" }),
    );
    const todo = buildToolCallProto(
      builtInEvent("c2", "edit", { path: "/work/notes.md", old_string: "", new_string: "## TODO\n" }),
    );
    const renameToken = toolCallIdentityToken(rename);
    const todoToken = toolCallIdentityToken(todo);

    // Distinct identities -> a grant for the rename never matches the TODO.
    expect(renameToken).not.toBe(todoToken);
    // Both are content tokens (3-part), not the bare coarse token they'd collapse
    // to under the old (category, salient) scheme.
    expect(renameToken).not.toBe(
      Buffer.from("write\n/work/notes.md", "utf-8").toString("base64"),
    );
    // Re-issuing the SAME rename content reproduces its identity (identical
    // re-attempt is allowed; a drifted one re-gates).
    const renameAgain = buildToolCallProto(
      builtInEvent("c3", "edit", { path: "/work/notes.md", old_string: "Planton Cloud", new_string: "Planton" }),
    );
    expect(toolCallIdentityToken(renameAgain)).toBe(renameToken);
  });

  /** A decided-but-not-yet-resumed gated call, exactly as the backend persists it. */
  function decidedToolCall(
    event: Extract<SDKMessage, { type: "tool_call" }>,
    action: ApprovalAction,
  ): AgentMessage {
    const tc = buildToolCallProto(event);
    tc.status = ToolCallStatus.TOOL_CALL_WAITING_APPROVAL;
    tc.requiresApproval = true;
    tc.approvalAction = action;
    return create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: "",
      toolCalls: [tc],
    });
  }

  it("REJECT and SKIP mint no grant (a denied-again tool must never be auto-allowed)", () => {
    for (const decision of [ApprovalAction.REJECT, ApprovalAction.SKIP]) {
      const msg = decidedToolCall(builtInEvent("c1", "edit", { path: "/work/x.txt" }), decision);
      const { pendingApprovals, decisions } = reconstructAdjudicatedApprovals([msg]);
      expect(pendingApprovals, "the decided call must be reconstructed").toHaveLength(1);
      expect(buildApprovalGrants(pendingApprovals, decisions)).toEqual([]);
    }
  });

  it("APPROVE_ALL also mints the clicked tool's grant (the lease covers the class separately)", () => {
    const msg = decidedToolCall(builtInEvent("c1", "shell", { command: "make build" }), ApprovalAction.APPROVE_ALL);
    const { pendingApprovals, decisions } = reconstructAdjudicatedApprovals([msg]);
    const grants = buildApprovalGrants(pendingApprovals, decisions);
    expect(grants).toEqual([{ toolName: "shell", mcpServerSlug: "", key: "shell", salient: "make build", contentDigest: "" }]);
  });
});
