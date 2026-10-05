/**
 * Tests for the HITL gate's workspace lifecycle (issue #173).
 *
 * The gate must leave the user's real repo untouched: its runtime artifacts live
 * outside the workspace, the in-repo `.cursor/hooks.json` holds only the gate's
 * entries for the turn (a repository's own are set aside, so only the agent's
 * own hooks run) and points at the hook by absolute path, a runner-owned
 * folder's `.claude` settings hooks are set aside too, and every file is
 * restored when the turn ends, an agent's own edit kept. These tests pin those
 * guarantees plus the self-healing strip of a crash-leftover entry and the
 * restore of a crashed turn's snapshot.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
  chmodSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  installHitlGate,
  removeHitlGate,
  buildMergedConfig,
} from "../workspace-setup.js";
import {
  claudeSettingsWithHooks,
  CursorWorkspaceHooksRefusal,
  refuseLinkedGateFile,
  refuseOwnFolderHooks,
  restoreAbandonedWorkspaceFiles,
  rewriteWorkspaceFiles,
  workspaceFolders,
} from "../workspace-hook-files.js";
import { spawnSync } from "node:child_process";
import { buildApprovalState } from "../approval-state.js";
import { NO_MCP_DEFAULT } from "../__test-utils__/cursor-hook-harness.js";
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

  it("sets every repository entry aside for the turn and strips stale Stigmer entries from each on restore", () => {
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
    expect(m.hooks.preToolUse.map((e: any) => e.command)).toEqual([freshPre]);
    expect(m.hooks.beforeMCPExecution.map((e: any) => e.command)).toEqual([freshMcp]);

    // Restore is self-healing: every stale Stigmer entry is removed from both.
    const r = JSON.parse(restoreTo!);
    expect(r.hooks.preToolUse).toEqual([{ command: "./user.sh" }]);
    expect(r.hooks.beforeMCPExecution).toEqual([]);
  });

  it("holds only the gate's entries for the turn, keeps every other field, and restores the original bytes", () => {
    const original = JSON.stringify(
      {
        version: 1,
        note: "the repository's own field",
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

    // Only the gate's entry runs this turn, on every event: the repository's
    // preToolUse and postToolUse hooks are set aside...
    expect(parsed.hooks).toEqual({ preToolUse: [{ command: script, timeout: 10, failClosed: true }] });
    // ...and every other field of the file is kept.
    expect(parsed.note).toBe("the repository's own field");
    // Restore is byte-identical to the user's original.
    expect(restoreTo).toBe(original);
  });

  it("replaces a hooks.json that is not an object, and keeps an event that is not a list", () => {
    expect(buildMergedConfig("[]", pre("/abs/hitl/stigmer-approval.sh")).restoreTo).toBe("[]");
    const original = JSON.stringify({ version: 1, hooks: { odd: "not a list", preToolUse: [{ command: "/h/.stigmer/x/stigmer-approval.sh" }] } });
    expect(JSON.parse(buildMergedConfig(original, pre("/abs/hitl/stigmer-approval.sh")).restoreTo!).hooks).toEqual({ odd: "not a list", preToolUse: [] });
  });

  it("gives each entry the timeout it is asked for", () => {
    const { merged } = buildMergedConfig(null, pre("/abs/hitl/stigmer-approval.sh"), 630);
    expect(JSON.parse(merged).hooks.preToolUse[0].timeout).toBe(630);
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
    // No duplicate: exactly one fresh Stigmer entry, the user's set aside.
    expect(mergedParsed.hooks.preToolUse.map((e: any) => e.command)).toEqual([fresh]);
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

    // No duplicate, stale legacy entry dropped, the user's hook set aside for the turn.
    expect(JSON.parse(merged).hooks.preToolUse.map((e: any) => e.command)).toEqual([fresh]);
    // A real user hook remains → restore the cleaned form, not delete.
    expect(JSON.parse(restoreTo!).hooks.preToolUse).toEqual([{ command: "./user.sh" }]);
  });
});

describe("installHitlGate / removeHitlGate", () => {
  const approvalState = buildApprovalState(NO_MCP_DEFAULT, false, new Set());

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

  it("sets a repository's own hooks aside for the turn, on every event, and returns them after", async () => {
    const { workspaceRoot, hitlDir, gateDir } = dirs();
    const cursorDir = join(workspaceRoot, ".cursor");
    mkdirSync(cursorDir, { recursive: true });
    const userConfig = JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [{ command: "./gate-writes.sh", failClosed: true }],
        postToolUse: [{ command: "./audit.sh" }],
        sessionStart: [{ command: "./hello.sh" }],
      },
    });
    writeFileSync(join(cursorDir, "hooks.json"), userConfig, "utf-8");

    const handle = await installHitlGate({ workspaceRoot, hitlDir, approvalState, runnerPid: process.pid });
    const during = JSON.parse(readFileSync(join(cursorDir, "hooks.json"), "utf-8"));
    const script = join(gateDir, "stigmer-approval.sh");
    expect(Object.keys(during.hooks).sort()).toEqual(["beforeMCPExecution", "preToolUse", "subagentStart"]);
    expect(during.hooks.preToolUse.map((e: any) => e.command)).toEqual([script]);

    await removeHitlGate(handle);
    expect(readFileSync(join(cursorDir, "hooks.json"), "utf-8")).toBe(userConfig);
  });

  it("registers postToolUse and a timeout over the longest hook, and points the script at the hook server", async () => {
    const { workspaceRoot, hitlDir, gateDir } = dirs();
    const handle = await installHitlGate({
      workspaceRoot,
      hitlDir,
      approvalState,
      runnerPid: process.pid,
      hooks: { socketPath: join(gateDir, "hooks.sock"), token: "t0k3n", longestTimeoutSeconds: 600, afterCalls: true },
    });
    const during = JSON.parse(readFileSync(join(workspaceRoot, ".cursor", "hooks.json"), "utf-8"));
    expect(Object.keys(during.hooks).sort()).toEqual(["beforeMCPExecution", "postToolUse", "preToolUse", "subagentStart"]);
    expect(during.hooks.preToolUse[0].timeout).toBe(630);
    const pointer = JSON.parse(readFileSync(join(gateDir, "active.json"), "utf-8"));
    expect(pointer).toMatchObject({ hookSocket: join(gateDir, "hooks.sock"), hookToken: "t0k3n" });
    await removeHitlGate(handle);
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
    // During the turn only our entry is present; the user's is set aside.
    const during = JSON.parse(readFileSync(hooksPath, "utf-8"));
    expect(during.hooks.preToolUse).toHaveLength(1);

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

describe("workspace hook files: .claude settings and the turn's restore", () => {
  const approvalState = buildApprovalState(NO_MCP_DEFAULT, false, new Set());
  const realHome = process.env.HOME;
  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
  });

  function workspace() {
    const root = freshRoot();
    process.env.HOME = root;
    const workspaceRoot = join(root, "repo");
    mkdirSync(join(workspaceRoot, ".claude"), { recursive: true });
    const settings = join(workspaceRoot, ".claude", "settings.json");
    const original = `${JSON.stringify({ model: "x", hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "touch fired" }] }] } }, null, 4)}\n`;
    writeFileSync(settings, original, "utf-8");
    return { workspaceRoot, hitlDir: join(root, "hitl"), gateDir: getHitlGateDir(workspaceRoot), settings, original };
  }

  it("sets a runner-owned folder's .claude hooks aside for the turn, keeps its other keys, and restores the bytes", async () => {
    const { workspaceRoot, hitlDir, settings, original } = workspace();
    const handle = await installHitlGate({
      workspaceRoot, hitlDir, approvalState, runnerPid: process.pid,
      folders: workspaceFolders([workspaceRoot], []),
    });
    expect(JSON.parse(readFileSync(settings, "utf-8"))).toEqual({ model: "x" });
    await removeHitlGate(handle);
    expect(readFileSync(settings, "utf-8")).toBe(original);
  });

  it("never touches a person's own folder, and refuses the turn naming the file", async () => {
    const { workspaceRoot, hitlDir, settings, original } = workspace();
    const folders = workspaceFolders([workspaceRoot], [
      { rootDir: workspaceRoot, sourceType: "local_path", consumedKeys: [], workspaceDescription: "", entryName: "mine" },
    ]);
    expect(folders).toEqual([{ dir: workspaceRoot, runnerOwned: false }]);
    await expect(refuseOwnFolderHooks(folders)).rejects.toThrow(CursorWorkspaceHooksRefusal);
    await expect(refuseOwnFolderHooks(folders)).rejects.toThrow(settings);
    const handle = await installHitlGate({ workspaceRoot, hitlDir, approvalState, runnerPid: process.pid, folders });
    expect(readFileSync(settings, "utf-8")).toBe(original);
    await removeHitlGate(handle);
  });

  it("never edits a runner-owned folder's settings reached through a link, and refuses the turn naming it", async () => {
    const { workspaceRoot, hitlDir, settings } = workspace();
    const elsewhere = mkdtempSync(join(tmpdir(), "elsewhere-"));
    tempDirs.push(elsewhere);
    const outside = join(elsewhere, "settings.json");
    const outsideBytes = `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: "mine" }] }] } })}\n`;
    writeFileSync(outside, outsideBytes, "utf-8");
    rmSync(settings);
    symlinkSync(outside, settings);
    const folders = workspaceFolders([workspaceRoot], []);
    await expect(refuseOwnFolderHooks(folders)).rejects.toThrow(/through a link/);
    const handle = await installHitlGate({ workspaceRoot, hitlDir, approvalState, runnerPid: process.pid, folders });
    expect(readFileSync(outside, "utf-8"), "the linked file is not edited").toBe(outsideBytes);
    await removeHitlGate(handle);
    expect(readFileSync(outside, "utf-8")).toBe(outsideBytes);

    // A linked .claude directory reaches outside the folder the same way.
    const linkedDir = workspace();
    rmSync(join(linkedDir.workspaceRoot, ".claude"), { recursive: true });
    symlinkSync(elsewhere, join(linkedDir.workspaceRoot, ".claude"));
    await expect(refuseOwnFolderHooks(workspaceFolders([linkedDir.workspaceRoot], []))).rejects.toThrow(/through a link/);
  });

  it("refuses a turn whose gate file, or its directory, is a link the engine would not load", async () => {
    const { workspaceRoot } = workspace();
    await expect(refuseLinkedGateFile(workspaceRoot)).resolves.toBeUndefined();
    await expect(refuseLinkedGateFile("")).resolves.toBeUndefined();
    const elsewhere = mkdtempSync(join(tmpdir(), "elsewhere-"));
    tempDirs.push(elsewhere);
    writeFileSync(join(elsewhere, "hooks.json"), "{}", "utf-8");
    mkdirSync(join(workspaceRoot, ".cursor"), { recursive: true });
    symlinkSync(join(elsewhere, "hooks.json"), join(workspaceRoot, ".cursor", "hooks.json"));
    await expect(refuseLinkedGateFile(workspaceRoot)).rejects.toThrow(/approval gate would not run/);
    rmSync(join(workspaceRoot, ".cursor"), { recursive: true });
    symlinkSync(elsewhere, join(workspaceRoot, ".cursor"));
    await expect(refuseLinkedGateFile(workspaceRoot)).rejects.toThrow(CursorWorkspaceHooksRefusal);
  });

  it("refuses nothing for an empty hooks object or a file that does not parse", async () => {
    const { workspaceRoot, settings } = workspace();
    writeFileSync(settings, JSON.stringify({ hooks: {} }), "utf-8");
    writeFileSync(join(workspaceRoot, ".claude", "settings.local.json"), "{ not json", "utf-8");
    expect(await claudeSettingsWithHooks(workspaceRoot)).toEqual([]);
  });

  it("keeps an agent's edit of a .claude settings file, hooks put back; returns .cursor/hooks.json as it was, which no review shows", async () => {
    const { workspaceRoot, hitlDir, settings } = workspace();
    const cursorHooks = join(workspaceRoot, ".cursor", "hooks.json");
    mkdirSync(join(workspaceRoot, ".cursor"), { recursive: true });
    writeFileSync(cursorHooks, JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: "./mine.sh" }] } }), "utf-8");
    const handle = await installHitlGate({
      workspaceRoot, hitlDir, approvalState, runnerPid: process.pid,
      folders: workspaceFolders([workspaceRoot], []),
    });
    expect(statSync(join(getHitlGateDir(workspaceRoot), "workspace-files.json")).mode & 0o777, "the snapshot is the owner's alone").toBe(0o600);
    // The agent edits both files during the turn, adding a hook to each.
    writeFileSync(settings, JSON.stringify({
      model: "y",
      hooks: {
        // The agent also wrote back the set-aside hook: kept once.
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "touch fired" }] }],
        PostToolUse: [{ matcher: "", hooks: [{ type: "command", command: "added" }] }],
      },
    }), "utf-8");
    const during = JSON.parse(readFileSync(cursorHooks, "utf-8"));
    during.hooks.preToolUse.push({ command: "./added-by-agent.sh" });
    writeFileSync(cursorHooks, JSON.stringify(during), "utf-8");

    await removeHitlGate(handle);
    expect(JSON.parse(readFileSync(settings, "utf-8"))).toEqual({
      model: "y",
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "touch fired" }] }],
        PostToolUse: [{ matcher: "", hooks: [{ type: "command", command: "added" }] }],
      },
    });
    expect(JSON.parse(readFileSync(cursorHooks, "utf-8")).hooks.preToolUse.map((e: any) => e.command), "a hook the agent added does not outlive the turn").toEqual([
      "./mine.sh",
    ]);
  });

  it("puts the set-aside hooks back beside an agent's edit that has none", async () => {
    const { workspaceRoot, hitlDir, settings } = workspace();
    const handle = await installHitlGate({ workspaceRoot, hitlDir, approvalState, runnerPid: process.pid, folders: workspaceFolders([workspaceRoot], []) });
    writeFileSync(settings, JSON.stringify({ model: "z" }), "utf-8");
    await removeHitlGate(handle);
    expect(JSON.parse(readFileSync(settings, "utf-8"))).toEqual({
      model: "z",
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "touch fired" }] }] },
    });
  });

  it("keeps an agent's edit of a .claude settings file that no longer parses as it is", async () => {
    const { workspaceRoot, hitlDir, settings } = workspace();
    const handle = await installHitlGate({ workspaceRoot, hitlDir, approvalState, runnerPid: process.pid, folders: workspaceFolders([workspaceRoot], []) });
    writeFileSync(settings, "{ half written", "utf-8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await removeHitlGate(handle);
    warn.mockRestore();
    expect(readFileSync(settings, "utf-8")).toBe("{ half written");
  });

  it("keeps an agent's deletion of a .claude settings file, and returns .cursor/hooks.json as it was over an edit that no longer parses", async () => {
    const { workspaceRoot, hitlDir, settings } = workspace();
    const folders = workspaceFolders([workspaceRoot], []);
    const handle = await installHitlGate({ workspaceRoot, hitlDir, approvalState, runnerPid: process.pid, folders });
    rmSync(settings);
    writeFileSync(join(workspaceRoot, ".cursor", "hooks.json"), "{ half written", "utf-8");
    await removeHitlGate(handle);
    expect(existsSync(settings), "the deletion is the agent's, for the review to show").toBe(false);
    expect(existsSync(join(workspaceRoot, ".cursor", "hooks.json")), "the repository had none").toBe(false);
  });

  it("puts the set-aside files back when setting one aside fails partway", async () => {
    const { workspaceRoot, hitlDir, settings, original } = workspace();
    const local = join(workspaceRoot, ".claude", "settings.local.json");
    writeFileSync(local, JSON.stringify({ hooks: { PreToolUse: [] } }), "utf-8");
    chmodSync(local, 0o400);
    try {
      await expect(
        installHitlGate({ workspaceRoot, hitlDir, approvalState, runnerPid: process.pid, folders: workspaceFolders([workspaceRoot], []) }),
      ).rejects.toThrow();
    } finally {
      chmodSync(local, 0o600);
    }
    expect(readFileSync(settings, "utf-8"), "settings.json was set aside before the failing write").toBe(original);
  });

  it("never restores through a link put in a set-aside file's place, and leaves a file back as it was untouched", async () => {
    const { workspaceRoot, hitlDir, settings, original } = workspace();
    const folders = workspaceFolders([workspaceRoot], []);
    const elsewhere = mkdtempSync(join(tmpdir(), "elsewhere-"));
    tempDirs.push(elsewhere);
    const outside = join(elsewhere, "settings.json");
    writeFileSync(outside, '{"model":"mine"}\n', "utf-8");
    const linked = await installHitlGate({ workspaceRoot, hitlDir, approvalState, runnerPid: process.pid, folders });
    rmSync(settings);
    symlinkSync(outside, settings);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await removeHitlGate(linked);
    warn.mockRestore();
    expect(readFileSync(outside, "utf-8"), "the file the link reaches is not written").toBe('{"model":"mine"}\n');

    rmSync(settings);
    writeFileSync(settings, original, "utf-8");
    const next = await installHitlGate({ workspaceRoot, hitlDir, approvalState, runnerPid: process.pid, folders });
    writeFileSync(settings, original, "utf-8");
    await removeHitlGate(next);
    expect(readFileSync(settings, "utf-8"), "its bytes, not a reformatted copy").toBe(original);
  });

  it("puts the set-aside files back when the install fails after setting them aside", async () => {
    const { workspaceRoot, hitlDir, settings, original } = workspace();
    mkdirSync(join(workspaceRoot, ".cursor"), { recursive: true });
    // A file where the install writes its rules directory: the install fails after the set-aside.
    writeFileSync(join(workspaceRoot, ".cursor", "rules"), "not a directory", "utf-8");
    await expect(
      installHitlGate({ workspaceRoot, hitlDir, approvalState, runnerPid: process.pid, folders: workspaceFolders([workspaceRoot], []) }),
    ).rejects.toThrow();
    expect(readFileSync(settings, "utf-8")).toBe(original);
  });

  it("keeps restoring the rest when one file cannot be written back, and reads a corrupt snapshot as none", async () => {
    const { workspaceRoot, hitlDir, gateDir, settings } = workspace();
    const folders = workspaceFolders([workspaceRoot], []);
    const handle = await installHitlGate({ workspaceRoot, hitlDir, approvalState, runnerPid: process.pid, folders });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The agent edits the settings file and it cannot be written back.
    writeFileSync(settings, JSON.stringify({ model: "y" }), "utf-8");
    chmodSync(settings, 0o400);
    await removeHitlGate(handle);
    chmodSync(settings, 0o600);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not restore"));
    expect(existsSync(join(workspaceRoot, ".cursor", "hooks.json")), "the hooks file still came back").toBe(false);
    warn.mockRestore();
    writeFileSync(join(gateDir, "workspace-files.json"), "{ corrupt", "utf-8");
    const next = await installHitlGate({ workspaceRoot, hitlDir, approvalState, runnerPid: process.pid, folders });
    await removeHitlGate(next);
  });

  it("restores a crashed turn's set-aside files at the next install, before anything else", async () => {
    const { workspaceRoot, hitlDir, settings, original } = workspace();
    const folders = workspaceFolders([workspaceRoot], []);
    // A turn installs and never tears down (the runner crashed).
    await installHitlGate({ workspaceRoot, hitlDir, approvalState, runnerPid: process.pid, folders });
    expect(JSON.parse(readFileSync(settings, "utf-8"))).toEqual({ model: "x" });

    // The next turn's install restores first, then sets aside again; its
    // teardown leaves the original bytes.
    const next = await installHitlGate({ workspaceRoot, hitlDir, approvalState, runnerPid: process.pid, folders });
    await removeHitlGate(next);
    expect(readFileSync(settings, "utf-8")).toBe(original);
  });

  it("restores at boot what a stopped runner set aside, and leaves a running one's alone", async () => {
    const gatesRoot = mkdtempSync(join(tmpdir(), "gates-"));
    tempDirs.push(gatesRoot);
    // The pid of a process that has exited: a runner that crashed.
    const stopped = spawnSync(process.execPath, ["-e", ""]).pid!;
    const setAside = async (name: string, writer: number | undefined, writerStarted?: number) => {
      const { settings, original } = workspace();
      const gateDir = join(gatesRoot, name);
      await rewriteWorkspaceFiles(gateDir, [{ path: settings, kind: "claude-settings", original, written: '{"model":"x"}\n' }]);
      const snapshotPath = join(gateDir, "workspace-files.json");
      const { rewrites } = JSON.parse(readFileSync(snapshotPath, "utf-8")) as { rewrites: unknown[] };
      writeFileSync(snapshotPath, JSON.stringify({ rewrites, ...(writer !== undefined ? { writer } : {}), ...(writerStarted !== undefined ? { writerStarted } : {}) }), "utf-8");
      return { settings, original, snapshotPath };
    };
    const crashed = await setAside("crashed", stopped);
    const running = await setAside("running", process.ppid);
    const unnamed = await setAside("unnamed", undefined);
    // A running process whose id a stopped runner had: it started long after.
    const reused = await setAside("reused", process.ppid, 1);
    mkdirSync(join(gatesRoot, "empty"));

    await restoreAbandonedWorkspaceFiles(gatesRoot);
    expect(readFileSync(crashed.settings, "utf-8")).toBe(crashed.original);
    expect(existsSync(crashed.snapshotPath)).toBe(false);
    expect(readFileSync(unnamed.settings, "utf-8"), "a snapshot naming no writer is restored").toBe(unnamed.original);
    expect(readFileSync(reused.settings, "utf-8"), "a process id taken again is not the runner").toBe(reused.original);
    expect(readFileSync(running.settings, "utf-8"), "a running runner's turn keeps its set-aside").toBe('{"model":"x"}\n');
    expect(existsSync(running.snapshotPath)).toBe(true);
    await restoreAbandonedWorkspaceFiles(join(gatesRoot, "missing"));

    // Where `ps` cannot say when a running process started, it is taken for the runner.
    const unknown = await setAside("unknown-start", process.ppid, 1);
    const realPath = process.env["PATH"];
    process.env["PATH"] = gatesRoot;
    try {
      await restoreAbandonedWorkspaceFiles(gatesRoot);
    } finally {
      process.env["PATH"] = realPath;
    }
    expect(readFileSync(unknown.settings, "utf-8")).toBe('{"model":"x"}\n');
  });
});
