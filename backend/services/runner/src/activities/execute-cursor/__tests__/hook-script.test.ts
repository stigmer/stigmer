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
}): Harness {
  const ws = mkdtempSync(join(tmpdir(), "hook-script-"));
  tempDirs.push(ws);
  const dir = join(ws, ".cursor", "hooks");
  mkdirSync(dir, { recursive: true });
  const statePath = join(dir, "state.json");
  const ledgerPath = join(dir, "denials.jsonl");
  const scriptPath = join(dir, "hook.sh");
  writeFileSync(scriptPath, generateHookScript(statePath, ledgerPath), "utf-8");

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
});
