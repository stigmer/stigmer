/**
 * Pins the native harness's hook setup (`hooks-setup.ts`): no evaluator for
 * a turn without hooks this engine runs; a plugin hook's
 * `${user_config.KEY}` resolved from that plugin's own values
 * (`RunValues.plugins`) and never another plugin's or the agent's, the
 * agent's own block's from the agent's values, a missing one refusing the
 * turn by name (and by the MCP server whose value it is); a shell-form hook
 * with no `bash` on the hook's PATH refusing the turn; and Claude's
 * `permission_mode` for the turn.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { HookGroupSchema, HookHandlerSchema, type HookGroup } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import type { TurnHookSource, TurnInput } from "../../../harness/types.js";
import type { ResolvedMcpServer } from "../../../shared/mcp-resolver.js";
import { toolValuesKey, type RunValues, type ToolValueGroup } from "../../../shared/run-values.js";
import type { MountedPlugin } from "../../../shared/plugin-mount.js";
import { buildHookEvaluator, HookSetupError, permissionModeOf } from "../hooks-setup.js";

const sink = { stopSignal: new AbortController().signal, recordActivity: vi.fn() };
const tools = { toolServerMap: new Map<string, string>() };

const mounted: MountedPlugin = { id: "plg_safety", slug: "safety", name: "Safety", root: "/p/safety", data: "/d/safety", verify: async () => undefined };
const audit: MountedPlugin = { id: "plg_audit", slug: "audit", name: "Audit", root: "/p/audit", data: "/d/audit", verify: async () => undefined };

function groups(...handlers: { command: string; args?: string[] }[]): HookGroup[] {
  return [create(HookGroupSchema, { event: "PreToolUse", matcher: "Bash", handlers: handlers.map((h) => create(HookHandlerSchema, { command: h.command, args: h.args ?? [] })) })];
}

function input(
  sources: TurnHookSource[],
  extra: { agent?: Record<string, string>; tools?: RunValues["tools"]; plugins?: RunValues["plugins"]; workspaceDir?: string } = {},
): TurnInput {
  return turnInputFixture({
    ...(extra.workspaceDir !== undefined ? { workspaceDir: extra.workspaceDir } : {}),
    hooks: { sources, pluginServers: new Map() },
    values: { agent: extra.agent ?? {}, tools: extra.tools ?? new Map(), plugins: extra.plugins ?? new Map(), repositories: [] },
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("buildHookEvaluator", () => {
  it("builds nothing for an agent without hooks, or with none this engine runs", async () => {
    expect(await buildHookEvaluator(input([]), sink, tools, 180_000)).toBeNull();
    const lifecycle = [create(HookGroupSchema, { event: "Stop", handlers: [create(HookHandlerSchema, { command: "x" })] })];
    expect(await buildHookEvaluator(input([{ plugin: mounted, format: "claude-code", groups: lifecycle }]), sink, tools, 180_000)).toBeNull();
  });

  it("builds an evaluator when every value a plugin's hook reads is that plugin's", async () => {
    const hooks = await buildHookEvaluator(
      input([{ plugin: mounted, format: "claude-code", groups: groups({ command: "check", args: ["${user_config.API_TOKEN}"] }) }], {
        plugins: new Map([["plg_safety", { API_TOKEN: "t" }]]),
      }),
      sink,
      tools,
      180_000,
    );
    expect(hooks).not.toBeNull();
  });

  it("never fills a plugin's hook from another plugin's values or the agent's", async () => {
    const reads = groups({ command: "check", args: ["${user_config.API_TOKEN}"] });
    const elsewhere = input([{ plugin: mounted, format: "claude-code", groups: reads }], {
      agent: { API_TOKEN: "agent's" },
      plugins: new Map([["plg_audit", { API_TOKEN: "audit's" }]]),
    });
    await expect(buildHookEvaluator(elsewhere, sink, tools, 180_000)).rejects.toThrow(
      new HookSetupError(
        "A hook of the plugin 'safety' reads the variable API_TOKEN, which none of this conversation's vaults holds. Save API_TOKEN in one of them, then run again.",
      ),
    );
    // Each of two plugins reading the same key gets its own value.
    const both = input(
      [
        { plugin: mounted, format: "claude-code", groups: reads },
        { plugin: audit, format: "claude-code", groups: reads },
      ],
      { plugins: new Map([["plg_safety", { API_TOKEN: "safety's" }], ["plg_audit", { API_TOKEN: "audit's" }]]) },
    );
    expect(await buildHookEvaluator(both, sink, tools, 180_000)).not.toBeNull();
  });

  it("fills the agent's own block from the agent's values, and refuses one the run does not give the agent", async () => {
    const reads = groups({ command: "check", args: ["${user_config.X}"] });
    expect(
      await buildHookEvaluator(input([{ plugin: null, format: "claude-code", groups: reads }], { agent: { X: "x" } }), sink, tools, 180_000),
    ).not.toBeNull();
    const pluginOnly = input([{ plugin: null, format: "claude-code", groups: reads }], { plugins: new Map([["plg_safety", { X: "x" }]]) });
    await expect(buildHookEvaluator(pluginOnly, sink, tools, 180_000)).rejects.toThrow(
      new HookSetupError(
        "A hook in the agent's own hooks block reads the variable X, which this run does not give the agent. Declare X in the agent's env and set its value, then run again.",
      ),
    );
  });

  it("names the MCP server that keeps a variable a hook reads", async () => {
    // The value is in the GitHub tool's group, never the agent's.
    const base = input([{ plugin: mounted, format: "claude-code", groups: groups({ command: "check", args: ["${user_config.API_TOKEN}"] }) }], {
      tools: new Map<string, ToolValueGroup>([
        [toolValuesKey("plg_linear", "api"), { url: "https://mcp.linear.app/mcp", values: { LINEAR_TOKEN: "l" } }],
        [toolValuesKey("plg_github", "api"), { url: "https://api.githubcopilot.com/mcp/", values: { API_TOKEN: "t" } }],
      ]),
    });
    const server: ResolvedMcpServer = {
      slug: "plugin_github_api",
      connectionType: "http",
      url: "https://api.githubcopilot.com/mcp/",
      pluginOrigin: { pluginId: "plg_github", plugin: "github", server: "api" },
    };
    const claimed: TurnInput = { ...base, mcp: { ...base.mcp, servers: [server] } };
    await expect(buildHookEvaluator(claimed, sink, tools, 180_000)).rejects.toThrow(
      new HookSetupError(
        "A hook of the plugin 'safety' reads the variable API_TOKEN, which this run keeps for its MCP server 'plugin_github_api' " +
          "and gives neither the agent's shell nor its hooks. Give the hook a variable of its own, then run again.",
      ),
    );
    // A tool that did not resolve this turn is still named, readably: its
    // value is still never the hook's, and the sentence carries no raw
    // group key (plugin id, NUL, server).
    const unresolved = buildHookEvaluator(base, sink, tools, 180_000);
    await expect(unresolved).rejects.toThrow("which this run keeps for its MCP server");
    await expect(unresolved).rejects.toThrow(/keeps for its MCP server '[^'\u0000]+'/);
  });

  it("refuses a shell-form command that reads user_config, and judges only the events it runs", async () => {
    const shellForm = input([{ plugin: mounted, format: "claude-code", groups: groups({ command: "check ${user_config.API_TOKEN}" }) }]);
    await expect(buildHookEvaluator(shellForm, sink, tools, 180_000)).rejects.toThrow(
      new HookSetupError(
        "A hook of the plugin 'safety' reads ${user_config.*} in a command that runs in bash, where the value is not substituted. " +
          "Pass it in args (exec form), then run again.",
      ),
    );
    const notRun = [create(HookGroupSchema, {
      event: "Stop",
      handlers: [
        create(HookHandlerSchema, { command: "notify ${user_config.WEBHOOK}" }),
        create(HookHandlerSchema, { command: "notify", args: ["${user_config.WEBHOOK}"] }),
      ],
    })];
    expect(await buildHookEvaluator(input([{ plugin: mounted, format: "claude-code", groups: notRun }]), sink, tools, 180_000)).toBeNull();
  });

  it("hands the evaluator the workspace's paths and the turn's activity", async () => {
    const recordActivity = vi.fn();
    const workspace = mkdtempSync(join(tmpdir(), "hooks-setup-"));
    try {
      const rewrite = JSON.stringify({ hookSpecificOutput: { permissionDecision: "allow", updatedInput: { file_path: "/WORKSPACE/notes.md" } } });
      const turn = input(
        [{ plugin: null, format: "claude-code", groups: [create(HookGroupSchema, { event: "PreToolUse", matcher: "Read", handlers: [create(HookHandlerSchema, { command: `sleep 0.2; printf '%s' '${rewrite}' | sed "s#/WORKSPACE#$CLAUDE_PROJECT_DIR#"` })] })] }],
        { workspaceDir: workspace },
      );
      const hooks = await buildHookEvaluator(turn, { ...sink, recordActivity }, tools, 30);
      const outcome = await hooks!.preToolUse({ id: "c", name: "read_file", args: { file_path: "/a.md" }, serverSlug: "" }, {});
      expect(outcome.updatedArgs, "a real path back to the engine's").toEqual({ file_path: "/notes.md" });
      expect(recordActivity).toHaveBeenCalledWith("hook the agent's hooks");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("refuses a shell-form hook when no bash is on the hook's PATH; exec form needs none", async () => {
    const empty = mkdtempSync(join(tmpdir(), "no-bash-"));
    try {
      vi.stubEnv("PATH", `:${empty}`);
      await expect(buildHookEvaluator(input([{ plugin: mounted, format: "claude-code", groups: groups({ command: "check" }) }]), sink, tools, 180_000)).rejects.toThrow(
        "no bash is on this runner's PATH",
      );
      expect(await buildHookEvaluator(input([{ plugin: mounted, format: "claude-code", groups: groups({ command: "/bin/check", args: ["x"] }) }]), sink, tools, 180_000)).not.toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("tells a hook the turn's permission mode", () => {
    const plain = input([]);
    expect(permissionModeOf(plain)).toBe("default");
    const plan = input([]);
    plan.execution.spec!.interactionMode = InteractionMode.PLAN;
    expect(permissionModeOf(plan)).toBe("plan");
    const trusted = input([]);
    expect(permissionModeOf({ ...trusted, mcp: { ...trusted.mcp, leases: { ...trusted.mcp.leases, global: true } } })).toBe("bypassPermissions");
  });
});
