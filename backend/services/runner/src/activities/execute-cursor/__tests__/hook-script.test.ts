/**
 * @regression file-hitl-phase0 — pins file-edit HITL fix #2 (see _projects/2026-06/20260630.01.file-change-hitl-redesign/tasks/T01_3_regression-manifest.md)
 *
 * Behavior tests for the generated preToolUse bash hook.
 *
 * These run the ACTUAL bash script the runner writes into the workspace, feeding
 * it the REAL hook-input shape captured from @cursor/sdk (PascalCase
 * `tool_name`; `file_path`/`command` in `tool_input`). They are the strongest
 * guard against the regression this work fixes: a gated built-in must be denied,
 * its denial must be recorded with a token byte-identical to the runner's
 * grantToken, and an exact-resource grant must allow only that resource.
 *
 * Skipped automatically where bash is unavailable.
 */

import { describe, it, expect, onTestFinished } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateHookScript } from "../hook-script.js";
import { buildApprovalState, grantToken, primaryToken, toolIdentity } from "../approval-state.js";
import { contentDigest } from "../../../shared/file-tools.js";
import {
  setupCursorHookHarness as setup,
  hasBash,
  hookWrite,
  hookEdit,
  hookShell,
  hookDelete,
  hookRead,
  hookMcp,
} from "../__test-utils__/cursor-hook-harness.js";

/** Decode the base64(JSON(tool_input)) the hook records on a denial. */
function decodeInput(b64: string | undefined): Record<string, unknown> {
  if (!b64) throw new Error("ledger entry carried no input");
  return JSON.parse(Buffer.from(b64, "base64").toString("utf-8")) as Record<string, unknown>;
}

const d = hasBash ? describe : describe.skip;

