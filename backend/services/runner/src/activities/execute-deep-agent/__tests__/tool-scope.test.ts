/**
 * The tool-scope middleware (`middleware/tool-scope.ts`) on a real deepagents
 * graph driven by the scripted model: the native engine's enforcement of an
 * agent's two tool lists.
 *
 * Pinned, each on the graph the runner builds (`buildMiddlewareStack`, the
 * CAS-capture backend, `compileSubagents`):
 *  - an out-of-scope tool is hidden from what the model is bound with, the
 *    filesystem middleware's tools included, while a platform server's tools
 *    stay;
 *  - a call to one is refused with an error `ToolMessage` carrying
 *    `outOfScopeMessage`, and its handler never runs;
 *  - the refusal binds with no approval gate installed (auto-approve-all), and
 *    with the gate installed a refused call raises no interrupt;
 *  - with `Read` excluded, `read_file` stays bound but reads only the
 *    platform's `.stigmer/` content and deepagents' offloads, each a route to
 *    a backend outside the workspace, whatever path dialect the model writes;
 *    a link in an offload directory reaches nothing outside it, and a
 *    repository's own directory of an offload root's name is behind the route
 *    (`platform-route.ts` `admitsRoutedRead`, on the backend the runner
 *    mounts);
 *  - a sub-agent's graph enforces its own narrowed scope;
 *  - with `Skill` denied, `read_file` of a skill's files is refused whether
 *    `Read` is in scope or confined, and the admission is never asked; a
 *    `.stigmer/` path is judged by its real path, so a link a plugin's hook
 *    leaves under `plugin-data/` pointing into `skills/` is refused too
 *    (`shared/skill-mount.ts` `skillContentReadCheck`, on a real temp
 *    platform dir).
 * The attribution of an MCP tool by object (never by a shared name) is pinned
 * on the middleware directly, since a graph refuses two tools of one name.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { createDeepAgent } from "deepagents";
import { z } from "zod";

import { buildMiddlewareStack } from "../../../middleware/index.js";
import { createToolScopeMiddleware, type ToolScopeConfig } from "../../../middleware/tool-scope.js";
import type { ApprovalGateConfig } from "../../../middleware/approval-gate.js";
import type { ModelCallRequest, ToolCallRequest } from "../../../middleware/types.js";
import { ToolScope, outOfScopeMessage, type ToolLists } from "../../../shared/tool-lists.js";
import { createCasCaptureBackend } from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../../../shared/filereview/cas-capture-observer.js";
import { compileSubagents } from "../subagent-transformer.js";
import { admitsRoutedRead, mountPlatformRoute } from "../platform-route.js";
import { offloadDirBeside } from "../../../shared/workspace/platform-dir.js";
import { skillContentReadCheck } from "../../../shared/skill-mount.js";
import { ScriptedModel, readPendingInterrupts, type ScriptSelector, type ScriptedToolCall } from "../__test-utils__/scripted-model.js";

const NO_GATE_DEFAULT = { destructive: new Set<string>(), unlisted: new Set<string>(), leasedServers: new Set<string>() };

/** A server tool that counts its runs, so a test can prove a refused call never ran. */
function countingTool(name: string, runs: string[]) {
  return tool(
    async () => {
      runs.push(name);
      return `${name} ran`;
    },
    { name, description: `test tool ${name}`, schema: z.object({}).passthrough() },
  );
}

interface GraphRun {
  /** The tool names the model was bound with on its first turn. */
  readonly bound: readonly string[];
  readonly messages: readonly BaseMessage[];
  readonly pendingInterrupts: number;
}

