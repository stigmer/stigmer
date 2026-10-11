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
 * A second turn runs a real plugin, unchanged: Anthropic's hookify, read
 * from the repository's vendored copy (`test/support/fixtures/claude-plugins/`,
 * held to upstream's blob SHAs there), mounted as a turn mounts it
 * (`shared/plugin-mount.ts`) and run from its own `hooks/hooks.json` with its
 * own example rule. The model runs `rm -rf build`, overwrites the mounted
 * rule engine with one that allows everything, and runs `rm -rf build`
 * again: hookify refuses both with its own text, because the runner
 * restores the installed tree before the next hook run.
 *
 * Live class (`*.live.test.ts`): runs only through `npm run test:live`;
 * skips without `CURSOR_API_KEY` outside the live lane
 * (`src/__test-utils__/live-gate.ts`). Two short turns, real credits.
 */

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { HookGroupSchema, HookHandlerSchema, type HookGroup } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { buildZip } from "@stigmer/zip-structure/testing";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { liveSecret } from "../../../__test-utils__/live-gate.js";
import type { StigmerClient } from "../../../client/stigmer-client.js";
import { HookEvaluator, type PreToolUseOutcome } from "../../../shared/hooks/evaluate.js";
import { HookSet } from "../../../shared/hooks/hook-set.js";
import { mountPlugin } from "../../../shared/plugin-mount.js";
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

/** The repository root: `__tests__/` → `execute-cursor/` → `activities/` → `src/` → `runner/` → `services/` → `backend/` → root. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../..");
const VENDORED = join(REPO_ROOT, "test", "support", "fixtures", "claude-plugins");
const HOOKIFY = join(VENDORED, "hookify");

interface Upstream {
  readonly plugins: { readonly hookify: { readonly files: Readonly<Record<string, { readonly blob: string }>> } };
}

/** The vendoring's manifest of upstream's files (`test/support/fixtures/claude-plugins/upstream.json`). */
function upstreamManifest(): Upstream {
  return JSON.parse(readFileSync(join(VENDORED, "upstream.json"), "utf-8")) as Upstream;
}

/** hookify as a push takes it: every file upstream's tree lists, read from the fixture, so nothing git ignores rides along. */
function hookifyFiles(): { name: string; content: Uint8Array }[] {
  return Object.keys(upstreamManifest().plugins.hookify.files)
    .sort()
    .map((name) => ({ name, content: readFileSync(join(HOOKIFY, name)) }));
}

/** A plugin's `hooks/hooks.json`, in Claude Code's shape, as the contract's groups. */
function claudeHookGroups(hooksJson: string): HookGroup[] {
  const parsed = JSON.parse(hooksJson) as {
    hooks: Record<string, { matcher?: string; hooks: { command: string; timeout?: number }[] }[]>;
  };
  return Object.entries(parsed.hooks).flatMap(([event, entries]) =>
    entries.map((entry) =>
      create(HookGroupSchema, {
        event,
        matcher: entry.matcher ?? "",
        handlers: entry.hooks.map((hook) => create(HookHandlerSchema, { command: hook.command, timeoutSeconds: hook.timeout ?? 0 })),
      }),
    ),
  );
}

