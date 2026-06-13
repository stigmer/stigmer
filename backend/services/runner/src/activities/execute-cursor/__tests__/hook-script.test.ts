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

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateHookScript } from "../hook-script.js";
import { buildApprovalState, grantToken, toolIdentity, type ApprovalGrant } from "../approval-state.js";
import type { McpToolPolicyEntry } from "../approval-state.js";

let hasBash = false;
try {
  execSync("bash -c 'exit 0'", { stdio: "ignore" });
  hasBash = true;
} catch {
  hasBash = false;
}

const d = hasBash ? describe : describe.skip;

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Harness {
  decide(input: object): { permission: string; raw: string };
  ledger(): Array<{ toolName: string; token: string }>;
  resetLedger(): void;
}

function setup(opts: {
  autoApproveAll?: boolean;
  grants?: ApprovalGrant[];
  mcpPolicies?: Record<string, McpToolPolicyEntry>;
  noStateFile?: boolean;
  // Process the hook treats as "the runner". Defaults to this test process,
  // which is an ancestor of the bash child execFileSync spawns — so the scope
  // guard sees the call as the runner's own agent and applies the gate. Pass a
  // non-ancestor PID to exercise the foreign-client path (issue #173).
  runnerPid?: number;
}): Harness {
  const ws = mkdtempSync(join(tmpdir(), "hook-script-"));
  tempDirs.push(ws);
  const dir = join(ws, ".cursor", "hooks");
  mkdirSync(dir, { recursive: true });
  const statePath = join(dir, "state.json");
  const ledgerPath = join(dir, "denials.jsonl");
  const scriptPath = join(dir, "hook.sh");
  writeFileSync(scriptPath, generateHookScript(statePath, ledgerPath, opts.runnerPid ?? process.pid), "utf-8");

  if (!opts.noStateFile) {
    const policies = new Map(
      Object.entries(opts.mcpPolicies ?? {}).map(([name, p]) => [
        `srv/${name}`,
        { toolName: name, mcpServerSlug: "srv", requiresApproval: p.requiresApproval, approvalMessage: p.message ?? "" },
      ]),
    );
    const state = buildApprovalState(policies, opts.autoApproveAll ?? false, opts.grants);
    writeFileSync(statePath, JSON.stringify(state), "utf-8");
  }

  return {
    decide(input: object) {
      const raw = execFileSync("bash", [scriptPath], { input: JSON.stringify(input) }).toString();
      const permission = raw.includes('"permission":"deny"') ? "deny" : raw.includes('"permission":"allow"') ? "allow" : "?";
      return { permission, raw };
    },
    ledger() {
      if (!existsSync(ledgerPath)) return [];
      return readFileSync(ledgerPath, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    },
    resetLedger() {
      writeFileSync(ledgerPath, "", "utf-8");
    },
  };
}

// Real hook-input shapes (PascalCase name, file_path/command in tool_input).
const hookWrite = (filePath: string) => ({ tool_name: "Write", tool_input: { file_path: filePath, content: "x" } });
const hookShell = (command: string) => ({ tool_name: "Shell", tool_input: { command, cwd: "/x", timeout: 30000 } });
const hookDelete = (filePath: string) => ({ tool_name: "Delete", tool_input: { file_path: filePath } });
const hookRead = (filePath: string) => ({ tool_name: "Read", tool_input: { file_path: filePath } });

d("generated preToolUse hook", () => {
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

  it("allows the EXACT granted resource and re-gates any other (no name-only over-grant)", () => {
    const id = toolIdentity("edit", "", { path: "/x/a.txt" });
    const h = setup({ grants: [{ toolName: "edit", mcpServerSlug: "", key: id.key, salient: id.salient }] });

    // Same resource the user approved -> allowed on the resumed turn.
    expect(h.decide(hookWrite("/x/a.txt")).permission).toBe("allow");
    // A different file is NOT covered by the grant -> still gated.
    expect(h.decide(hookWrite("/x/OTHER.txt")).permission).toBe("deny");
  });

  it("denies require-approval MCP tools and allows them once granted (name-only)", () => {
    const mcpPolicies = { apply_x: { requiresApproval: true, message: "Apply X" } };
    const denyH = setup({ mcpPolicies });
    expect(denyH.decide({ tool_name: "apply_x", tool_input: {} }).permission).toBe("deny");
    expect(denyH.ledger()[0].token).toBe(grantToken("apply_x", ""));

    const grantH = setup({
      mcpPolicies,
      grants: [{ toolName: "apply_x", mcpServerSlug: "srv", key: "apply_x", salient: "" }],
    });
    expect(grantH.decide({ tool_name: "apply_x", tool_input: {} }).permission).toBe("allow");
  });

  it("fails closed (deny) when the state file is missing", () => {
    const h = setup({ noStateFile: true });
    expect(h.decide(hookWrite("/x/a.txt")).permission).toBe("deny");
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
    tempDirs.push(ws);
    const dir = join(ws, ".cursor", "hooks");
    mkdirSync(dir, { recursive: true });
    const statePath = join(dir, "state.json");
    const ledgerPath = join(dir, "denials.jsonl");
    const scriptPath = join(dir, "hook.sh");
    // Break the baked Node path to force the grep/cut fallback.
    const script = generateHookScript(statePath, ledgerPath, process.pid)
      .replace(`NODE_BIN="${process.execPath}"`, 'NODE_BIN="/nonexistent/node"');
    writeFileSync(scriptPath, script, "utf-8");
    writeFileSync(statePath, JSON.stringify(buildApprovalState(new Map(), false)), "utf-8");

    const raw = execFileSync("bash", [scriptPath], {
      input: JSON.stringify(hookWrite("/x/a.txt")),
    }).toString();
    expect(raw).toContain('"permission":"deny"');
    const ledger = readFileSync(ledgerPath, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].token).toBe(grantToken("write", "/x/a.txt"));
  });
});
