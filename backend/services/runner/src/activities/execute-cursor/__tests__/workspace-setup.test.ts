/**
 * Tests for the HITL gate's workspace lifecycle (issue #173).
 *
 * The gate must leave the user's real repo untouched: its runtime artifacts live
 * outside the workspace, the only in-repo file (`.cursor/hooks.json`) is merged
 * with any pre-existing user config and points at the hook by absolute path, and
 * the whole surface is restored when the turn ends. These tests pin all four of
 * those guarantees plus the self-healing strip of a crash-leftover entry.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  installHitlGate,
  removeHitlGate,
  buildMergedConfig,
} from "../workspace-setup.js";
import { buildApprovalState } from "../approval-state.js";
import { getHitlGateDir } from "../../../shared/workspace/platform-dir.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "ws-setup-"));
  tempDirs.push(dir);
  return dir;
}

// A script path that looks like the real one so isStigmerHookEntry recognizes it.
const stigmerScript = (root: string) =>
  join(root, ".stigmer", "sessions", "ses-1", "hitl", "stigmer-approval.sh");

// Single preToolUse registration — the common shape in these tests.
const pre = (scriptPath: string) => [{ event: "preToolUse", scriptPath }];

describe("buildMergedConfig", () => {
  it("writes a standalone config and restores by delete when no hooks.json exists", () => {
    const { merged, restoreTo } = buildMergedConfig(null, pre("/abs/hitl/stigmer-approval.sh"));
    const parsed = JSON.parse(merged);
    expect(parsed.hooks.preToolUse).toHaveLength(1);
    expect(parsed.hooks.preToolUse[0].command).toBe("/abs/hitl/stigmer-approval.sh");
    expect(parsed.hooks.preToolUse[0].failClosed).toBe(true);
    // null restore target → teardown deletes the file we created.
    expect(restoreTo).toBeNull();
  });

  it("registers multiple events (preToolUse + beforeMCPExecution) and restores by delete", () => {
    const { merged, restoreTo } = buildMergedConfig(null, [
      { event: "preToolUse", scriptPath: "/abs/hitl/stigmer-approval.sh" },
      { event: "beforeMCPExecution", scriptPath: "/abs/hitl/stigmer-mcp-capture.sh" },
    ]);
    const parsed = JSON.parse(merged);
    expect(parsed.hooks.preToolUse[0].command).toBe("/abs/hitl/stigmer-approval.sh");
    expect(parsed.hooks.beforeMCPExecution[0].command).toBe("/abs/hitl/stigmer-mcp-capture.sh");
    expect(parsed.hooks.beforeMCPExecution[0].failClosed).toBe(true);
    expect(restoreTo).toBeNull();
  });

  it("merges into both event arrays and strips stale Stigmer entries from each on restore", () => {
    const root = "/abs";
    const stalePre = join(root, ".stigmer", "sessions", "ses-1", "hitl", "stigmer-approval.sh");
    const staleMcp = join(root, ".stigmer", "sessions", "ses-1", "hitl", "stigmer-mcp-capture.sh");
    const original = JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [{ command: "./user.sh" }, { command: stalePre, failClosed: true }],
        beforeMCPExecution: [{ command: staleMcp, failClosed: true }],
      },
    });
    const freshPre = join(root, ".stigmer", "sessions", "ses-2", "hitl", "stigmer-approval.sh");
    const freshMcp = join(root, ".stigmer", "sessions", "ses-2", "hitl", "stigmer-mcp-capture.sh");

    const { merged, restoreTo } = buildMergedConfig(original, [
      { event: "preToolUse", scriptPath: freshPre },
      { event: "beforeMCPExecution", scriptPath: freshMcp },
    ]);

    const m = JSON.parse(merged);
    expect(m.hooks.preToolUse.map((e: any) => e.command)).toEqual(["./user.sh", freshPre]);
    expect(m.hooks.beforeMCPExecution.map((e: any) => e.command)).toEqual([freshMcp]);

    // Restore is self-healing: every stale Stigmer entry is removed from both.
    const r = JSON.parse(restoreTo!);
    expect(r.hooks.preToolUse).toEqual([{ command: "./user.sh" }]);
    expect(r.hooks.beforeMCPExecution).toEqual([]);
  });

  it("merges with a user's hooks.json and restores the original bytes verbatim", () => {
    const original = JSON.stringify(
      {
        version: 1,
        hooks: {
          preToolUse: [{ command: "./user-hook.sh", timeout: 5 }],
          postToolUse: [{ command: "./user-post.sh" }],
        },
      },
      null,
      2,
    );
    const script = "/abs/.stigmer/sessions/ses-1/hitl/stigmer-approval.sh";
    const { merged, restoreTo } = buildMergedConfig(original, pre(script));
    const parsed = JSON.parse(merged);

    // Our entry is appended; the user's preToolUse hook is preserved...
    expect(parsed.hooks.preToolUse).toHaveLength(2);
    expect(parsed.hooks.preToolUse[0].command).toBe("./user-hook.sh");
    expect(parsed.hooks.preToolUse[1].command).toBe(script);
    // ...as is every other hook type and field.
    expect(parsed.hooks.postToolUse).toEqual([{ command: "./user-post.sh" }]);
    // Restore is byte-identical to the user's original.
    expect(restoreTo).toBe(original);
  });

  it("strips a stale Stigmer entry (crash leftover) from both merged and restore", () => {
    const root = "/abs";
    const stale = stigmerScript(root); // a previous turn's entry
    const original = JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [
          { command: "./user-hook.sh" },
          { command: stale, timeout: 10, failClosed: true },
        ],
      },
    });
    const fresh = join(root, ".stigmer", "sessions", "ses-2", "hitl", "stigmer-approval.sh");
    const { merged, restoreTo } = buildMergedConfig(original, pre(fresh));

    const mergedParsed = JSON.parse(merged);
    // No duplicate: user entry + exactly one fresh Stigmer entry.
    expect(mergedParsed.hooks.preToolUse).toHaveLength(2);
    expect(mergedParsed.hooks.preToolUse.map((e: any) => e.command)).toEqual([
      "./user-hook.sh",
      fresh,
    ]);
    // Restore is the CLEANED user config — the stale entry is gone (self-healing).
    const restoreParsed = JSON.parse(restoreTo!);
    expect(restoreParsed.hooks.preToolUse).toEqual([{ command: "./user-hook.sh" }]);
  });

  it("replaces an unparseable hooks.json for the turn but restores its exact bytes", () => {
    const garbage = "{ this is not json ";
    const { merged, restoreTo } = buildMergedConfig(garbage, pre("/abs/hitl/stigmer-approval.sh"));
    // We still install a working gate for the turn...
    expect(JSON.parse(merged).hooks.preToolUse).toHaveLength(1);
    // ...and never "fix" the user's file: restore their exact original bytes.
    expect(restoreTo).toBe(garbage);
  });

  // ── H-G regression: the pre-#173 in-workspace hook ──────────────────────────
  // The root cause of "approved tool still blocked": an older runner build wrote
  // the gate INTO the repo as `.cursor/hooks/stigmer-approval.sh` (a relative
  // command). The recognizer used to match only the current `/.stigmer/sessions/`
  // path, so the merge treated this stale entry as a USER hook and preserved it —
  // it then ran alongside the current gate and vetoed every gated tool, even
  // approved ones. These pin that it is now recognized, stripped, and self-healed.

  it("recognizes and strips the legacy in-workspace hook; deletes the entirely-leftover file", () => {
    // The exact shape observed in a polluted repo.
    const original = JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [
          { command: ".cursor/hooks/stigmer-approval.sh", timeout: 10, failClosed: true },
        ],
      },
    });
    const fresh = "/home/u/.stigmer/sessions/ses-9/hitl/stigmer-approval.sh";
    const { merged, restoreTo } = buildMergedConfig(original, pre(fresh));

    // The active config carries ONLY the current runner hook — the stale legacy
    // entry is gone, so it can never run alongside (and veto) the live gate.
    const m = JSON.parse(merged);
    expect(m.hooks.preToolUse.map((e: any) => e.command)).toEqual([fresh]);

    // The whole hooks.json was our own leftover (only version+hooks, no user
    // hooks remain after stripping) → teardown deletes it, leaving the repo
    // pristine rather than a `{hooks:{preToolUse:[]}}` husk.
    expect(restoreTo).toBeNull();
  });

  it("strips the legacy hook but preserves a genuine user hook in the same array", () => {
    const original = JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [
          { command: "./user.sh" },
          { command: ".cursor/hooks/stigmer-approval.sh", timeout: 10, failClosed: true },
        ],
      },
    });
    const fresh = "/home/u/.stigmer/sessions/ses-9/hitl/stigmer-approval.sh";
    const { merged, restoreTo } = buildMergedConfig(original, pre(fresh));

    // No duplicate, stale legacy entry dropped, user hook kept ahead of ours.
    expect(JSON.parse(merged).hooks.preToolUse.map((e: any) => e.command)).toEqual([
      "./user.sh",
      fresh,
    ]);
    // A real user hook remains → restore the cleaned form, not delete.
    expect(JSON.parse(restoreTo!).hooks.preToolUse).toEqual([{ command: "./user.sh" }]);
  });
});

describe("installHitlGate / removeHitlGate", () => {
  const approvalState = buildApprovalState(new Map(), false, new Set());

  // Sandbox HOME so the workspace-scoped gate dir (`~/.stigmer/hitl-gate/<hash>`)
  // lands under the per-test temp root, asserted and cleaned with everything else.
  const realHome = process.env.HOME;
  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
  });

  function dirs() {
    const root = freshRoot();
    process.env.HOME = root;
    const workspaceRoot = join(root, "repo");
    const hitlDir = join(root, ".stigmer", "sessions", "ses-1", "hitl");
    mkdirSync(workspaceRoot, { recursive: true });
    // The stable hook script + active-turn pointer live in the workspace-scoped
    // gate dir (outside the repo), not the per-session HITL dir.
    const gateDir = getHitlGateDir(workspaceRoot);
    return { workspaceRoot, hitlDir, gateDir };
  }

  it("writes artifacts OUTSIDE the workspace and a hooks.json with an absolute command", async () => {
    const { workspaceRoot, hitlDir, gateDir } = dirs();
    await installHitlGate({ workspaceRoot, hitlDir, approvalState, runnerPid: process.pid });

    // Per-session hook input/output live in the HITL dir; the STABLE hook script
    // and the active-turn pointer live in the workspace gate dir. Neither is in
    // the repo.
    expect(existsSync(join(hitlDir, "approval-state.json"))).toBe(true);
    expect(existsSync(join(hitlDir, "denials.jsonl"))).toBe(true);
    expect(existsSync(join(gateDir, "stigmer-approval.sh"))).toBe(true);
    expect(existsSync(join(gateDir, "active.json"))).toBe(true);
    // The script is executable.
    expect(statSync(join(gateDir, "stigmer-approval.sh")).mode & 0o111).toBeTruthy();

    // The pointer names THIS turn's per-session artifacts + runner PID.
    const pointer = JSON.parse(readFileSync(join(gateDir, "active.json"), "utf-8"));
    expect(pointer.stateFile).toBe(join(hitlDir, "approval-state.json"));
    expect(pointer.ledgerFile).toBe(join(hitlDir, "denials.jsonl"));
    expect(pointer.runnerPid).toBe(process.pid);

    // The only in-repo file is hooks.json, pointing at the STABLE script by
    // ABSOLUTE path (the relative path was the multi-root exit-127 bug).
    const hooksJson = JSON.parse(
      readFileSync(join(workspaceRoot, ".cursor", "hooks.json"), "utf-8"),
    );
    const command = hooksJson.hooks.preToolUse[0].command;
    expect(command).toBe(join(gateDir, "stigmer-approval.sh"));
    expect(command.startsWith("/")).toBe(true);
    // The SAME script gates MCP via beforeMCPExecution (preToolUse does not
    // enforce MCP); the script branches internally on hook_event_name.
    expect(hooksJson.hooks.beforeMCPExecution[0].command).toBe(
      join(gateDir, "stigmer-approval.sh"),
    );
    // The workspace holds no relocated artifacts.
    expect(existsSync(join(workspaceRoot, ".cursor", "hooks"))).toBe(false);
  });

  it("leaves NO Stigmer files in the repo after teardown (failure mode 4)", async () => {
    const { workspaceRoot, hitlDir } = dirs();
    const handle = await installHitlGate({
      workspaceRoot, hitlDir, approvalState, runnerPid: process.pid,
    });
    expect(existsSync(join(workspaceRoot, ".cursor", "hooks.json"))).toBe(true);

    await removeHitlGate(handle);

    // The repo is clean: no hooks.json, no hook scripts, no ledger.
    expect(existsSync(join(workspaceRoot, ".cursor", "hooks.json"))).toBe(false);
    expect(existsSync(join(workspaceRoot, ".cursor", "hooks"))).toBe(false);
  });

  it("restores a pre-existing user hooks.json byte-for-byte after teardown", async () => {
    const { workspaceRoot, hitlDir } = dirs();
    const cursorDir = join(workspaceRoot, ".cursor");
    mkdirSync(cursorDir, { recursive: true });
    const userConfig = JSON.stringify(
      { version: 1, hooks: { preToolUse: [{ command: "./mine.sh" }] } },
      null,
      2,
    );
    const hooksPath = join(cursorDir, "hooks.json");
    writeFileSync(hooksPath, userConfig, "utf-8");

    const handle = await installHitlGate({
      workspaceRoot, hitlDir, approvalState, runnerPid: process.pid,
    });
    // During the turn our entry is present alongside the user's.
    const during = JSON.parse(readFileSync(hooksPath, "utf-8"));
    expect(during.hooks.preToolUse).toHaveLength(2);

    await removeHitlGate(handle);

    // After the turn the file is byte-identical to what the user had.
    expect(readFileSync(hooksPath, "utf-8")).toBe(userConfig);
  });

  it("is repeatable across turns (install/remove/install/remove) and ends clean", async () => {
    const { workspaceRoot, hitlDir } = dirs();
    for (let turn = 0; turn < 2; turn++) {
      const handle = await installHitlGate({
        workspaceRoot, hitlDir, approvalState, runnerPid: process.pid,
      });
      expect(existsSync(join(workspaceRoot, ".cursor", "hooks.json"))).toBe(true);
      await removeHitlGate(handle);
      expect(existsSync(join(workspaceRoot, ".cursor", "hooks.json"))).toBe(false);
    }
  });

  it("installs the always-applied tool-approval rule and removes it on teardown", async () => {
    const { workspaceRoot, hitlDir } = dirs();
    const rulePath = join(workspaceRoot, ".cursor", "rules", "stigmer-tool-approval.mdc");

    const handle = await installHitlGate({
      workspaceRoot, hitlDir, approvalState, runnerPid: process.pid,
    });
    // During the turn the rule is present and carries the protocol.
    expect(existsSync(rulePath)).toBe(true);
    const ruleBody = readFileSync(rulePath, "utf-8");
    expect(ruleBody).toContain("alwaysApply: true");
    expect(ruleBody.toLowerCase()).toContain("blocked by a hook");

    await removeHitlGate(handle);
    // Teardown removes our rule and the now-empty rules dir (the repo had none).
    expect(existsSync(rulePath)).toBe(false);
    expect(existsSync(join(workspaceRoot, ".cursor", "rules"))).toBe(false);
  });

  it("heals a workspace polluted by a pre-#173 in-workspace gate (H-G end-to-end)", async () => {
    const { workspaceRoot, hitlDir, gateDir } = dirs();
    // Reconstruct exactly what a polluted repo looks like: a hooks.json pointing
    // at a relative in-workspace script, plus the orphaned script/state/ledger
    // files an older runner left in `.cursor/hooks/`.
    const cursorDir = join(workspaceRoot, ".cursor");
    const legacyHooksDir = join(cursorDir, "hooks");
    mkdirSync(legacyHooksDir, { recursive: true });
    writeFileSync(
      join(cursorDir, "hooks.json"),
      JSON.stringify({
        version: 1,
        hooks: {
          preToolUse: [
            { command: ".cursor/hooks/stigmer-approval.sh", timeout: 10, failClosed: true },
          ],
        },
      }),
      "utf-8",
    );
    writeFileSync(join(legacyHooksDir, "stigmer-approval.sh"), "#!/bin/bash\nexit 0\n", "utf-8");
    writeFileSync(join(legacyHooksDir, "stigmer-approval-state.json"), "{}", "utf-8");
    writeFileSync(join(legacyHooksDir, "stigmer-denials.jsonl"), "", "utf-8");

    const handle = await installHitlGate({
      workspaceRoot, hitlDir, approvalState, runnerPid: process.pid,
    });

    // The active gate is ONLY the current runner-owned hook (absolute, in the
    // session dir). The stale relative entry that vetoed approved tools is gone.
    const during = JSON.parse(readFileSync(join(cursorDir, "hooks.json"), "utf-8"));
    expect(during.hooks.preToolUse.map((e: any) => e.command)).toEqual([
      join(gateDir, "stigmer-approval.sh"),
    ]);
    // The orphaned legacy files are removed; the now-empty hooks dir is gone too.
    expect(existsSync(join(legacyHooksDir, "stigmer-approval.sh"))).toBe(false);
    expect(existsSync(join(legacyHooksDir, "stigmer-approval-state.json"))).toBe(false);
    expect(existsSync(join(legacyHooksDir, "stigmer-denials.jsonl"))).toBe(false);
    expect(existsSync(legacyHooksDir)).toBe(false);

    await removeHitlGate(handle);
    // The hooks.json was entirely our own leftover → teardown deletes it, leaving
    // the repo pristine (no husk, no stale entry waiting to re-pollute).
    expect(existsSync(join(cursorDir, "hooks.json"))).toBe(false);
  });

  it("removes only stigmer-* files from .cursor/hooks, preserving a user's own hook script", async () => {
    const { workspaceRoot, hitlDir } = dirs();
    const legacyHooksDir = join(workspaceRoot, ".cursor", "hooks");
    mkdirSync(legacyHooksDir, { recursive: true });
    writeFileSync(join(legacyHooksDir, "stigmer-approval.sh"), "#!/bin/bash\nexit 0\n", "utf-8");
    writeFileSync(join(legacyHooksDir, "user-custom.sh"), "#!/bin/bash\necho hi\n", "utf-8");

    const handle = await installHitlGate({
      workspaceRoot, hitlDir, approvalState, runnerPid: process.pid,
    });

    // Our leftover is gone; the user's script and the dir they own remain.
    expect(existsSync(join(legacyHooksDir, "stigmer-approval.sh"))).toBe(false);
    expect(readFileSync(join(legacyHooksDir, "user-custom.sh"), "utf-8")).toBe(
      "#!/bin/bash\necho hi\n",
    );
    expect(existsSync(legacyHooksDir)).toBe(true);

    await removeHitlGate(handle);
  });

  it("preserves a user's own .cursor/rules and rules dir after teardown", async () => {
    const { workspaceRoot, hitlDir } = dirs();
    const rulesDir = join(workspaceRoot, ".cursor", "rules");
    mkdirSync(rulesDir, { recursive: true });
    const userRule = join(rulesDir, "user-rule.mdc");
    writeFileSync(userRule, "---\nalwaysApply: false\n---\nmine\n", "utf-8");

    const handle = await installHitlGate({
      workspaceRoot, hitlDir, approvalState, runnerPid: process.pid,
    });
    await removeHitlGate(handle);

    // Our rule is gone; the user's rule and the dir they owned remain untouched.
    expect(existsSync(join(rulesDir, "stigmer-tool-approval.mdc"))).toBe(false);
    expect(readFileSync(userRule, "utf-8")).toBe("---\nalwaysApply: false\n---\nmine\n");
    expect(existsSync(rulesDir)).toBe(true);
  });
});