describe("tool scope on a real deepagents graph", () => {
  let root: string;
  let session: string;
  let platformDir: string;
  let runs: string[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "tool-scope-"));
    session = await mkdtemp(join(tmpdir(), "tool-scope-session-"));
    platformDir = join(session, "platform");
    await mkdir(platformDir);
    runs = [];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(session, { recursive: true, force: true });
  });

  /** One parent graph over the runner's stack: a `github` server (two tools) and a platform server (one). */
  async function runParent(options: {
    readonly lists: ToolLists;
    readonly calls: ScriptedToolCall[];
    readonly gate?: boolean;
  }): Promise<GraphRun> {
    const github = [countingTool("search_code", runs), countingTool("delete_repo", runs)];
    const platform = [countingTool("send_channel_message", runs)];
    const scope = ToolScope.of('Agent "a"', options.lists);
    const scopeConfig: ToolScopeConfig = {
      scope,
      serverToolMap: new Map<string, readonly unknown[]>([
        ["github", github],
        ["stigmer-channels", platform],
      ]),
      platformServerSlugs: new Set(["stigmer-channels"]),
      admitsRoutedRead,
      readsSkillContent: skillContentReadCheck(undefined),
    };
    const gate: ApprovalGateConfig | null = options.gate
      ? {
          mcpDefault: NO_GATE_DEFAULT,
          toolServerMap: new Map([
            ["search_code", "github"],
            ["delete_repo", "github"],
            ["send_channel_message", "stigmer-channels"],
          ]),
        }
      : null;
    const { middleware } = buildMiddlewareStack({
      pathNormalization: { rootDir: root },
      toolScope: scopeConfig,
      approvalGate: gate,
    });
    let bound: string[] | undefined;
    const script: ScriptSelector = (names) => {
      bound ??= [...names];
      return { toolCalls: options.calls, done: "done" };
    };
    const observer = new CasCaptureObserver({ rootDir: root, isIgnored: async () => true });
    // The graph's backend as the runner mounts it: the workspace, with the
    // `.stigmer/` route and deepagents' offload roots routed out of it.
    const backend = await mountPlatformRoute(await createCasCaptureBackend({ rootDir: root, observer, shellEnv: {} }), { workspaceDir: root, platformDir });
    const graph = await createDeepAgent({
      model: new ScriptedModel(script),
      checkpointer: new MemorySaver() as never,
      backend,
      tools: [...github, ...platform],
      middleware,
    } as unknown as Parameters<typeof createDeepAgent>[0]);
    const config = { configurable: { thread_id: "scope" }, recursionLimit: 50 };
    const result = (await graph.invoke({ messages: [new HumanMessage({ content: "go" })] }, config)) as {
      messages: BaseMessage[];
    };
    const pending = readPendingInterrupts((await graph.getState(config)) as never);
    return { bound: bound ?? [], messages: result.messages, pendingInterrupts: pending.length };
  }

  function toolMessage(run: GraphRun, callId: string): ToolMessage {
    const found = run.messages.find((m): m is ToolMessage => ToolMessage.isInstance(m) && m.tool_call_id === callId);
    if (!found) throw new Error(`no ToolMessage answers ${callId}`);
    return found;
  }

  it("hides what an allow-list leaves out — built-ins, filesystem tools and server tools — and keeps the platform's", async () => {
    const run = await runParent({ lists: { tools: ["Grep", "mcp__github__search_code"], disallowedTools: [] }, calls: [] });

    expect(run.bound).toContain("grep");
    expect(run.bound).toContain("search_code");
    expect(run.bound, "a platform server is outside every list").toContain("send_channel_message");
    expect(run.bound, "read_file stays bound when Read is excluded").toContain("read_file");
    for (const hidden of ["execute", "write_file", "edit_file", "glob", "ls", "task", "delete_repo"]) {
      expect(run.bound, hidden).not.toContain(hidden);
    }
  });

  it("hides only what a deny-list names", async () => {
    const run = await runParent({ lists: { tools: [], disallowedTools: ["Bash", "mcp__github__delete_repo"] }, calls: [] });

    expect(run.bound).not.toContain("execute");
    expect(run.bound).not.toContain("delete_repo");
    for (const kept of ["read_file", "write_file", "edit_file", "glob", "ls", "grep", "task", "search_code"]) {
      expect(run.bound, kept).toContain(kept);
    }
  });

  it("refuses a call to an out-of-scope tool with the lists' message, without running it", async () => {
    const lists = { tools: ["Read", "mcp__github__search_code"], disallowedTools: [] };
    const run = await runParent({
      lists,
      calls: [
        { name: "delete_repo", args: {}, id: "call_mcp" },
        { name: "execute", args: { command: "echo ran > marker.txt" }, id: "call_shell" },
        { name: "search_code", args: {}, id: "call_ok" },
      ],
    });

    const scope = ToolScope.of('Agent "a"', lists);
    const refusedMcp = toolMessage(run, "call_mcp");
    expect(refusedMcp.status).toBe("error");
    expect(refusedMcp.content).toBe(outOfScopeMessage("delete_repo", scope));
    expect(toolMessage(run, "call_shell").content).toBe(outOfScopeMessage("execute", scope));
    await expect(readFile(join(root, "marker.txt"), "utf8"), "the shell never ran").rejects.toThrow();
    expect(runs, "only the in-scope tool ran").toEqual(["search_code"]);
  });

  it("binds with no approval gate installed (auto-approve-all)", async () => {
    const run = await runParent({
      lists: { tools: [], disallowedTools: ["Write"] },
      calls: [{ name: "write_file", args: { file_path: "/out.txt", content: "x" }, id: "call_w" }],
      gate: false,
    });

    expect(toolMessage(run, "call_w").status).toBe("error");
    await expect(readFile(join(root, "out.txt"), "utf8")).rejects.toThrow();
  });

  it("refuses ahead of the gate: a listed-out call raises no approval interrupt", async () => {
    const run = await runParent({
      lists: { tools: [], disallowedTools: ["Bash"] },
      calls: [{ name: "execute", args: { command: "echo ran > marker.txt" }, id: "call_shell" }],
      gate: true,
    });

    expect(run.pendingInterrupts, "no card for a refused call").toBe(0);
    expect(toolMessage(run, "call_shell").status).toBe("error");
  });

  it("with Read excluded, read_file reads the platform's .stigmer/ content and its offloads, nothing of the workspace", async () => {
    await mkdir(join(platformDir, "skills"));
    await writeFile(join(platformDir, "skills", "SKILL.md"), "skill body");
    await symlink(platformDir, join(root, ".stigmer"));
    await writeFile(join(root, "notes.txt"), "workspace secret");
    const offloaded = join(offloadDirBeside(platformDir), "large_tool_results");
    await mkdir(offloaded, { recursive: true });
    await writeFile(join(offloaded, "call_1.txt"), "offloaded body");
    await symlink(join(root, "notes.txt"), join(offloaded, "leak.txt"));
    await mkdir(join(root, "large_tool_results"));
    await writeFile(join(root, "large_tool_results", "own.txt"), "the repository's own");
    const lists = { tools: ["Grep"], disallowedTools: [] };
    const run = await runParent({
      lists,
      calls: [
        { name: "read_file", args: { file_path: "/.stigmer/skills/SKILL.md" }, id: "call_skill" },
        { name: "read_file", args: { file_path: ".stigmer/skills/SKILL.md" }, id: "call_relative" },
        { name: "read_file", args: { file_path: "/notes.txt" }, id: "call_ws" },
        { name: "read_file", args: { file_path: "/.stigmer/../notes.txt" }, id: "call_escape" },
        { name: "read_file", args: { file_path: `${root}/notes.txt` }, id: "call_real" },
        { name: "read_file", args: { file_path: "/large_tool_results/call_1.txt" }, id: "call_offload" },
        { name: "read_file", args: { file_path: "/large_tool_results/leak.txt" }, id: "call_leak" },
        { name: "read_file", args: { file_path: "/large_tool_results/own.txt" }, id: "call_own" },
      ],
    });

    const scope = ToolScope.of('Agent "a"', lists);
    expect(JSON.stringify(toolMessage(run, "call_skill").content)).toContain("skill body");
    expect(JSON.stringify(toolMessage(run, "call_relative").content), "a relative path normalizes first").toContain("skill body");
    expect(JSON.stringify(toolMessage(run, "call_offload").content), "an offloaded file reads, from the session's offload directory").toContain("offloaded body");
    for (const id of ["call_ws", "call_escape", "call_real"]) {
      expect(toolMessage(run, id).content, id).toBe(outOfScopeMessage("read_file", scope));
    }
    expect(JSON.stringify(toolMessage(run, "call_leak").content), "a link in the offload directory reaches nothing outside it").not.toContain("workspace secret");
    expect(JSON.stringify(toolMessage(run, "call_own").content), "the repository's own directory is behind the route").not.toContain("the repository's own");
  });

  it("a sub-agent's graph enforces its own narrowed scope, never the parent's wider one", async () => {
    const parentScope = ToolScope.of('Agent "a"', { tools: [], disallowedTools: [] });
    const workerScope = parentScope.narrow('Sub-agent "worker"', { tools: ["Read"], disallowedTools: [] });
    let workerBound: string[] | undefined;
    const roles: ScriptSelector = (names, { systemPrompt }) => {
      if (systemPrompt.includes("WORKER")) {
        workerBound ??= [...names];
        return { toolCalls: [{ name: "execute", args: { command: "echo ran > marker.txt" }, id: "w_shell" }], done: "worker done" };
      }
      return {
        toolCalls: [{ name: "task", args: { description: "do it", subagent_type: "worker" }, id: "p_task" }],
        done: "parent done",
      };
    };
    const observer = new CasCaptureObserver({ rootDir: root, isIgnored: async () => true });
    const compiled = await compileSubagents(
      [{ name: "worker", description: "worker", systemPrompt: "WORKER", tools: [], scope: workerScope }],
      {
        parentModelName: "test-model",
        workspaceRootDir: root,
        casObserver: observer,
        shellEnv: {},
        scopeBase: {
          serverToolMap: new Map(),
          platformServerSlugs: new Set(),
          admitsRoutedRead,
          readsSkillContent: skillContentReadCheck(undefined),
        },
        modelFactory: async () => new ScriptedModel(roles),
      },
    );
    const graph = await createDeepAgent({
      model: new ScriptedModel(roles),
      checkpointer: new MemorySaver() as never,
      backend: await createCasCaptureBackend({ rootDir: root, observer, shellEnv: {} }),
      subagents: compiled,
    } as unknown as Parameters<typeof createDeepAgent>[0]);

    const result = (await graph.invoke(
      { messages: [new HumanMessage({ content: "go" })] },
      { configurable: { thread_id: "sub" }, recursionLimit: 50 },
    )) as { messages: BaseMessage[] };

    expect(workerBound).toContain("read_file");
    expect(workerBound, "hidden in the sub-agent").not.toContain("execute");
    const taskResult = result.messages.find((m) => ToolMessage.isInstance(m) && m.tool_call_id === "p_task");
    expect(taskResult, "the delegation completed").toBeDefined();
    await expect(readFile(join(root, "marker.txt"), "utf8"), "the sub-agent's shell never ran").rejects.toThrow();
  });
});

