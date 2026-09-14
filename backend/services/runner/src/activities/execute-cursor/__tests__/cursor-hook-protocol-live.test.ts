/**
 * Live ground truth for the hook protocol the approval gate rides on — the
 * standing instrument an `@cursor/sdk` bump runs before it is trusted
 * (stigmer/stigmer#1053, the first bump; every later one inherits this).
 *
 * WHY THIS EXISTS. The Stigmer HITL gate on the Cursor harness is a
 * `.cursor/hooks.json` `preToolUse` hook (`hook-script.ts`) that reads the
 * SDK's stdin payload and answers `{"permission": "allow" | "deny"}`. Three
 * facts about that payload are load-bearing and none is a TypeScript type:
 *
 *  1. `tool_name` is the HOOK taxonomy, PascalCase (`Write`, `Shell`, `Delete`;
 *     the stream taxonomy is lowercase `edit`, `shell`, `delete`) — the gated
 *     set `BUILT_IN_GATED` (`approval-policy.ts`) is spelled in it.
 *  2. `tool_input` is an OBJECT for built-in tools (a JSON STRING for MCP
 *     tools under `beforeMCPExecution`) — the hook's identity token and the
 *     denial ledger's captured args are computed from it.
 *  3. `hook_event_name` discriminates `preToolUse` from `beforeMCPExecution`.
 *
 * The hermetic tests prove the runner's handling of the shapes CAPTURED at
 * 1.0.13 (`cursor-hook-harness.ts` `hookWrite`, `hookShell`, ...). They cannot
 * see the SDK move. This test runs one real turn that edits a file and runs a
 * shell command under an allow-everything observation hook, then asserts the
 * three facts on what the real SDK sent. A `tool_name` outside the gated set
 * for a write-, shell- or delete-class action is the one outcome that must
 * stop a bump: the gate would let it through.
 *
 * Skipped without CURSOR_API_KEY (the cursor-sdk-auth-smoke.test.ts
 * convention) — it spends real credits for one short turn. Findings are
 * PRINTED as well as asserted, so a bump's PR can quote the shapes seen.
 *
 * Run with: CURSOR_API_KEY=<key> npx vitest run cursor-hook-protocol-live
 */
import { describe, it, expect } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approvalCategory } from "../approval-policy.js";

const CURSOR_API_KEY = process.env.CURSOR_API_KEY ?? "";
const describeWithCursorKey = CURSOR_API_KEY ? describe : describe.skip;

/** One hook invocation as the SDK wrote it to the hook's stdin. */
interface HookInvocation {
  readonly hook_event_name?: unknown;
  readonly tool_name?: unknown;
  readonly tool_input?: unknown;
}

/**
 * An observation-only preToolUse/beforeMCPExecution hook: appends every
 * invocation's stdin JSON to a log file and ALLOWS everything, so the turn
 * runs to completion and every gated action is seen exactly as the gate would
 * see it.
 */
function installObservationHook(workspaceRoot: string, logPath: string): void {
  const hooksDir = join(workspaceRoot, ".cursor");
  mkdirSync(hooksDir, { recursive: true });
  const scriptPath = join(hooksDir, "observe-hook.sh");
  writeFileSync(
    scriptPath,
    `#!/bin/bash\nINPUT=$(cat)\nprintf '%s\\n' "$INPUT" >> "${logPath}" 2>/dev/null || true\necho '{"permission":"allow"}'\n`,
    "utf-8",
  );
  chmodSync(scriptPath, 0o755);
  writeFileSync(
    join(hooksDir, "hooks.json"),
    JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [{ command: scriptPath }],
        beforeMCPExecution: [{ command: scriptPath }],
      },
    }),
    "utf-8",
  );
}

function readInvocations(logPath: string): HookInvocation[] {
  if (!existsSync(logPath)) return [];
  const invocations: HookInvocation[] = [];
  for (const line of readFileSync(logPath, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      invocations.push(JSON.parse(line) as HookInvocation);
    } catch {
      /* a partial line from a hook the SDK cut off; nothing to read */
    }
  }
  return invocations;
}

describeWithCursorKey("Cursor SDK hook protocol (live ground truth)", () => {
  it("delivers PascalCase tool_name, an object tool_input and hook_event_name for a file edit and a shell command", async () => {
    const { Agent } = await import("@cursor/sdk");
    const { SqliteLocalAgentStore } = await import("@cursor/sdk/sqlite");

    const workspaceRoot = mkdtempSync(join(tmpdir(), "stigmer-hook-protocol-"));
    const stateRoot = join(workspaceRoot, ".sdk-state");
    mkdirSync(stateRoot, { recursive: true });
    const hookLog = join(workspaceRoot, "hook-invocations.jsonl");
    installObservationHook(workspaceRoot, hookLog);

    // Mirror the runner's arrangement (session-lifecycle.ts): local cwd, the
    // "project" setting source that loads .cursor/hooks.json, the session's
    // own store, the SDK's retries off.
    const agent = await Agent.create({
      apiKey: CURSOR_API_KEY,
      model: { id: "composer-2.5" },
      local: {
        cwd: workspaceRoot,
        settingSources: ["project"],
        store: await SqliteLocalAgentStore.open({ workspaceRef: `hook-protocol-${Date.now()}`, stateRoot }),
        enableAgentRetries: false,
      },
    });

    const run = await agent.send(
      "Do exactly two things, in order, without asking questions: " +
        "(1) create a file named probe.txt in the workspace containing the single line 'hook probe'; " +
        "(2) run the shell command `cat probe.txt`. Then reply with the word done.",
    );
    for await (const _event of run.stream()) {
      /* drain: the hook log is the evidence, not the stream */
    }
    const result = await run.wait();
    agent.close();

    const invocations = readInvocations(hookLog);

    // ---- Findings dump (what a bump's PR quotes) ----
    console.log(`[hook-protocol] run status: ${result.status}`);
    for (const inv of invocations) {
      console.log(
        `[hook-protocol] ${String(inv.hook_event_name)}:${String(inv.tool_name)} ` +
          `tool_input=${typeof inv.tool_input} ${JSON.stringify(inv.tool_input).slice(0, 200)}`,
      );
    }

    // The SDK boundary must not hang, and the turn must have reached the hook.
    expect(["finished", "error", "cancelled"]).toContain(result.status);
    expect(invocations.length, "the observation hook saw no tool call — hooks.json was not loaded").toBeGreaterThan(0);

    const builtIns = invocations.filter((inv) => inv.hook_event_name === "preToolUse");
    expect(builtIns.length, "no preToolUse invocation: the built-in tools did not reach the hook").toBeGreaterThan(0);
    for (const inv of builtIns) {
      // Fact 3: the discriminator is present and spelled as the script branches on it.
      expect(inv.hook_event_name).toBe("preToolUse");
      // Fact 1: the hook taxonomy is PascalCase.
      expect(typeof inv.tool_name).toBe("string");
      expect(inv.tool_name as string).toMatch(/^[A-Z]/);
      // Fact 2: built-in tool_input is an object, not a JSON string.
      expect(typeof inv.tool_input).toBe("object");
      expect(inv.tool_input).not.toBeNull();
    }

    // The gate's reach: the write and the shell the prompt forced must have
    // arrived under names the gate classifies. A write- or shell-class action
    // under an unclassified name is the outcome that stops a bump.
    const categories = builtIns.map((inv) => approvalCategory(inv.tool_name as string));
    expect(categories, "the file write reached the hook under a name the gate classifies as write").toContain("write");
    expect(categories, "the shell command reached the hook under a name the gate classifies as shell").toContain("shell");
  }, 300_000);
});