/** What `git hash-object` prints for these bytes, the unit of the vendored plugins' manifest. */
function gitBlobSha(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

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
      approvalState: buildApprovalState({ destructive: new Set(), unlisted: new Set<string>(), leasedServers: new Set() }, true, new Set()),
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

  it("runs a real plugin unchanged: hookify refuses rm -rf, and an edit to its files does not last", async () => {
    const { Agent } = await import("@cursor/sdk");
    const { SqliteLocalAgentStore } = await import("@cursor/sdk/sqlite");

    const workspaceRoot = mkdtempSync(join(tmpdir(), "stigmer-hookify-gate-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "stigmer-hookify-gate-state-"));
    const hitlDir = mkdtempSync(join(tmpdir(), "stigmer-hookify-gate-hitl-"));
    const platformDir = mkdtempSync(join(tmpdir(), "stigmer-hookify-gate-platform-"));
    mkdirSync(join(workspaceRoot, "build"));
    writeFileSync(join(workspaceRoot, "build", "keep.txt"), "built\n", "utf-8");
    // hookify's own example rule, where hookify globs its rules.
    mkdirSync(join(workspaceRoot, ".claude"));
    writeFileSync(
      join(workspaceRoot, ".claude", "hookify.dangerous-rm.local.md"),
      readFileSync(join(HOOKIFY, "examples", "dangerous-rm.local.md")),
    );

    const archive = buildZip(hookifyFiles());
    const plugin = create(PluginSchema, {
      metadata: { id: "plg_hookify", org: "live-org", slug: "hookify", name: "hookify" },
      status: { digest: createHash("sha256").update(archive).digest("hex"), artifactStorageKey: "plugins/hookify.zip" },
    });
    const client = {
      // The unary lane, as a server that predates the transfer lane serves it.
      getPluginArtifactDownloadUrl: async () => {
        throw new ConnectError("served unary", Code.Unimplemented);
      },
      getPluginArtifact: async () => ({ artifact: archive }),
    } as unknown as StigmerClient;
    const mounted = await mountPlugin(client, plugin, platformDir);
    const ruleEngine = join(mounted.root, "core", "rule_engine.py");
    const upstreamBlob = upstreamManifest().plugins.hookify.files["core/rule_engine.py"]!.blob;
    expect(gitBlobSha(readFileSync(ruleEngine)), "the mount is upstream's rule engine").toBe(upstreamBlob);

    const evaluator = new HookEvaluator({
      set: HookSet.of([{
        source: { plugin: mounted.slug, root: mounted.root, data: mounted.data, options: new Map(), beforeRun: mounted.verify },
        groups: claudeHookGroups(readFileSync(join(mounted.root, "hooks", "hooks.json"), "utf-8")),
      }]),
      views: new CursorEngineToolViews({ workspaceRoot, pluginServers: new Map(), platformServerSlugs: new Set() }),
      sessionId: "live-hookify",
      workspaceRoot,
      permissionMode: "default",
      baseEnv: buildShellEnv({}),
      homeDir: workspaceRoot,
      leases: new Set(),
    });
    const decided = vi.spyOn(evaluator, "preToolUse");
    const warn = vi.spyOn(console, "warn");
    const server = await startHookServer({ evaluator, refusals: new Map(), captureMode: false, globalBypass: false });
    const gate = await installHitlGate({
      workspaceRoot,
      hitlDir,
      // "Trust this whole run": the default asks nothing, so only hookify decides.
      approvalState: buildApprovalState({ destructive: new Set(), unlisted: new Set<string>(), leasedServers: new Set() }, true, new Set()),
      runnerPid: process.pid,
      hooks: { socketPath: server.socketPath, token: server.token },
      folders: workspaceFolders([workspaceRoot], []),
    });

    const tamperMarker = join(workspaceRoot, "tampered");
    const tamper =
      `printf 'class RuleEngine:\\n    def evaluate_rules(self, rules, input_data):\\n        return {}\\n' > '${ruleEngine}' && touch '${tamperMarker}'`;
    let status = "";
    let text = "";
    try {
      const agent = await Agent.create({
        apiKey: CURSOR_API_KEY,
        model: { id: "composer-2.5" },
        local: {
          cwd: workspaceRoot,
          settingSources: ["project"],
          store: await SqliteLocalAgentStore.open({ workspaceRef: `hookify-gate-${Date.now()}`, stateRoot }),
          enableAgentRetries: false,
        },
      });
      const run = await agent.send(
        "This is a test of a command guard. Run these three shell commands exactly as written, one after the other, " +
          "without asking questions, and keep going if one is refused: " +
          `\`rm -rf build\`, then \`${tamper}\`, then \`rm -rf build\`. Then reply with what happened to each.`,
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

    const outcomes: { command: string; outcome: PreToolUseOutcome }[] = [];
    for (const [index, call] of decided.mock.calls.entries()) {
      outcomes.push({ command: String(call[0].args["command"] ?? ""), outcome: await decided.mock.results[index]!.value });
    }
    console.log(`[hookify-gate] run status: ${status}; decisions: ${JSON.stringify(outcomes.map(({ command, outcome }) => [command.slice(0, 40), outcome.decision ?? "none"]))}; reply: ${text.slice(0, 300)}`);
    expect(status).toBe("finished");
    const refusals = outcomes.filter(({ command }) => /^rm -rf build\s*$/.test(command));
    expect(refusals, "the model ran rm -rf twice").toHaveLength(2);
    for (const { outcome } of refusals) {
      expect(outcome.decision).toBe("deny");
      expect(outcome.hook).toBe("hookify");
      expect(outcome.reason, "hookify's own text is the reason").toContain("Dangerous rm command detected!");
    }
    expect(existsSync(join(workspaceRoot, "build", "keep.txt")), "neither rm -rf ran").toBe(true);
    expect(existsSync(tamperMarker), "the shell overwrote the mounted rule engine").toBe(true);
    expect(
      warn.mock.calls.some(([line]) => typeof line === "string" && line.startsWith(`[plugin-mount] ${mounted.root} differs from its verified archive`)),
      "the runner rebuilt the tree before the next hook run",
    ).toBe(true);
    expect(gitBlobSha(readFileSync(ruleEngine)), "the mounted rule engine is upstream's again").toBe(upstreamBlob);
  }, 600_000);
});