describe("tool scope attribution, on the middleware itself", () => {
  const serverA = { name: "search" };
  const serverB = { name: "search" };
  const config = (lists: ToolLists): ToolScopeConfig => ({
    scope: ToolScope.of('Agent "a"', lists),
    serverToolMap: new Map<string, readonly unknown[]>([
      ["a", [serverA]],
      ["b", [serverB]],
    ]),
    platformServerSlugs: new Set(),
    admitsRoutedRead: async () => true,
    readsSkillContent: skillContentReadCheck(undefined),
  });

  function visibleTools(cfg: ToolScopeConfig, tools: unknown[]): unknown[] {
    let seen: unknown[] = [];
    const request = { model: {}, messages: [], tools, state: {}, runtime: {} } as ModelCallRequest;
    void createToolScopeMiddleware(cfg).wrapModelCall!(request, (req) => {
      seen = req.tools ?? [];
      return {} as never;
    });
    return seen;
  }

  async function callRefused(
    cfg: ToolScopeConfig,
    name: string,
    toolObject: unknown,
    args: Record<string, unknown> = {},
  ): Promise<boolean> {
    let ran = false;
    const request: ToolCallRequest = { toolCall: { id: "c", name, args }, tool: toolObject, state: {}, runtime: {} };
    const out = await createToolScopeMiddleware(cfg).wrapToolCall!(request, () => {
      ran = true;
      return new ToolMessage({ content: "ran", tool_call_id: "c" });
    });
    return !ran && ToolMessage.isInstance(out) && out.status === "error";
  }

  it("hides by tool object: two servers' same-named tools are told apart", () => {
    expect(visibleTools(config({ tools: ["mcp__a"], disallowedTools: [] }), [serverA, serverB])).toEqual([serverA]);
  });

  it("refuses by the call's tool object when it carries one", async () => {
    const cfg = config({ tools: ["mcp__a"], disallowedTools: [] });
    expect(await callRefused(cfg, "search", serverA)).toBe(false);
    expect(await callRefused(cfg, "search", serverB)).toBe(true);
  });

  it("refuses a bare-name call unless every server carrying the name allows it", async () => {
    expect(await callRefused(config({ tools: ["mcp__a"], disallowedTools: [] }), "search", undefined)).toBe(true);
    expect(await callRefused(config({ tools: ["mcp__a", "mcp__b"], disallowedTools: [] }), "search", undefined)).toBe(false);
  });

  it("runs an in-scope built-in and refuses an out-of-scope one, by its native name", async () => {
    const cfg = config({ tools: ["Read"], disallowedTools: [] });
    expect(await callRefused(cfg, "read_file", undefined)).toBe(false);
    expect(await callRefused(cfg, "execute", undefined)).toBe(true);
  });

  it("with Read excluded, asks the injected admission about read_file's path, and refuses one with no path", async () => {
    const asked: string[] = [];
    const cfg: ToolScopeConfig = {
      ...config({ tools: ["Grep"], disallowedTools: [] }),
      admitsRoutedRead: async (path) => {
        asked.push(path);
        return path === "/large_tool_results/a.txt";
      },
    };
    expect(await callRefused(cfg, "read_file", undefined, { file_path: "/large_tool_results/a.txt" })).toBe(false);
    expect(await callRefused(cfg, "read_file", undefined, { file_path: "/src/a.ts" })).toBe(true);
    expect(await callRefused(cfg, "read_file", undefined, {})).toBe(true);
    expect(asked).toEqual(["/large_tool_results/a.txt", "/src/a.ts"]);
  });

  it("with Skill denied, refuses read_file of a skill's files whether Read is in scope or confined, and reads the rest", async () => {
    const asked: string[] = [];
    const confined: ToolScopeConfig = {
      ...config({ tools: ["Grep"], disallowedTools: ["Skill"] }),
      admitsRoutedRead: async (path) => {
        asked.push(path);
        return true;
      },
    };
    expect(await callRefused(confined, "read_file", undefined, { file_path: "/.stigmer/skills/a/SKILL.md" })).toBe(true);
    expect(await callRefused(confined, "read_file", undefined, { file_path: "/.stigmer/plugins/d1/skills/b/SKILL.md" })).toBe(true);
    expect(await callRefused(confined, "read_file", undefined, { file_path: "/.stigmer/inputs/spec.pdf" })).toBe(false);
    expect(asked, "a hidden skill's path never reaches the admission").toEqual(["/.stigmer/inputs/spec.pdf"]);
    const open = config({ tools: [], disallowedTools: ["Skill"] });
    expect(await callRefused(open, "read_file", undefined, { file_path: "/.stigmer/skills/a/SKILL.md" })).toBe(true);
    expect(await callRefused(open, "read_file", undefined, { file_path: "/src/a.ts" })).toBe(false);
    expect(await callRefused(open, "grep", undefined, { pattern: "x" }), "only the read is the skill's activation").toBe(false);
  });

  describe("with Skill denied, over a real platform dir", () => {
    let platformDir: string;

    beforeEach(async () => {
      platformDir = await mkdtemp(join(tmpdir(), "skill-read-"));
      await mkdir(join(platformDir, "skills", "a"), { recursive: true });
      await writeFile(join(platformDir, "skills", "a", "SKILL.md"), "skill body");
      await mkdir(join(platformDir, "plugin-data", "p"), { recursive: true });
      await writeFile(join(platformDir, "plugin-data", "p", "own.txt"), "the plugin's own data");
      await symlink(join("..", "..", "skills", "a", "SKILL.md"), join(platformDir, "plugin-data", "p", "file-link"));
      await symlink(join("..", "..", "skills"), join(platformDir, "plugin-data", "p", "dir-link"));
      await symlink(join("..", "..", "skills", "gone.md"), join(platformDir, "plugin-data", "p", "dangling"));
    });

    afterEach(async () => {
      await rm(platformDir, { recursive: true, force: true });
    });

    it("refuses a read whose real path lands in skills/, by a file or a directory link", async () => {
      const cfg: ToolScopeConfig = {
        ...config({ tools: [], disallowedTools: ["Skill"] }),
        readsSkillContent: skillContentReadCheck(platformDir),
      };
      expect(await callRefused(cfg, "read_file", undefined, { file_path: "/.stigmer/plugin-data/p/file-link" })).toBe(true);
      expect(await callRefused(cfg, "read_file", undefined, { file_path: "/.stigmer/plugin-data/p/dir-link/a/SKILL.md" })).toBe(true);
      expect(await callRefused(cfg, "read_file", undefined, { file_path: "/.stigmer/Skills/a/SKILL.md" }), "by the path's text").toBe(true);
      expect(await callRefused(cfg, "read_file", undefined, { file_path: "/.STIGMER/plugin-data/p/file-link" }), "the prefix in any letter case").toBe(true);
      expect(await callRefused(cfg, "read_file", undefined, { file_path: "/.stigmer/plugin-data/p/own.txt" })).toBe(false);
      expect(await callRefused(cfg, "read_file", undefined, { file_path: "/.stigmer/plugin-data/p/dangling" }), "nothing to read").toBe(false);
      expect(await callRefused(cfg, "read_file", undefined, { file_path: "/src/a.ts" }), "outside the route").toBe(false);
    });

    it("reads the same links when the scope keeps Skill", async () => {
      const cfg: ToolScopeConfig = {
        ...config({ tools: [], disallowedTools: [] }),
        readsSkillContent: skillContentReadCheck(platformDir),
      };
      expect(await callRefused(cfg, "read_file", undefined, { file_path: "/.stigmer/plugin-data/p/file-link" })).toBe(false);
    });

    it("judges a link by its real path through a platform dir that is itself reached by a link", async () => {
      const linked = `${platformDir}-link`;
      await symlink(platformDir, linked);
      try {
        const check = skillContentReadCheck(linked);
        expect(await check("/.stigmer/plugin-data/p/file-link")).toBe(true);
        expect(await check("/.stigmer/plugin-data/p/own.txt")).toBe(false);
      } finally {
        await rm(linked, { force: true });
      }
    });
  });

  it("leaves alone what carries no name (a provider tool), and passes a request with no tools through", () => {
    const cfg: ToolScopeConfig = {
      ...config({ tools: ["Read"], disallowedTools: [] }),
      serverToolMap: new Map<string, readonly unknown[]>([["a", [serverA, { description: "nameless" }]]]),
    };
    const providerTool = { type: "web_search_20250305" };
    expect(visibleTools(cfg, [providerTool, "not-an-object", serverA])).toEqual([providerTool, "not-an-object"]);

    let passed: ModelCallRequest | undefined;
    const request = { model: {}, messages: [], state: {}, runtime: {} } as ModelCallRequest;
    void createToolScopeMiddleware(cfg).wrapModelCall!(request, (req) => {
      passed = req;
      return {} as never;
    });
    expect(passed, "no tools to filter: the request goes on as it came").toBe(request);
  });

  it("keeps the stop tool in scope exactly when the shell is", async () => {
    const shell = { name: "execute" };
    const stop = { name: "stop_background_command" };
    expect(visibleTools(config({ tools: ["Bash"], disallowedTools: [] }), [shell, stop]), "an allow-list of Bash keeps both").toEqual([shell, stop]);
    expect(visibleTools(config({ tools: ["Read"], disallowedTools: [] }), [shell, stop]), "one without Bash hides both").toEqual([]);
    expect(visibleTools(config({ tools: [], disallowedTools: ["Bash"] }), [shell, stop]), "a deny of Bash hides both").toEqual([]);
    expect(await callRefused(config({ tools: ["Bash"], disallowedTools: [] }), "stop_background_command", undefined, { id: "bg_1" })).toBe(false);
    expect(await callRefused(config({ tools: ["Read"], disallowedTools: [] }), "stop_background_command", undefined, { id: "bg_1" })).toBe(true);
  });

  it("hides an engine extra under an allow-list and leaves it under a deny-list", () => {
    const extra = { name: "some_engine_extra" };
    expect(visibleTools(config({ tools: ["Read"], disallowedTools: [] }), [extra])).toEqual([]);
    expect(visibleTools(config({ tools: [], disallowedTools: ["Bash"] }), [extra])).toEqual([extra]);
  });
});

