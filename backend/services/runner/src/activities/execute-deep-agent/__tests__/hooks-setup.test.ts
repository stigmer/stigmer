/**
 * Pins the native harness's hook setup (`hooks-setup.ts`): no evaluator for
 * an agent without hooks this engine runs; a hook's `${user_config.KEY}`
 * resolved from the run's values for the agent shell, a missing one
 * refusing the turn by name; a shell-form hook with no `bash` on the hook's
 * PATH refusing the turn; and Claude's `permission_mode` for the turn.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { HookGroupSchema, HookHandlerSchema, type HookGroup } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import type { TurnHookSource, TurnInput } from "../../../harness/types.js";
import type { ResolvedMcpServer } from "../../../shared/mcp-resolver.js";
import type { MountedPlugin } from "../../../shared/plugin-mount.js";
import { buildHookEvaluator, HookSetupError, permissionModeOf } from "../hooks-setup.js";

const sink = { stopSignal: new AbortController().signal, recordActivity: vi.fn() };
const tools = { toolServerMap: new Map<string, string>() };

const mounted: MountedPlugin = { slug: "safety", name: "Safety", root: "/p/safety", data: "/d/safety", verify: async () => undefined };

function groups(...handlers: { command: string; args?: string[] }[]): HookGroup[] {
  return [create(HookGroupSchema, { event: "PreToolUse", matcher: "Bash", handlers: handlers.map((h) => create(HookHandlerSchema, { command: h.command, args: h.args ?? [] })) })];
}

function input(
  sources: TurnHookSource[],
  extra: { declare?: string[]; values?: Record<string, string>; workspaceDir?: string } = {},
): TurnInput {
  const base = turnInputFixture({
    ...(extra.workspaceDir !== undefined ? { workspaceDir: extra.workspaceDir } : {}),
    hooks: { sources, pluginServers: new Map() },
    environment: { envVars: extra.values ?? {}, secretKeys: new Set() },
  });
  const spec = create(AgentSpecSchema, {
    instructions: "You are the fixture agent.",
    env: Object.fromEntries((extra.declare ?? []).map((key) => [key, create(EnvVarDeclarationSchema, {})])),
  });
  return { ...base, blueprint: { ...base.blueprint, agent: { ...base.blueprint.agent!, spec } } };
}

afterEach(() => vi.unstubAllEnvs());

describe("buildHookEvaluator", () => {
  it("builds nothing for an agent without hooks, or with none this engine runs", async () => {
    expect(await buildHookEvaluator(input([]), sink, tools, 180_000)).toBeNull();
    const lifecycle = [create(HookGroupSchema, { event: "Stop", handlers: [create(HookHandlerSchema, { command: "x" })] })];
    expect(await buildHookEvaluator(input([{ plugin: mounted, format: "claude-code", groups: lifecycle }]), sink, tools, 180_000)).toBeNull();
  });

  it("builds an evaluator when every value a hook reads is the run's", async () => {
    const hooks = await buildHookEvaluator(
      input([{ plugin: mounted, format: "claude-code", groups: groups({ command: "check", args: ["${user_config.API_TOKEN}"] }) }], { declare: ["API_TOKEN"], values: { API_TOKEN: "t" } }),
      sink,
      tools,
      180_000,
    );
    expect(hooks).not.toBeNull();
  });

  it("refuses the turn when a hook reads a value the run does not give the agent", async () => {
    const undeclared = input([{ plugin: mounted, format: "claude-code", groups: groups({ command: "check", args: ["${user_config.API_TOKEN}"] }) }], { values: { API_TOKEN: "t" } });
    await expect(buildHookEvaluator(undeclared, sink, tools, 180_000)).rejects.toThrow(
      new HookSetupError(
        "A hook of the plugin 'safety' reads the variable API_TOKEN, which this run does not give the agent. Declare API_TOKEN in the agent's env and set its value, then run again.",
      ),
    );
    const own = input([{ plugin: null, format: "claude-code", groups: groups({ command: "check", args: ["${user_config.X}"] }) }]);
    await expect(buildHookEvaluator(own, sink, tools, 180_000)).rejects.toThrow("A hook in the agent's own hooks block reads the variable X");
  });

  it("names the MCP server that keeps a variable a hook reads", async () => {
    const base = input([{ plugin: mounted, format: "claude-code", groups: groups({ command: "check", args: ["${user_config.API_TOKEN}"] }) }], {
      declare: ["API_TOKEN"],
      values: { API_TOKEN: "t" },
    });
    const server = { slug: "github", declaredEnvKeys: ["API_TOKEN"] } as Partial<ResolvedMcpServer> as ResolvedMcpServer;
    const claimed: TurnInput = { ...base, mcp: { ...base.mcp, servers: [server] } };
    await expect(buildHookEvaluator(claimed, sink, tools, 180_000)).rejects.toThrow(
      new HookSetupError(
        "A hook of the plugin 'safety' reads the variable API_TOKEN, which this run keeps for its MCP server 'github' " +
          "and gives neither the agent's shell nor its hooks. Give the hook a variable of its own, then run again.",
      ),
    );
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
