/**
 * Pins the Stigmer harness's hook setup (`hooks-setup.ts`): no evaluator for
 * a turn without hooks this engine runs; a plugin hook's
 * `${user_config.KEY}` resolved from that plugin's own values
 * (`RunValues.plugins`) and never another plugin's or the agent's, the
 * agent's own block's from the agent's values, a missing one refusing the
 * turn by name (and by the MCP server whose value it is), a name every
 * object inherits (`constructor`) being missing too; a shell-form hook
 * with no `bash` on the hook's PATH refusing the turn; and Claude's
 * `permission_mode` for the turn.
 *
 * A saved subagent's evaluator runs the conversation's sources first, then
 * the subagent's own; the subagent's own block reads the subagent's values,
 * never the agent's, and its commands run in the subagent's environment,
 * while the conversation's keep the agent's. A hook on a subagent's call
 * sees the subagent's plugin servers as Claude Code names them
 * (`plugin:<plugin>:<server>`), and a platform server by its slug.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { HookGroupSchema, HookHandlerSchema, type HookGroup } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import type { TurnHookSource, TurnInput, TurnSubagent } from "../../../harness/types.js";
import { ToolScope } from "../../../shared/tool-lists.js";
import type { ResolvedMcpServer } from "../../../shared/mcp-resolver.js";
import { toolValuesKey, type RunValues, type ToolValueGroup } from "../../../shared/run-values.js";
import type { MountedPlugin } from "../../../shared/plugin-mount.js";
import { buildHookEvaluator, HookSetupError, permissionModeOf } from "../hooks-setup.js";

const sink = { stopSignal: new AbortController().signal, recordActivity: vi.fn() };

const mounted: MountedPlugin = { id: "plg_safety", slug: "safety", name: "Safety", root: "/p/safety", data: "/d/safety", verify: async () => undefined };
const audit: MountedPlugin = { id: "plg_audit", slug: "audit", name: "Audit", root: "/p/audit", data: "/d/audit", verify: async () => undefined };

function groups(...handlers: { command: string; args?: string[] }[]): HookGroup[] {
  return [create(HookGroupSchema, { event: "PreToolUse", matcher: "Bash", handlers: handlers.map((h) => create(HookHandlerSchema, { command: h.command, args: h.args ?? [] })) })];
}

function input(
  sources: TurnHookSource[],
  extra: { agent?: Record<string, string>; tools?: RunValues["tools"]; plugins?: RunValues["plugins"]; workspaceDir?: string; subagents?: TurnSubagent[] } = {},
): TurnInput {
  return turnInputFixture({
    ...(extra.workspaceDir !== undefined ? { workspaceDir: extra.workspaceDir } : {}),
    hooks: { sources, serverNames: new Map() },
    values: {
      agent: extra.agent ?? {},
      tools: extra.tools ?? new Map(),
      plugins: extra.plugins ?? new Map(),
      subagents: new Map((extra.subagents ?? []).map((s) => [s.name, s.values])),
      repositories: [],
    },
    subagents: extra.subagents ?? [],
  });
}

/** A saved subagent's context carrying these hook sources and values. */
function subagent(hooks: TurnHookSource[], values: Record<string, string>): TurnSubagent {
  return {
    name: "release-notes",
    description: "Writes release notes",
    instructions: "You write release notes.",
    model: undefined,
    toolScope: ToolScope.unrestricted(),
    servers: [],
    skills: [],
    hooks,
    values,
    bringsOwn: { plugins: false, hooks: hooks.length > 0, lists: false, mcpServers: false },
  };
}

/** A shell-form PreToolUse hook on Read that reports two variables of its environment as additional context. */
function reportsEnv(label: string): HookGroup[] {
  const json = `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"${label} agent=%s sub=%s"}}`;
  return [
    create(HookGroupSchema, {
      event: "PreToolUse",
      matcher: "Read",
      handlers: [create(HookHandlerSchema, { command: `printf '${json}' "$AGENT_KEY" "$NOTES_KEY"` })],
    }),
  ];
}