d("generated approval hook (preToolUse + beforeMCPExecution)", () => {
  it("denies gated built-ins and records the PRIMARY token (content-exact for a write, coarse for shell/delete)", () => {
    const h = setup({});

    for (const [input, category, salient, args] of [
      // hookWrite defaults content "x"; the hook records the content-exact token.
      [hookWrite("/x/a.txt"), "write", "/x/a.txt", { content: "x" }],
      [hookShell("rm -rf build"), "shell", "rm -rf build", {}],
      [hookDelete("/x/b.txt"), "delete", "/x/b.txt", {}],
    ] as const) {
      h.resetLedger();
      expect(h.decide(input).permission).toBe("deny");
      const ledger = h.ledger();
      expect(ledger).toHaveLength(1);
      // Byte-identical to the runner's primaryToken: content-exact when the hook
      // can compute an edit digest (the write), else the coarse grantToken.
      expect(ledger[0].token).toBe(primaryToken(category, salient, contentDigest(args)));
      // The normal gate is the APPROVAL kind — the only kind that pauses.
      expect(ledger[0].kind).toBe("approval");
    }
  });

  it("allows read-only built-ins", () => {
    const h = setup({});
    expect(h.decide(hookRead("/x/a.txt")).permission).toBe("allow");
    expect(h.ledger()).toEqual([]);
  });

  it("auto-approve-all allows even gated built-ins", () => {
    const h = setup({ autoApproveAll: true });
    expect(h.decide(hookWrite("/x/a.txt")).permission).toBe("allow");
  });

  it("a run-lifetime category lease allows that category and ONLY that category", () => {
    // "Approve all shell commands" must let later shell calls through while still
    // gating a write — the scoped successor to the old global auto-approve-all.
    const h = setup({ leasedCategories: ["shell"] });
    expect(h.decide(hookShell("rm -rf build")).permission).toBe("allow");
    const writeDecision = h.decide(hookWrite("/x/a.txt"));
    expect(writeDecision.permission).toBe("deny");
    // The denied, non-leased write is still recorded for the runner.
    expect(h.ledger().map((e) => e.toolName)).toContain("Write");
  });

  // Exact-resource lease isolation ("no name-only over-grant") moved to the
  // gateway Contract Test Kit's invariant 10, where the SAME bash hook is driven
  // through the Cursor substrate adapter alongside the deep-agent substrate. See
  // src/__tests__/approval-gateway-contract.test.ts.

  it("fails closed (deny) when the state file is missing, recorded as kind fail-closed", () => {
    const h = setup({ noStateFile: true });
    expect(h.decide(hookWrite("/x/a.txt")).permission).toBe("deny");
    // The broken-gate deny is ATTRIBUTABLE (issue #205): recorded under the
    // primary token with kind "fail-closed" and — like every non-approval
    // kind — content-free (no input field, DD-26).
    const ledger = h.ledger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].kind).toBe("fail-closed");
    expect(ledger[0].token).toBe(primaryToken("write", "/x/a.txt", contentDigest({ content: "x" })));
    expect(ledger[0]).not.toHaveProperty("input");
  });

  // Unattended approval mode (DD-014): same gate, different RESOLUTION — the
  // approval-deny arms record the non-pausing "unattended" kind with an
  // adapt-and-explain message. What is gated must be byte-identical to
  // interactive mode; only the kind and the agent message differ.
  describe("unattended approval mode (DD-014)", () => {
    it("denies a gated built-in with kind 'unattended' and the adapt message (no resume promise)", () => {
      const h = setup({ unattendedSkip: true });
      const res = h.decide(hookShell("rm -rf build"));
      expect(res.permission).toBe("deny");
      expect(res.raw).toContain("skipped automatically");
      expect(res.raw).not.toContain("resume you");
      const ledger = h.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0].kind).toBe("unattended");
      // Same identity space as interactive mode — the stamping correlates on it.
      expect(ledger[0].token).toBe(primaryToken("shell", "rm -rf build", ""));
      // Non-approval kinds are content-free (no approval card needs a preview).
      expect(ledger[0]).not.toHaveProperty("input");
    });

    it("denies a require-approval MCP tool with kind 'unattended'", () => {
      const h = setup({
        unattendedSkip: true,
        mcpPolicies: { drop_table: { requiresApproval: true, message: "Drop table?" } },
      });
      const res = h.decide(hookMcp("drop_table", { table: "users" }));
      expect(res.permission).toBe("deny");
      expect(res.raw).toContain("skipped automatically");
      const ledger = h.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0].kind).toBe("unattended");
      expect(ledger[0].token).toBe(grantToken("drop_table", ""));
    });

    it("still allows auto-approved MCP tools and read-only built-ins (gating is unchanged)", () => {
      const h = setup({
        unattendedSkip: true,
        mcpPolicies: { drop_table: { requiresApproval: true } },
      });
      expect(h.decide(hookMcp("list_tables")).permission).toBe("allow");
      expect(h.decide(hookRead("/x/a.txt")).permission).toBe("allow");
      expect(h.ledger()).toEqual([]);
    });

    it("the secret hard-block stays kind 'secret' (mode-independent)", () => {
      const h = setup({ unattendedSkip: true });
      const res = h.decide(hookWrite("/x/.env", "API_KEY=abc"));
      expect(res.permission).toBe("deny");
      const ledger = h.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0].kind).toBe("secret");
    });
  });

  // MCP gating runs ONLY on the beforeMCPExecution event (preToolUse does not
  // enforce MCP), so a denial is recorded in exactly one place. The identity is
  // name-only (base64("<tool>\n")) because the bare tool name is identical on the
  // hook input and the runner's stream event.
  describe("MCP tools (beforeMCPExecution event)", () => {
    it("denies a require-approval MCP tool and surfaces its policy message", () => {
      const h = setup({ mcpPolicies: { click: { requiresApproval: true, message: "Approve click?" } } });
      const res = h.decide(hookMcp("click", { app: "Slack", element_index: "59" }));
      expect(res.permission).toBe("deny");
      expect(res.raw).toContain("Approve click?");
      expect(h.ledger()).toHaveLength(1);
      expect(h.ledger()[0].token).toBe(grantToken("click", ""));
      expect(h.ledger()[0].kind).toBe("approval");
    });

    it("denial agent_message frames approval as automatic and never trains ask-in-prose", () => {
      const h = setup({ mcpPolicies: { click: { requiresApproval: true, message: "Approve click?" } } });
      const res = h.decide(hookMcp("click"));
      // The agent_message must tell the model approval is handled automatically
      // and that it should continue, NOT stop and wait or ask for permission.
      expect(res.raw).toContain("submitted to the user for approval automatically");
      expect(res.raw).toContain("continue with the rest of the task");
      // It must reframe the deny as the approval gate working as intended and
      // forbid the "fix your Cursor settings" narration that the leaky MCP deny
      // path otherwise provokes.
      expect(res.raw.toLowerCase()).toContain("not an error");
      expect(res.raw.toLowerCase()).toContain("cursor settings");
      // The old propose-then-wait framing and internal sentinel must be gone.
      expect(res.raw).not.toContain("STIGMER_APPROVAL_REQUIRED");
      expect(res.raw).not.toContain("Stop and wait");
    });

    it("allows a require-approval MCP tool once it has been granted (reinvocation)", () => {
      const h = setup({
        mcpPolicies: { click: { requiresApproval: true } },
        grants: [{ toolName: "click", mcpServerSlug: "srv", key: "click", salient: "", contentDigest: "", sourceToolCallId: "consent-1" }],
      });
      expect(h.decide(hookMcp("click")).permission).toBe("allow");
      expect(h.ledger()).toEqual([]);
    });

    it("allows an auto-approved MCP tool (absent from mcpToolPolicies)", () => {
      const h = setup({ mcpPolicies: { click: { requiresApproval: true } } });
      expect(h.decide(hookMcp("list_apps")).permission).toBe("allow");
      expect(h.ledger()).toEqual([]);
    });

    it("allows an MCP tool whose policy is explicitly requiresApproval:false", () => {
      const h = setup({ mcpPolicies: { click: { requiresApproval: false } } });
      expect(h.decide(hookMcp("click")).permission).toBe("allow");
    });

    it("auto-approve-all allows a require-approval MCP tool", () => {
      const h = setup({ autoApproveAll: true, mcpPolicies: { click: { requiresApproval: true } } });
      expect(h.decide(hookMcp("click")).permission).toBe("allow");
    });

    it("fails closed (deny) when the state file is missing, recorded as kind fail-closed", () => {
      const h = setup({ noStateFile: true });
      expect(h.decide(hookMcp("click")).permission).toBe("deny");
      // Attributable under the MCP name-token (the identity the stream row
      // computes for an MCP call), content-free like every non-approval kind.
      const ledger = h.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0].kind).toBe("fail-closed");
      expect(ledger[0].token).toBe(grantToken("click", ""));
      expect(ledger[0]).not.toHaveProperty("input");
    });

    it("does NOT gate the same MCP tool delivered on preToolUse (no double-gating)", () => {
      const h = setup({ mcpPolicies: { click: { requiresApproval: true } } });
      // preToolUse must fall through to allow for MCP — gating belongs to
      // beforeMCPExecution alone, so the denial is never recorded twice.
      const res = h.decide({ tool_name: "click", tool_input: "{}", hook_event_name: "preToolUse" });
      expect(res.permission).toBe("allow");
      expect(h.ledger()).toEqual([]);
    });

    it("scope guard: a foreign MCP invocation is allowed and never recorded", () => {
      const h = setup({
        mcpPolicies: { click: { requiresApproval: true } },
        runnerPid: 2_147_483_600,
      });
      expect(h.decide(hookMcp("click")).permission).toBe("allow");
      expect(h.ledger()).toEqual([]);
    });
  });

  // The enabled_tools capability manifest (issue #350): mcpServerEnabledTools
  // holds ONLY restricted servers; the hook denies a listed server's
  // non-listed tool with the non-pausing, permanent "disabled" kind — BEFORE
  // autoApproveAll and the grant checks, because a manifest is not an
  // approval gate (nothing may resurrect a disabled tool). hookMcp payloads
  // carry mcp_server_name "srv".
  describe("MCP enabled_tools manifest (beforeMCPExecution, issue #350)", () => {
    it("denies a non-enabled tool with kind disabled (content-free, single record) and the manifest message", () => {
      const h = setup({ mcpServerEnabledTools: { srv: ["list_apps"] } });

      const res = h.decide(hookMcp("click", { app: "Slack" }));

      expect(res.permission).toBe("deny");
      // Permanent-denial framing, never the approval promise: the model must
      // adapt, not wait for a resume that will never come.
      expect(res.raw).toContain("not enabled for this agent");
      expect(res.raw).not.toContain("submitted to the user for approval");
      const ledger = h.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0].kind).toBe("disabled");
      // Attributable under the MCP name-token (the identity the stream row
      // computes), content-free like every non-approval kind.
      expect(ledger[0].token).toBe(grantToken("click", ""));
      expect(ledger[0]).not.toHaveProperty("input");
    });

    it("allows an enabled tool on a restricted server", () => {
      const h = setup({ mcpServerEnabledTools: { srv: ["list_apps"] } });
      expect(h.decide(hookMcp("list_apps")).permission).toBe("allow");
      expect(h.ledger()).toEqual([]);
    });

    it("denies even under autoApproveAll (a manifest is not an approval gate)", () => {
      const h = setup({
        autoApproveAll: true,
        mcpServerEnabledTools: { srv: ["list_apps"] },
      });
      const res = h.decide(hookMcp("click"));
      expect(res.permission).toBe("deny");
      expect(h.ledger()[0].kind).toBe("disabled");
    });

    it("denies even when the tool holds a reinvocation grant (no approval may resurrect it)", () => {
      const h = setup({
        mcpServerEnabledTools: { srv: ["list_apps"] },
        grants: [{ toolName: "click", mcpServerSlug: "srv", key: "click", salient: "", contentDigest: "", sourceToolCallId: "consent-1" }],
      });
      const res = h.decide(hookMcp("click"));
      expect(res.permission).toBe("deny");
      expect(h.ledger()[0].kind).toBe("disabled");
    });

    it("stays kind disabled under unattended mode (mode-independent, like secret)", () => {
      const h = setup({
        unattendedSkip: true,
        mcpServerEnabledTools: { srv: ["list_apps"] },
      });
      const res = h.decide(hookMcp("click"));
      expect(res.permission).toBe("deny");
      expect(h.ledger()[0].kind).toBe("disabled");
    });

    it("an enabled tool still flows into the normal approval arm (manifest and gate compose)", () => {
      const h = setup({
        mcpPolicies: { click: { requiresApproval: true, message: "Approve click?" } },
        mcpServerEnabledTools: { srv: ["click"] },
      });
      const res = h.decide(hookMcp("click"));
      expect(res.permission).toBe("deny");
      expect(res.raw).toContain("Approve click?");
      expect(h.ledger()[0].kind).toBe("approval");
    });

    it("a restriction on ANOTHER server never narrows this one (server-scoped matching)", () => {
      const h = setup({ mcpServerEnabledTools: { other: ["something_else"] } });
      expect(h.decide(hookMcp("click")).permission).toBe("allow");
      expect(h.ledger()).toEqual([]);
    });

    it("quoted-name matching is exact — an enabled name never allows its prefix-sibling", () => {
      const h = setup({ mcpServerEnabledTools: { srv: ["list_apps_extended"] } });
      const res = h.decide(hookMcp("list_apps"));
      expect(res.permission).toBe("deny");
      expect(h.ledger()[0].kind).toBe("disabled");
    });

    it("never gates a preToolUse (built-in) payload — the manifest arm is MCP-event-scoped", () => {
      const h = setup({ mcpServerEnabledTools: { srv: ["list_apps"] } });
      expect(h.decide(hookRead("/x/a.txt")).permission).toBe("allow");
      expect(h.ledger()).toEqual([]);
    });
  });

  // The hook captures the COMPLETE tool_input on every denial (base64(JSON)),
  // so the runner can overlay the proposed change onto the gated tool call for
  // the approval preview — the cursor analog of the native harness reading args
  // from graph state at the interrupt. These pin the capture across taxonomies
  // (built-in object tool_input vs. MCP JSON-string tool_input).
  describe("captures tool_input on the denial ledger", () => {
    it("records the full built-in write input (object tool_input)", () => {
      const h = setup({});
      expect(h.decide(hookWrite("/x/a.txt", "export const x = 1;\n")).permission).toBe("deny");
      const ledger = h.ledger();
      expect(ledger).toHaveLength(1);
      expect(decodeInput(ledger[0].input)).toEqual({
        file_path: "/x/a.txt",
        content: "export const x = 1;\n",
      });
    });

    it("records an edit's old/new replacement strings", () => {
      const h = setup({});
      expect(h.decide(hookEdit("/x/a.txt", "alpha", "beta")).permission).toBe("deny");
      expect(decodeInput(h.ledger()[0].input)).toEqual({
        file_path: "/x/a.txt",
        old_string: "alpha",
        new_string: "beta",
      });
    });

    it("parses and records the MCP JSON-STRING tool_input", () => {
      // Cursor delivers MCP tool_input as a JSON string, not an object — the
      // extractor must parse it so the captured input is the same object shape.
      const h = setup({ mcpPolicies: { click: { requiresApproval: true } } });
      expect(h.decide(hookMcp("click", { app: "Slack", element_index: "59" })).permission).toBe("deny");
      expect(decodeInput(h.ledger()[0].input)).toEqual({ app: "Slack", element_index: "59" });
    });

    it("captures large multi-line content intact (printf, not echo/argv)", () => {
      const content = "line\n".repeat(20_000); // ~100 KB, exercises the printf write
      const h = setup({});
      expect(h.decide(hookWrite("/x/big.ts", content)).permission).toBe("deny");
      expect(decodeInput(h.ledger()[0].input).content).toBe(content);
    });
  });

  // Regression: the original grep-based extraction truncated string values at
  // the first JSON-escaped character, so a shell command containing double
  // quotes (e.g. `printf '%s' 'x' > "file"`) produced a ledger token that never
  // matched the runner's grantToken — the denied call stayed COMPLETED in the
  // persisted messages and a grant for it was re-denied on reinvocation.
  // (Observed live in TestCursorHarness_HITL_ResumedTurn_StillGated.)
  it("records a byte-identical token for commands with quotes, escapes, and newlines", () => {
    const commands = [
      'printf \'%s\' \'hello\' > "/tmp/a dir/resumed-gate.txt"',
      'echo "double \\"nested\\" quotes" && echo done',
      "line1\nline2\twith\ttabs",
      'unicode: caf\u00e9 \u2014 emoji \u{1F600}',
    ];
    for (const command of commands) {
      const h = setup({});
      expect(h.decide(hookShell(command)).permission).toBe("deny");
      const ledger = h.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0].token).toBe(grantToken("shell", command));
    }
  });

  it("allows the exact granted shell command even when it contains quotes", () => {
    const command = 'printf \'%s\' \'hello-resume\' > "/x/resumed-gate.txt"';
    const id = toolIdentity("shell", "", { command });
    const h = setup({ grants: [{ toolName: "shell", mcpServerSlug: "", key: id.key, salient: id.salient, contentDigest: "", sourceToolCallId: "consent-1" }] });

    expect(h.decide(hookShell(command)).permission).toBe("allow");
    // A different command is NOT covered by the grant -> still gated.
    expect(h.decide(hookShell('rm -rf "/x"')).permission).toBe("deny");
  });

  // The full runner<->hook closure, per gated category and for the bytes most
  // likely to drift: the token the RUNNER writes into approval-state.json (via
  // buildApprovalState, exactly as index.ts does on resume) is byte-identical to
  // the token the HOOK records when it denies the same action, and the hook's
  // grep -qF membership check then ALLOWS the re-issued call. This is the precise
  // production safety property — "approve once, allowed on the resumed turn" —
  // closed end to end rather than asserted on either half alone.
  describe("runner grant <-> hook allow closure (tricky args, every gated category)", () => {
    const cases: Array<{
      label: string;
      streamName: string;
      streamArgs: Record<string, unknown>;
      hookInput: object;
      otherHookInput: object;
    }> = [
      {
        label: "write — path with spaces, quotes, and unicode",
        streamName: "edit",
        // Content matches hookWrite's default ("x") so the runner-side grant
        // digest equals the hook-side content digest (content-exact closure).
        streamArgs: { path: '/work/a dir/"café" notes.md', content: "x" },
        hookInput: hookWrite('/work/a dir/"café" notes.md'),
        otherHookInput: hookWrite("/work/other.md"),
      },
      {
        label: "shell — multi-line heredoc with quotes and unicode",
        streamName: "shell",
        streamArgs: { command: "cat > notes.md << 'EOF'\n# Notes — \"x\" café\nEOF" },
        hookInput: hookShell("cat > notes.md << 'EOF'\n# Notes — \"x\" café\nEOF"),
        otherHookInput: hookShell("rm -rf build"),
      },
      {
        label: "delete — path with quotes",
        streamName: "delete",
        streamArgs: { path: '/work/"old" file.tmp' },
        hookInput: hookDelete('/work/"old" file.tmp'),
        otherHookInput: hookDelete("/work/keep.tmp"),
      },
    ];

    for (const { label, streamName, streamArgs, hookInput, otherHookInput } of cases) {
      it(`${label}: the state-file token the runner writes is the token the hook denies and then allows`, () => {
        // 1. The hook denies the un-granted call and records its identity token.
        const denyHarness = setup({});
        expect(denyHarness.decide(hookInput).permission).toBe("deny");
        const denialLedger = denyHarness.ledger();
        expect(denialLedger).toHaveLength(1);
        const hookDenialToken = denialLedger[0].token;

        // 2. The runner mints the grant from the STREAM-side identity (the only
        //    side it sees) and writes it into the real state file via
        //    buildApprovalState — the exact path index.ts takes on resume.
        const id = toolIdentity(streamName, "", streamArgs);
        const state = buildApprovalState(new Map(), false, new Set(), [
          { toolName: streamName, mcpServerSlug: "", key: id.key, salient: id.salient, contentDigest: contentDigest(streamArgs), sourceToolCallId: "consent-1" },
        ]);

        // 3. The state file carries the byte-exact token the hook recomputed —
        //    the grep -qF membership the bash hook performs (string equality).
        expect(state.approvedGrantTokens).toContain(hookDenialToken);

        // 4. With that state file, the hook ALLOWS the re-issued (fresh-id) call
        //    and re-gates a DIFFERENT resource of the same category.
        const grantHarness = setup({ grants: state.approvedGrants });
        expect(grantHarness.decide(hookInput).permission).toBe("allow");
        expect(grantHarness.decide(otherHookInput).permission).toBe("deny");
      });
    }
  });

  it("sibling isolation: approving one edit does NOT allow a DIFFERENT edit to the same file", () => {
    // The exact reported bug, closed end-to-end through the real hook: approving
    // the rename must re-gate the later `## TODO` edit to the SAME file.
    const path = "/work/notes.md";
    const renameArgs = { path, content: "Planton" };
    const id = toolIdentity("edit", "", renameArgs);
    const state = buildApprovalState(new Map(), false, new Set(), [
      { toolName: "edit", mcpServerSlug: "", key: id.key, salient: id.salient, contentDigest: contentDigest(renameArgs), sourceToolCallId: "consent-1" },
    ]);
    const h = setup({ grants: state.approvedGrants });

    // The approved edit, re-issued with the SAME content, is allowed.
    expect(h.decide(hookWrite(path, "Planton")).permission).toBe("allow");
    // A DIFFERENT edit to the SAME file is re-gated — the sibling hole is closed.
    expect(h.decide(hookWrite(path, "## TODO")).permission).toBe("deny");
  });

  // Issue #173: the hook ships on the workspace's shared .cursor/hooks.json, so
  // the user's own Cursor IDE (a DIFFERENT process tree) would load and run it
  // too. The scope guard must allow any invocation that does not descend from
  // the runner process — without gating it and without writing the denial ledger
  // (a foreign denial would surface as a phantom approval card in the session).
  describe("scope guard (issue #173): foreign invocations are not gated", () => {
    // A PID that cannot be an ancestor of the test's bash child. macOS pid_max is
    // 99998; this is comfortably above it and above a freshly-booted Linux
    // pid range, so get_ppid yields nothing and the walk reports "not own".
    const FOREIGN_PID = 2_147_483_600;

    it("allows a gated built-in when the invocation is not the runner's own agent", () => {
      const h = setup({ runnerPid: FOREIGN_PID });
      // The IDE would have this DENIED if the gate applied — it must be allowed.
      expect(h.decide(hookWrite("/x/a.txt")).permission).toBe("allow");
      expect(h.decide(hookShell("rm -rf build")).permission).toBe("allow");
    });

    it("never writes the denial ledger for a foreign invocation (no phantom approvals)", () => {
      const h = setup({ runnerPid: FOREIGN_PID });
      h.resetLedger();
      h.decide(hookWrite("/x/a.txt"));
      h.decide(hookShell("gh issue view 173"));
      // The IDE's tool calls must NOT leak into the ledger the runner reads back.
      expect(h.ledger()).toEqual([]);
    });

    it("allows a foreign invocation even when the state file is missing", () => {
      // Fail-closed is for the runner's OWN agent; a foreign client must never be
      // blocked by a missing state file (that was the multi-root exit-127 lockup).
      const h = setup({ runnerPid: FOREIGN_PID, noStateFile: true });
      expect(h.decide(hookWrite("/x/a.txt")).permission).toBe("allow");
      expect(h.ledger()).toEqual([]);
    });

    it("still gates the runner's own agent (control: gate applies in-process)", () => {
      // Same inputs, but runnerPid defaults to this process (an ancestor of the
      // bash child) — the gate must apply, proving the guard discriminates.
      const h = setup({});
      expect(h.decide(hookWrite("/x/a.txt")).permission).toBe("deny");
      expect(h.ledger()).toHaveLength(1);
    });
  });

  // Capture mode (git workspaces): file mutations flow during the turn (the
  // runner captures the whole change set with git and gates it per-file at the
  // turn boundary), while shell/MCP and gitignored writes stay on the deny-gate.
  describe("capture mode (git workspaces)", () => {
    it("allows write/edit/delete to flow and records no denial", () => {
      const h = setup({ captureMode: true });
      expect(h.decide(hookWrite("normal.txt")).permission).toBe("allow");
      expect(h.decide(hookEdit("normal.txt")).permission).toBe("allow");
      expect(h.decide(hookDelete("normal.txt")).permission).toBe("allow");
      expect(h.ledger()).toEqual([]);
    });

    it("still gates shell (it is not git-reversible)", () => {
      const h = setup({ captureMode: true });
      expect(h.decide(hookShell("rm -rf build")).permission).toBe("deny");
      expect(h.ledger().map((e) => e.toolName)).toContain("Shell");
    });

    it("still gates require-approval MCP tools", () => {
      const h = setup({ captureMode: true, mcpPolicies: { click: { requiresApproval: true } } });
      expect(h.decide(hookMcp("click")).permission).toBe("deny");
    });

    it("keeps gating a write to a GITIGNORED path (the snapshot cannot revert it)", () => {
      // A NON-secret gitignored path is invisible to the git snapshot, so capture
      // mode must still gate it for explicit approval. (A secret-like gitignored
      // write is hard-blocked instead — see the deny-gate secret cases below.)
      const h = setup({ captureMode: true, gitignored: ["ignored.txt"] });
      expect(h.decide(hookWrite("ignored.txt")).permission).toBe("deny");
      expect(h.ledger().map((e) => e.toolName)).toContain("Write");
      // A non-ignored sibling still flows.
      expect(h.decide(hookWrite("normal.txt")).permission).toBe("allow");
    });

    it("keeps gating a DELETE of a gitignored path", () => {
      const h = setup({ captureMode: true, gitignored: ["secret.txt"] });
      expect(h.decide(hookDelete("secret.txt")).permission).toBe("deny");
    });
  });

  // Deny-gate secret hard-block (DD-26 #2): with no capture substrate for a write
  // (capture off — the classic deny-gate — or captureIgnored off in a git-no-
  // storage workspace) a secret-like WRITE must NOT surface its content for
  // approval. The hook hard-blocks it with the security message and records a
  // kind:"secret" ledger entry — ATTRIBUTABLE (issue #205: the runner must know
  // this block was ours) but non-pausing (approvalDenials filters it out, so it
  // never becomes an approvable WAITING row) and content-free (DD-26: only the
  // identity token, never the proposed bytes). A non-secret write still
  // deny-gates as kind:"approval", and a delete (content-less) stays gated.
  describe("deny-gate secret hard-block (DD-26 #2)", () => {
    it("hard-blocks a secret-like write; records an attributable, content-free secret entry", () => {
      const h = setup({}); // captureMode off — the classic deny-gate
      const dec = h.decide(hookWrite(".env", "API_KEY=abc"));
      expect(dec.permission).toBe("deny");
      expect(dec.raw).toContain("blocked for security");
      // SECRET_BLOCKED, not APPROVAL_REQUIRED: the model is told to move on.
      expect(dec.raw.toLowerCase()).toContain("nothing was written");
      expect(dec.raw).not.toContain("submitted to the user for approval");
      const ledger = h.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0].kind).toBe("secret");
      // DD-26 on the raw ledger bytes: no input field, no trace of the content.
      expect(ledger[0]).not.toHaveProperty("input");
      expect(JSON.stringify(ledger[0])).not.toContain("API_KEY");
    });

    it("hard-blocks a secret-like edit (path-fragment match)", () => {
      const h = setup({});
      const dec = h.decide(hookEdit(".ssh/id_rsa"));
      expect(dec.permission).toBe("deny");
      expect(dec.raw).toContain("blocked for security");
      expect(h.ledger().map((e) => e.kind)).toEqual(["secret"]);
    });

    it("still deny-gates a NON-secret write and records its content for approval", () => {
      const h = setup({});
      const dec = h.decide(hookWrite("notes.md", "hello"));
      expect(dec.permission).toBe("deny");
      expect(dec.raw).toContain("submitted to the user for approval"); // APPROVAL_REQUIRED
      expect(h.ledger().map((e) => e.toolName)).toContain("Write");
      expect(h.ledger().map((e) => e.kind)).toEqual(["approval"]);
    });

    it("a write-category lease does NOT bypass the secret block", () => {
      const h = setup({ leasedCategories: ["write"] });
      expect(h.decide(hookWrite("notes.md", "x")).permission).toBe("allow"); // non-secret rides the lease
      const dec = h.decide(hookWrite(".env", "SECRET")); // secret is still hard-blocked
      expect(dec.permission).toBe("deny");
      expect(dec.raw).toContain("blocked for security");
      expect(h.ledger().map((e) => e.kind)).toEqual(["secret"]);
      expect(JSON.stringify(h.ledger())).not.toContain("SECRET");
    });

    it("hard-blocks a secret write in a git workspace with captureIgnored off (no storage)", () => {
      const h = setup({ captureMode: true, captureIgnored: false, gitignored: [".env"] });
      const dec = h.decide(hookWrite(".env", "API_KEY=abc"));
      expect(dec.permission).toBe("deny");
      expect(dec.raw).toContain("blocked for security");
      expect(h.ledger().map((e) => e.kind)).toEqual(["secret"]);
    });

    it("does NOT hard-block a secret DELETE (no content; stays deny-gated)", () => {
      const h = setup({});
      expect(h.decide(hookDelete(".env")).permission).toBe("deny");
      expect(h.ledger().map((e) => e.toolName)).toContain("Delete");
    });
  });

  // CAS parity (DD-18): with captureIgnored on, a non-secret gitignored write no
  // longer stays on the deny-gate — the hook stages its pre-turn bytes into the
  // cas-observations sidecar and ALLOWS it (apply-then-review), while a secret-
  // like gitignored write is hard-blocked and recorded as unreviewable. The
  // sidecar is read back through the real reader.
  describe("capture mode + captureIgnored (gitignored CAS capture)", () => {
    it("stages a non-secret gitignored ADD and allows it (before=null)", async () => {
      const h = setup({ captureMode: true, captureIgnored: true, gitignored: ["*.log"] });
      expect(h.decide(hookWrite("app.log", "hello")).permission).toBe("allow");
      // Flowed, not denied — it must not become a WAITING_APPROVAL row.
      expect(h.ledger()).toEqual([]);
      const obs = await h.observations();
      expect(obs.secretPaths).toEqual([]);
      expect(obs.captured).toHaveLength(1);
      expect(obs.captured[0].path).toBe("app.log");
      expect(obs.captured[0].before).toBeNull();
    });

    it("stages a non-secret gitignored MODIFY with the true pre-turn before-bytes", async () => {
      const h = setup({ captureMode: true, captureIgnored: true, gitignored: ["*.log"] });
      writeFileSync(join(h.root, "app.log"), "ORIGINAL", "utf-8");
      expect(h.decide(hookWrite("app.log", "NEW")).permission).toBe("allow");
      const obs = await h.observations();
      expect(obs.captured).toHaveLength(1);
      expect(obs.captured[0].before).not.toBeNull();
      expect(Buffer.from(obs.captured[0].before!).toString("utf8")).toBe("ORIGINAL");
    });

    it("first-touch-wins: two edits to one gitignored path keep the original before", async () => {
      const h = setup({ captureMode: true, captureIgnored: true, gitignored: ["*.log"] });
      writeFileSync(join(h.root, "app.log"), "ORIGINAL", "utf-8");
      expect(h.decide(hookWrite("app.log", "FIRST")).permission).toBe("allow");
      // Simulate the first write having applied, then a second edit this turn.
      writeFileSync(join(h.root, "app.log"), "FIRST", "utf-8");
      expect(h.decide(hookEdit("app.log")).permission).toBe("allow");
      const obs = await h.observations();
      expect(obs.captured).toHaveLength(1);
      expect(Buffer.from(obs.captured[0].before!).toString("utf8")).toBe("ORIGINAL");
    });

    it("hard-blocks a secret-like gitignored write; records a non-pausing secret entry", async () => {
      const h = setup({ captureMode: true, captureIgnored: true, gitignored: [".env"] });
      const d = h.decide(hookWrite(".env", "API_KEY=abc"));
      expect(d.permission).toBe("deny");
      expect(d.raw).toContain("blocked for security");
      // A secret is NOT approvable: its kind:"secret" entry attributes the block
      // to our own gate (issue #205) but is filtered out of the pause path — it
      // surfaces as DIFF_UNREVIEWABLE instead, and carries no content (DD-26).
      const ledger = h.ledger();
      expect(ledger.map((e) => e.kind)).toEqual(["secret"]);
      expect(ledger[0]).not.toHaveProperty("input");
      expect(JSON.stringify(ledger[0])).not.toContain("API_KEY");
      const obs = await h.observations();
      expect(obs.captured).toEqual([]);
      expect(obs.secretPaths).toEqual([".env"]);
    });

    it("a CAS staging error fails closed and records a content-free capture-error entry", async () => {
      const h = setup({ captureMode: true, captureIgnored: true, gitignored: ["*.log"] });
      // Force the staging script's "error" result: the sidecar dir path is
      // occupied by a regular FILE, so mkdir fails and the blob write throws.
      // (The harness keeps state/ledger/sidecar in .cursor/hooks — its hitlDir
      // analog; see setupCursorHookHarness.)
      writeFileSync(join(h.root, ".cursor", "hooks", "cas-observations"), "not a dir", "utf-8");
      const d = h.decide(hookWrite("app.log", "payload"));
      expect(d.permission).toBe("deny");
      // Denied with the approval message (fail-closed, today's deny-gate text)
      // but recorded as kind "capture-error": attributable, NON-pausing (there
      // is no approval that could make the write reviewable), and content-free
      // (the staging error means secret classification may never have run).
      expect(d.raw).toContain("submitted to the user for approval");
      const ledger = h.ledger();
      expect(ledger.map((e) => e.kind)).toEqual(["capture-error"]);
      expect(ledger[0]).not.toHaveProperty("input");
      expect(JSON.stringify(ledger[0])).not.toContain("payload");
    });

    it("captures under auto_approve_all too (capture is a turn property, not authorization)", async () => {
      const h = setup({
        captureMode: true,
        captureIgnored: true,
        autoApproveAll: true,
        gitignored: ["*.log", ".env"],
      });
      // Non-secret gitignored write is staged + allowed even under the bypass...
      expect(h.decide(hookWrite("app.log", "x")).permission).toBe("allow");
      // ...and a secret-like one is STILL hard-blocked under the bypass.
      expect(h.decide(hookWrite(".env", "SECRET")).permission).toBe("deny");
      const obs = await h.observations();
      expect(obs.captured.map((c) => c.path)).toEqual(["app.log"]);
      expect(obs.secretPaths).toEqual([".env"]);
    });

    it("does not stage a git-tracked write (git captures it) — flows, no observation", async () => {
      const h = setup({ captureMode: true, captureIgnored: true, gitignored: ["*.log"] });
      expect(h.decide(hookWrite("tracked.ts", "x")).permission).toBe("allow");
      const obs = await h.observations();
      expect(obs.captured).toEqual([]);
      expect(obs.secretPaths).toEqual([]);
    });

    it("stages a non-secret gitignored DELETE and allows it (issue #303)", async () => {
      const h = setup({ captureMode: true, captureIgnored: true, gitignored: ["*.log"] });
      writeFileSync(join(h.root, "app.log"), "DOOMED", "utf-8");
      expect(h.decide(hookDelete("app.log")).permission).toBe("allow");
      // Flowed, not denied — reviewed post-hoc as a DELETE entry, not a pause.
      expect(h.ledger()).toEqual([]);
      const obs = await h.observations();
      expect(obs.secretPaths).toEqual([]);
      expect(obs.captured).toHaveLength(1);
      expect(obs.captured[0].path).toBe("app.log");
      // The pre-delete bytes are staged — the restorable "before" side.
      expect(Buffer.from(obs.captured[0].before!).toString("utf8")).toBe("DOOMED");
    });

    it("first-touch-wins across write-then-delete: the true pre-turn before survives", async () => {
      const h = setup({ captureMode: true, captureIgnored: true, gitignored: ["*.log"] });
      writeFileSync(join(h.root, "app.log"), "ORIGINAL", "utf-8");
      expect(h.decide(hookWrite("app.log", "REWRITTEN")).permission).toBe("allow");
      // Simulate the write having applied, then a delete later this turn.
      writeFileSync(join(h.root, "app.log"), "REWRITTEN", "utf-8");
      expect(h.decide(hookDelete("app.log")).permission).toBe("allow");
      const obs = await h.observations();
      expect(obs.captured).toHaveLength(1);
      expect(Buffer.from(obs.captured[0].before!).toString("utf8")).toBe("ORIGINAL");
    });

    it("keeps a SECRET-LIKE gitignored delete on the deny-gate: approvable, never staged (issue #303)", async () => {
      // Unlike a secret write (hard-blocked — its content must never surface), a
      // delete's args expose no secret content, so a human may approve it. Its
      // before-bytes must never enter the sidecar though: staging would both
      // persist the secret bytes and mark the path "secret", making the boundary
      // author a blocking DIFF_UNREVIEWABLE for a merely-gated delete.
      const h = setup({ captureMode: true, captureIgnored: true, gitignored: [".env"] });
      writeFileSync(join(h.root, ".env"), "API_KEY=abc", "utf-8");
      const d = h.decide(hookDelete(".env"));
      expect(d.permission).toBe("deny");
      expect(d.raw).toContain("submitted to the user for approval"); // gated, not blocked
      expect(h.ledger().map((e) => e.kind)).toEqual(["approval"]);
      const obs = await h.observations();
      expect(obs.captured).toEqual([]);
      expect(obs.secretPaths).toEqual([]); // no secret marker for a gated delete
    });

    it("with captureIgnored OFF, a gitignored write stays denied and stages nothing", async () => {
      const h = setup({ captureMode: true, captureIgnored: false, gitignored: ["*.log"] });
      expect(h.decide(hookWrite("app.log", "x")).permission).toBe("deny");
      const obs = await h.observations();
      expect(obs.captured).toEqual([]);
    });
  });

  // Slice 2c: a NON-git workspace has no git snapshot, so EVERY file write and
  // (issue #303) every non-secret delete is CAS-staged and flowed for review —
  // not only gitignored ones — while shell/MCP gate as always. The workspace is
  // deliberately NOT git-initialized.
  describe("non-git workspace CAS capture (Slice 2c)", () => {
    it("stages EVERY write (not just gitignored) and allows it, no denial", async () => {
      const h = setup({ captureMode: true, captureIgnored: true, gitWorkspace: false });
      writeFileSync(join(h.root, "notes.md"), "ORIGINAL", "utf-8");
      expect(h.decide(hookWrite("notes.md", "NEW")).permission).toBe("allow");
      expect(h.ledger()).toEqual([]);
      const obs = await h.observations();
      expect(obs.secretPaths).toEqual([]);
      expect(obs.captured).toHaveLength(1);
      expect(obs.captured[0].path).toBe("notes.md");
      expect(Buffer.from(obs.captured[0].before!).toString("utf8")).toBe("ORIGINAL");
    });

    it("stages an ADD (before=null) and allows it", async () => {
      const h = setup({ captureMode: true, captureIgnored: true, gitWorkspace: false });
      expect(h.decide(hookWrite("created.ts", "x")).permission).toBe("allow");
      const obs = await h.observations();
      expect(obs.captured).toHaveLength(1);
      expect(obs.captured[0].before).toBeNull();
    });

    it("hard-blocks a secret-like write; records a non-pausing, content-free secret entry", async () => {
      const h = setup({ captureMode: true, captureIgnored: true, gitWorkspace: false });
      const dcn = h.decide(hookWrite(".env", "API_KEY=abc"));
      expect(dcn.permission).toBe("deny");
      expect(dcn.raw).toContain("blocked for security");
      const ledger = h.ledger();
      expect(ledger.map((e) => e.kind)).toEqual(["secret"]);
      expect(JSON.stringify(ledger[0])).not.toContain("API_KEY");
      const obs = await h.observations();
      expect(obs.captured).toEqual([]);
      expect(obs.secretPaths).toEqual([".env"]);
    });

    it("stages a DELETE with its pre-delete bytes and allows it (issue #303)", async () => {
      const h = setup({ captureMode: true, captureIgnored: true, gitWorkspace: false });
      writeFileSync(join(h.root, "notes.md"), "KEEP ME", "utf-8");
      expect(h.decide(hookDelete("notes.md")).permission).toBe("allow");
      expect(h.ledger()).toEqual([]);
      const obs = await h.observations();
      expect(obs.captured).toHaveLength(1);
      expect(obs.captured[0].path).toBe("notes.md");
      expect(Buffer.from(obs.captured[0].before!).toString("utf8")).toBe("KEEP ME");
    });

    it("keeps a secret-like DELETE gated (approvable) and stages nothing", async () => {
      const h = setup({ captureMode: true, captureIgnored: true, gitWorkspace: false });
      writeFileSync(join(h.root, ".env"), "API_KEY=abc", "utf-8");
      const d = h.decide(hookDelete(".env"));
      expect(d.permission).toBe("deny");
      expect(d.raw).toContain("submitted to the user for approval");
      expect(h.ledger().map((e) => e.kind)).toEqual(["approval"]);
      const obs = await h.observations();
      expect(obs.captured).toEqual([]);
      expect(obs.secretPaths).toEqual([]);
    });

    it("still gates shell (never git-reversible, never CAS-captured)", async () => {
      const h = setup({ captureMode: true, captureIgnored: true, gitWorkspace: false });
      expect(h.decide(hookShell("rm -rf /")).permission).toBe("deny");
    });

    it("still gates a require-approval MCP tool", async () => {
      const h = setup({
        captureMode: true,
        captureIgnored: true,
        gitWorkspace: false,
        mcpPolicies: { click: { requiresApproval: true } },
      });
      expect(h.decide(hookMcp("click")).permission).toBe("deny");
    });
  });

  it("still denies gated tools via the bash fallback when the Node binary is unavailable", () => {
    const ws = mkdtempSync(join(tmpdir(), "hook-script-fallback-"));
    onTestFinished(() => rmSync(ws, { recursive: true, force: true }));
    const dir = join(ws, ".cursor", "hooks");
    mkdirSync(dir, { recursive: true });
    const statePath = join(dir, "state.json");
    const ledgerPath = join(dir, "denials.jsonl");
    const pointerPath = join(dir, "active.json");
    const scriptPath = join(dir, "hook.sh");
    // Break the baked Node path to force the grep/cut fallback for BOTH the
    // active-turn pointer parse and the tool identity extraction.
    const script = generateHookScript(pointerPath)
      .replace(`NODE_BIN="${process.execPath}"`, 'NODE_BIN="/nonexistent/node"');
    writeFileSync(scriptPath, script, "utf-8");
    writeFileSync(
      pointerPath,
      JSON.stringify({ stateFile: statePath, ledgerFile: ledgerPath, runnerPid: process.pid }),
      "utf-8",
    );
    writeFileSync(statePath, JSON.stringify(buildApprovalState(new Map(), false, new Set())), "utf-8");

    const raw = execFileSync("bash", [scriptPath], {
      input: JSON.stringify(hookWrite("/x/a.txt")),
    }).toString();
    expect(raw).toContain('"permission":"deny"');
    const ledger = readFileSync(ledgerPath, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].token).toBe(grantToken("write", "/x/a.txt"));
    // record_denial is pure bash, so the kind tag survives the Node outage too.
    expect(ledger[0].kind).toBe("approval");
  });
});
