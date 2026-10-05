/**
 * Live: an agent's own hooks decide on the real Cursor SDK, through the
 * runner's own gate (`workspace-setup.ts`), the gate's bash script
 * (`hook-script.ts`) and the hook server behind it (`hook-server.ts`), and
 * a repository's own hooks never run.
 *
 * One turn, one real model: the agent's hook refuses one shell command and
 * allows another; a hook in the repository's `.cursor/hooks.json` and one in
 * its `.claude/settings.json` would each leave a marker file, and neither
 * does; after the gate comes down both files are byte for byte what the
 * repository had.
 *
 * Live class (`*.live.test.ts`): runs only through `npm run test:live`;
 * skips without `CURSOR_API_KEY` outside the live lane
 * (`src/__test-utils__/live-gate.ts`). One short turn, real credits.
 */

import { create } from "@bufbuild/protobuf";
import { HookGroupSchema, HookHandlerSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { liveSecret } from "../../../__test-utils__/live-gate.js";
import { HookEvaluator } from "../../../shared/hooks/evaluate.js";
import { HookSet } from "../../../shared/hooks/hook-set.js";
import { buildShellEnv } from "../../../shared/shell-env.js";
import { buildApprovalState } from "../approval-state.js";
import { startHookServer } from "../hook-server.js";
import { CursorEngineToolViews } from "../hook-views.js";
import { installHitlGate, removeHitlGate } from "../workspace-setup.js";
import { workspaceFolders } from "../workspace-hook-files.js";

const CURSOR_API_KEY = liveSecret("CURSOR_API_KEY") ?? "";

/** Refuses a command that names `forbidden`, allows every other: Claude Code's format, as a plugin writes it. */
const GUARD = [
  "input=$(cat)",
  'case "$input" in',
  `  *forbidden*) printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"forbidden commands are refused"}}' ;;`,
  `  *) printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}' ;;`,
  "esac",
].join("\n");

describe.skipIf(!liveSecret("CURSOR_API_KEY"))("Cursor engine: an agent's hooks through the runner's gate (live)", () => {
  it("refuses one command and allows another, and the repository's own hooks never fire", async () => {
    const { Agent } = await import("@cursor/sdk");
    const { SqliteLocalAgentStore } = await import("@cursor/sdk/sqlite");

    const workspaceRoot = mkdtempSync(join(tmpdir(), "stigmer-hooks-gate-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "stigmer-hooks-gate-state-"));
    const hitlDir = mkdtempSync(join(tmpdir(), "stigmer-hooks-gate-hitl-"));
    const marker = join(workspaceRoot, "repository-hook-fired");
    mkdirSync(join(workspaceRoot, ".cursor"), { recursive: true });
    mkdirSync(join(workspaceRoot, ".claude"), { recursive: true });
    const cursorHooks = `${JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: `touch ${marker}; echo '{"permission":"allow"}'` }] } }, null, 2)}\n`;
    const claudeSettings = `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: `touch ${marker}` }] }] } })}\n`;
    writeFileSync(join(workspaceRoot, ".cursor", "hooks.json"), cursorHooks, "utf-8");
    writeFileSync(join(workspaceRoot, ".claude", "settings.json"), claudeSettings, "utf-8");

    const evaluator = new HookEvaluator({
      set: HookSet.of([{
        source: { plugin: "guard", root: "", data: "", options: new Map() },
        groups: [create(HookGroupSchema, { event: "PreToolUse", matcher: "Bash", handlers: [create(HookHandlerSchema, { command: GUARD })] })],
      }]),
      views: new CursorEngineToolViews({ workspaceRoot, pluginServers: new Map(), platformServerSlugs: new Set() }),
      sessionId: "live-hooks",
      workspaceRoot,
      permissionMode: "default",
      baseEnv: buildShellEnv({}),
      homeDir: workspaceRoot,
      leases: new Set(),
    });
    const server = await startHookServer({ evaluator, refusals: new Map(), captureMode: false, globalBypass: false });
    const gate = await installHitlGate({
      workspaceRoot,
      hitlDir,
      // "Trust this whole run": the default asks nothing, so only the hook decides.
      approvalState: buildApprovalState({ destructive: new Set(), leasedServers: new Set() }, true, new Set()),
      runnerPid: process.pid,
      hooks: { socketPath: server.socketPath, token: server.token },
      folders: workspaceFolders([workspaceRoot], []),
    });

    let status = "";
    let text = "";
    try {
      const agent = await Agent.create({
        apiKey: CURSOR_API_KEY,
        model: { id: "composer-2.5" },
        local: {
          cwd: workspaceRoot,
          settingSources: ["project"],
          store: await SqliteLocalAgentStore.open({ workspaceRef: `hooks-gate-${Date.now()}`, stateRoot }),
          enableAgentRetries: false,
        },
      });
      const run = await agent.send(
        "Run these two shell commands, one after the other, without asking questions, and keep going if one fails: " +
          "`echo forbidden > forbidden.txt`, then `echo fine > fine.txt`. Then reply with what happened to each.",
      );
      for await (const _event of run.stream()) {
        /* drain */
      }
      const result = await run.wait();
      agent.close();
      status = result.status;
      text = result.result ?? "";
    } finally {
      await removeHitlGate(gate);
      await server.close();
    }

    console.log(`[hooks-gate] run status: ${status}; reply: ${text.slice(0, 300)}`);
    expect(status).toBe("finished");
    expect(existsSync(join(workspaceRoot, "forbidden.txt")), "the hook refused the forbidden command").toBe(false);
    expect(existsSync(join(workspaceRoot, "fine.txt")), "the hook allowed the other").toBe(true);
    expect(existsSync(marker), "neither repository hook ran").toBe(false);
    expect(readFileSync(join(workspaceRoot, ".cursor", "hooks.json"), "utf-8")).toBe(cursorHooks);
    expect(readFileSync(join(workspaceRoot, ".claude", "settings.json"), "utf-8")).toBe(claudeSettings);
  }, 600_000);
});