afterEach(() => vi.unstubAllEnvs());

describe("buildHookEvaluator", () => {
  it("builds nothing for an agent without hooks, or with none this engine runs", async () => {
    expect(await buildHookEvaluator(input([]), sink, 180_000)).toBeNull();
    const lifecycle = [create(HookGroupSchema, { event: "Stop", handlers: [create(HookHandlerSchema, { command: "x" })] })];
    expect(await buildHookEvaluator(input([{ plugin: mounted, format: "claude-code", groups: lifecycle }]), sink, 180_000)).toBeNull();
  });

  it("builds an evaluator when every value a plugin's hook reads is that plugin's", async () => {
    const hooks = await buildHookEvaluator(
      input([{ plugin: mounted, format: "claude-code", groups: groups({ command: "check", args: ["${user_config.API_TOKEN}"] }) }], {
        plugins: new Map([["plg_safety", { API_TOKEN: "t" }]]),
      }),
      sink,
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
    await expect(buildHookEvaluator(elsewhere, sink, 180_000)).rejects.toThrow(
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
    expect(await buildHookEvaluator(both, sink, 180_000)).not.toBeNull();
  });

  it("fills the agent's own block from the agent's values, and refuses one the run does not give the agent", async () => {
    const reads = groups({ command: "check", args: ["${user_config.X}"] });
    expect(
      await buildHookEvaluator(input([{ plugin: null, format: "claude-code", groups: reads }], { agent: { X: "x" } }), sink, 180_000),
    ).not.toBeNull();
    const pluginOnly = input([{ plugin: null, format: "claude-code", groups: reads }], { plugins: new Map([["plg_safety", { X: "x" }]]) });
    await expect(buildHookEvaluator(pluginOnly, sink, 180_000)).rejects.toThrow(
      new HookSetupError(
        "A hook in the agent's own hooks block reads the variable X, which this run does not give the agent. Declare X in the agent's env and set its value, then run again.",
      ),
    );
  });

  it("reads only a value's own key, never one every object inherits", async () => {
    // `constructor` and `toString` are on every plain object's prototype: read
    // through it, the hook would be handed a function's source as the value.
    const reads = groups({ command: "check", args: ["${user_config.constructor}"] });
    await expect(buildHookEvaluator(input([{ plugin: mounted, format: "claude-code", groups: reads }]), sink, 180_000)).rejects.toThrow(
      new HookSetupError(
        "A hook of the plugin 'safety' reads the variable constructor, which none of this conversation's vaults holds. Save constructor in one of them, then run again.",
      ),
    );
    const tools = new Map<string, ToolValueGroup>([[toolValuesKey("plugin", "plg_github", "api"), { url: "https://api.githubcopilot.com/mcp/", values: { API_TOKEN: "t" } }]]);
    const inherited = input([{ plugin: mounted, format: "claude-code", groups: groups({ command: "check", args: ["${user_config.toString}"] }) }], { tools });
    await expect(buildHookEvaluator(inherited, sink, 180_000)).rejects.toThrow(
      new HookSetupError(
        "A hook of the plugin 'safety' reads the variable toString, which none of this conversation's vaults holds. Save toString in one of them, then run again.",
      ),
    );
  });

  it("names the MCP server that keeps a variable a hook reads", async () => {
    // The value is in the GitHub tool's group, never the agent's.
    const base = input([{ plugin: mounted, format: "claude-code", groups: groups({ command: "check", args: ["${user_config.API_TOKEN}"] }) }], {
      tools: new Map<string, ToolValueGroup>([
        [toolValuesKey("plugin", "plg_linear", "api"), { url: "https://mcp.linear.app/mcp", values: { LINEAR_TOKEN: "l" } }],
        [toolValuesKey("plugin", "plg_github", "api"), { url: "https://api.githubcopilot.com/mcp/", values: { API_TOKEN: "t" } }],
      ]),
    });
    const server: ResolvedMcpServer = {
      slug: "plugin_github_api",
      connectionType: "http",
      url: "https://api.githubcopilot.com/mcp/",
      home: { kind: "plugin", pluginId: "plg_github", plugin: "github", server: "api" },
    };
    const claimed: TurnInput = { ...base, mcp: { ...base.mcp, servers: [server] } };
    await expect(buildHookEvaluator(claimed, sink, 180_000)).rejects.toThrow(
      new HookSetupError(
        "A hook of the plugin 'safety' reads the variable API_TOKEN, which this run keeps for its MCP server 'plugin_github_api' " +
          "and gives neither the agent's shell nor its hooks. Give the hook a variable of its own, then run again.",
      ),
    );
    // A tool that did not resolve this turn is still named, readably: its
    // value is still never the hook's, and the sentence carries no raw
    // group key (plugin id, NUL, server).
    const unresolved = buildHookEvaluator(base, sink, 180_000);
    await expect(unresolved).rejects.toThrow("which this run keeps for its MCP server");
    await expect(unresolved).rejects.toThrow(/keeps for its MCP server '[^'\u0000]+'/);
  });

  it("names the agent's own MCP server that keeps a variable a hook reads, resolved this turn or not", async () => {
    const base = input([{ plugin: mounted, format: "claude-code", groups: groups({ command: "check", args: ["${user_config.ZENDESK_KEY}"] }) }], {
      tools: new Map<string, ToolValueGroup>([
        [toolValuesKey("agent", "agt_helper", "zendesk"), { url: "https://acme-co.zendesk.com/mcp", values: { ZENDESK_KEY: "zd" } }],
      ]),
    });
    const server: ResolvedMcpServer = {
      slug: "zendesk",
      connectionType: "http",
      url: "https://acme-co.zendesk.com/mcp",
      home: { kind: "agent", agentId: "agt_helper", subagent: null, server: "zendesk" },
    };
    const sentence = new HookSetupError(
      "A hook of the plugin 'safety' reads the variable ZENDESK_KEY, which this run keeps for its MCP server 'zendesk' " +
        "and gives neither the agent's shell nor its hooks. Give the hook a variable of its own, then run again.",
    );
    const platform: ResolvedMcpServer = { slug: "stigmer-memory", connectionType: "http", url: "https://bridge.example/mcp", home: { kind: "platform" } };
    await expect(buildHookEvaluator({ ...base, mcp: { ...base.mcp, servers: [platform, server] } }, sink, 180_000)).rejects.toThrow(sentence);
    await expect(buildHookEvaluator(base, sink, 180_000)).rejects.toThrow(sentence);
  });

  it("refuses a shell-form command that reads user_config, and judges only the events it runs", async () => {
    const shellForm = input([{ plugin: mounted, format: "claude-code", groups: groups({ command: "check ${user_config.API_TOKEN}" }) }]);
    await expect(buildHookEvaluator(shellForm, sink, 180_000)).rejects.toThrow(
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
    expect(await buildHookEvaluator(input([{ plugin: mounted, format: "claude-code", groups: notRun }]), sink, 180_000)).toBeNull();
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
      const hooks = await buildHookEvaluator(turn, { ...sink, recordActivity }, 30);
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
      await expect(buildHookEvaluator(input([{ plugin: mounted, format: "claude-code", groups: groups({ command: "check" }) }]), sink, 180_000)).rejects.toThrow(
        "no bash is on this runner's PATH",
      );
      expect(await buildHookEvaluator(input([{ plugin: mounted, format: "claude-code", groups: groups({ command: "/bin/check", args: ["x"] }) }]), sink, 180_000)).not.toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("fills a subagent's own block from the subagent's values, never the agent's", async () => {
    const reads = groups({ command: "check", args: ["${user_config.NOTES_KEY}"] });
    const own = subagent([{ plugin: null, format: "claude-code", groups: reads }], { NOTES_KEY: "n" });
    const turn = input([], { subagents: [own] });
    expect(await buildHookEvaluator(turn, sink, 180_000), "the main agent has no hooks").toBeNull();
    expect(await buildHookEvaluator(turn, sink, 180_000, own)).not.toBeNull();

    const agentsOnly = subagent([{ plugin: null, format: "claude-code", groups: reads }], {});
    await expect(
      buildHookEvaluator(input([], { agent: { NOTES_KEY: "agent's" }, subagents: [agentsOnly] }), sink, 180_000, agentsOnly),
    ).rejects.toThrow(
      "A hook in the subagent 'release-notes''s own hooks block reads the variable NOTES_KEY, which this run does not give the subagent 'release-notes'. " +
        "Declare NOTES_KEY in the subagent 'release-notes''s env and set its value, then run again.",
    );
  });

  it("runs the conversation's hooks first on a subagent's call, in the agent's environment, then the subagent's own in its own", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "hooks-subagent-"));
    try {
      const own = subagent([{ plugin: null, format: "claude-code", groups: reportsEnv("subagent") }], { NOTES_KEY: "notes-secret" });
      const turn = input([{ plugin: null, format: "claude-code", groups: reportsEnv("conversation") }], {
        agent: { AGENT_KEY: "agent-secret" },
        workspaceDir: workspace,
        subagents: [own],
      });
      const call = { id: "c", name: "read_file", args: { file_path: "/a.md" }, serverSlug: "" };

      const main = await buildHookEvaluator(turn, sink, 180_000);
      expect((await main!.preToolUse(call, {})).additionalContext, "the main agent's graph runs only the conversation's").toEqual([
        "conversation agent=agent-secret sub=",
      ]);

      const delegated = await buildHookEvaluator(turn, sink, 180_000, own);
      expect((await delegated!.preToolUse(call, {})).additionalContext).toEqual([
        "conversation agent=agent-secret sub=",
        "subagent agent= sub=notes-secret",
      ]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("shows a hook a subagent's plugin server by its plugin's name, as Claude Code does, and a platform server by its slug", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "hooks-subagent-servers-"));
    try {
      const github: ResolvedMcpServer = {
        slug: "plugin_github_api",
        connectionType: "http",
        url: "https://api.githubcopilot.com/mcp/",
        home: { kind: "plugin", pluginId: "plg_github", plugin: "github", server: "api" },
      };
      const platform: ResolvedMcpServer = { slug: "notes", connectionType: "http", url: "https://notes.example.com/mcp", home: { kind: "platform" } };
      const reportsServer = [
        create(HookGroupSchema, {
          event: "PreToolUse",
          matcher: "mcp__.*",
          handlers: [
            create(HookHandlerSchema, {
              command:
                `input=$(cat); case "$input" in *'"name":"plugin:github:api"'*) n=plugin:github:api ;; *'"name":"notes"'*) n=notes ;; *) n=unnamed ;; esac; ` +
                `printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}' "$n"`,
            }),
          ],
        }),
      ];
      const own: TurnSubagent = { ...subagent([{ plugin: null, format: "claude-code", groups: reportsServer }], {}), servers: [github, platform] };
      const turn = input([], { workspaceDir: workspace, subagents: [own] });
      const delegated = await buildHookEvaluator(turn, sink, 180_000, own);
      const issue = await delegated!.preToolUse({ id: "c1", name: "create_issue", args: {}, serverSlug: "plugin_github_api" }, {});
      expect(issue.additionalContext).toEqual(["plugin:github:api"]);
      const note = await delegated!.preToolUse({ id: "c2", name: "add_note", args: {}, serverSlug: "notes" }, {});
      expect(note.additionalContext).toEqual(["notes"]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
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
