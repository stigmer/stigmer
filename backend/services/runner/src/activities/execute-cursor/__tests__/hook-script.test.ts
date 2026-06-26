/**
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
import { buildApprovalState, grantToken, toolIdentity } from "../approval-state.js";
import {
  setupCursorHookHarness as setup,
  hasBash,
  hookWrite,
  hookShell,
  hookDelete,
  hookRead,
  hookMcp,
} from "../__test-utils__/cursor-hook-harness.js";

const d = hasBash ? describe : describe.skip;

d("generated approval hook (preToolUse + beforeMCPExecution)", () => {
  it("denies gated built-ins (Write/Shell/Delete) and records a category+salient token", () => {
    const h = setup({});

    for (const [input, category, salient] of [
      [hookWrite("/x/a.txt"), "write", "/x/a.txt"],
      [hookShell("rm -rf build"), "shell", "rm -rf build"],
      [hookDelete("/x/b.txt"), "delete", "/x/b.txt"],
    ] as const) {
      h.resetLedger();
      expect(h.decide(input).permission).toBe("deny");
      const ledger = h.ledger();
      expect(ledger).toHaveLength(1);
      // Byte-identical to the runner's grantToken(category, salient).
      expect(ledger[0].token).toBe(grantToken(category, salient));
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

  it("fails closed (deny) when the state file is missing", () => {
    const h = setup({ noStateFile: true });
    expect(h.decide(hookWrite("/x/a.txt")).permission).toBe("deny");
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
        grants: [{ toolName: "click", mcpServerSlug: "srv", key: "click", salient: "" }],
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

    it("fails closed (deny) when the state file is missing", () => {
      const h = setup({ noStateFile: true });
      expect(h.decide(hookMcp("click")).permission).toBe("deny");
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
    const h = setup({ grants: [{ toolName: "shell", mcpServerSlug: "", key: id.key, salient: id.salient }] });

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
        streamArgs: { path: '/work/a dir/"café" notes.md' },
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
          { toolName: streamName, mcpServerSlug: "", key: id.key, salient: id.salient },
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

  it("still denies gated tools via the bash fallback when the Node binary is unavailable", () => {
    const ws = mkdtempSync(join(tmpdir(), "hook-script-fallback-"));
    onTestFinished(() => rmSync(ws, { recursive: true, force: true }));
    const dir = join(ws, ".cursor", "hooks");
    mkdirSync(dir, { recursive: true });
    const statePath = join(dir, "state.json");
    const ledgerPath = join(dir, "denials.jsonl");
    const scriptPath = join(dir, "hook.sh");
    // Break the baked Node path to force the grep/cut fallback.
    const script = generateHookScript(statePath, ledgerPath, process.pid)
      .replace(`NODE_BIN="${process.execPath}"`, 'NODE_BIN="/nonexistent/node"');
    writeFileSync(scriptPath, script, "utf-8");
    writeFileSync(statePath, JSON.stringify(buildApprovalState(new Map(), false, new Set())), "utf-8");

    const raw = execFileSync("bash", [scriptPath], {
      input: JSON.stringify(hookWrite("/x/a.txt")),
    }).toString();
    expect(raw).toContain('"permission":"deny"');
    const ledger = readFileSync(ledgerPath, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].token).toBe(grantToken("write", "/x/a.txt"));
  });
});