describe("admitsRoutedRead", () => {
  it("admits the .stigmer/ route and deepagents' two offload roots by prefix: each is its own backend outside the workspace", async () => {
    expect(await admitsRoutedRead("/.stigmer/skills/a/SKILL.md")).toBe(true);
    expect(await admitsRoutedRead("/../.stigmer/a"), "normalized: a root-level `..` stays at the root").toBe(true);
    expect(await admitsRoutedRead("/large_tool_results/call_1.txt")).toBe(true);
    expect(await admitsRoutedRead("/conversation_history/session_0a1b.md")).toBe(true);
  });

  it("refuses a `..` traversal out of a route, the workspace, a sibling prefix, a nested same-named directory and a relative path", async () => {
    expect(await admitsRoutedRead("/large_tool_results/../secret.ts")).toBe(false);
    expect(await admitsRoutedRead("/.stigmer/../secret.ts")).toBe(false);
    expect(await admitsRoutedRead("/secret.ts")).toBe(false);
    expect(await admitsRoutedRead("/.stigmerx/a")).toBe(false);
    expect(await admitsRoutedRead("/large_tool_resultsx/a")).toBe(false);
    expect(await admitsRoutedRead("/docs/large_tool_results/x.md")).toBe(false);
    expect(await admitsRoutedRead(".stigmer/a")).toBe(false);
  });
});
