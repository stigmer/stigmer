/**
 * The tool-scope middleware (`middleware/tool-scope.ts`) on a real deepagents
 * graph driven by the scripted model: the native engine's enforcement of an
 * agent's two tool lists.
 *
 * Pinned, each on the graph the runner builds (`buildMiddlewareStack`, the
 * CAS-capture backend, `compileSubagents`):
 *  - an out-of-scope tool is hidden from what the model is bound with, the
 *    filesystem middleware's tools included, while a platform server's tools
 *    and `think` stay;
 *  - a call to one is refused with an error `ToolMessage` carrying
 *    `outOfScopeMessage`, and its handler never runs;
 *  - the refusal binds with no approval gate installed (auto-approve-all), and
 *    with the gate installed a refused call raises no interrupt;
 *  - with `Read` excluded, `read_file` stays bound but reads only under the
 *    confined roots, whatever path dialect the model writes;
 *  - a sub-agent's graph enforces its own narrowed scope.
 * The attribution of an MCP tool by object (never by a shared name) is pinned
 * on the middleware directly, since a graph refuses two tools of one name.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { createDeepAgent } from "deepagents";
import { z } from "zod";

import { buildMiddlewareStack } from "../../../middleware/index.js";
import { createToolScopeMiddleware, isUnderConfinedRoot, type ToolScopeConfig } from "../../../middleware/tool-scope.js";
import type { ApprovalGateConfig } from "../../../middleware/approval-gate.js";
import type { ModelCallRequest, ToolCallRequest } from "../../../middleware/types.js";
import { ToolScope, outOfScopeMessage, type ToolLists } from "../../../shared/tool-lists.js";
import { createThinkTool } from "../../../tools/index.js";
import { createCasCaptureBackend } from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../cas-capture-observer.js";
import { compileSubagents } from "../subagent-transformer.js";
import { NATIVE_CONFINED_READ_ROOTS } from "../platform-route.js";
import { ScriptedModel, readPendingInterrupts, type ScriptSelector, type ScriptedToolCall } from "../__test-utils__/scripted-model.js";

const NO_GATE_DEFAULT = { destructive: new Set<string>(), leasedServers: new Set<string>() };

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
  let runs: string[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "tool-scope-"));
    runs = [];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
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
      confinedReadRoots: NATIVE_CONFINED_READ_ROOTS,
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
    const backend = await createCasCaptureBackend({ rootDir: root, observer, shellEnv: {} });
    const graph = await createDeepAgent({
      model: new ScriptedModel(script),
      checkpointer: new MemorySaver() as never,
      backend,
      tools: [...github, ...platform, createThinkTool()],
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
    expect(run.bound, "think is the platform's").toContain("think");
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

  it("with Read excluded, read_file reads the platform's .stigmer/ content and nothing of the workspace", async () => {
    await mkdir(join(root, ".stigmer", "skills"), { recursive: true });
    await writeFile(join(root, ".stigmer", "skills", "SKILL.md"), "skill body");
    await writeFile(join(root, "notes.txt"), "workspace secret");
    const lists = { tools: ["Grep"], disallowedTools: [] };
    const run = await runParent({
      lists,
      calls: [
        { name: "read_file", args: { file_path: "/.stigmer/skills/SKILL.md" }, id: "call_skill" },
        { name: "read_file", args: { file_path: ".stigmer/skills/SKILL.md" }, id: "call_relative" },
        { name: "read_file", args: { file_path: "/notes.txt" }, id: "call_ws" },
        { name: "read_file", args: { file_path: "/.stigmer/../notes.txt" }, id: "call_escape" },
        { name: "read_file", args: { file_path: `${root}/notes.txt` }, id: "call_real" },
      ],
    });

    const scope = ToolScope.of('Agent "a"', lists);
    expect(JSON.stringify(toolMessage(run, "call_skill").content)).toContain("skill body");
    expect(JSON.stringify(toolMessage(run, "call_relative").content), "a relative path normalizes first").toContain("skill body");
    for (const id of ["call_ws", "call_escape", "call_real"]) {
      expect(toolMessage(run, id).content, id).toBe(outOfScopeMessage("read_file", scope));
    }
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
        scopeBase: { serverToolMap: new Map(), platformServerSlugs: new Set(), confinedReadRoots: NATIVE_CONFINED_READ_ROOTS },
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
    confinedReadRoots: NATIVE_CONFINED_READ_ROOTS,
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

  function callRefused(cfg: ToolScopeConfig, name: string, toolObject: unknown): boolean {
    let ran = false;
    const request: ToolCallRequest = { toolCall: { id: "c", name, args: {} }, tool: toolObject, state: {}, runtime: {} };
    const out = createToolScopeMiddleware(cfg).wrapToolCall!(request, () => {
      ran = true;
      return new ToolMessage({ content: "ran", tool_call_id: "c" });
    });
    return !ran && ToolMessage.isInstance(out) && out.status === "error";
  }

  it("hides by tool object: two servers' same-named tools are told apart", () => {
    expect(visibleTools(config({ tools: ["mcp__a"], disallowedTools: [] }), [serverA, serverB])).toEqual([serverA]);
  });

  it("refuses by the call's tool object when it carries one", () => {
    const cfg = config({ tools: ["mcp__a"], disallowedTools: [] });
    expect(callRefused(cfg, "search", serverA)).toBe(false);
    expect(callRefused(cfg, "search", serverB)).toBe(true);
  });

  it("refuses a bare-name call unless every server carrying the name allows it", () => {
    expect(callRefused(config({ tools: ["mcp__a"], disallowedTools: [] }), "search", undefined)).toBe(true);
    expect(callRefused(config({ tools: ["mcp__a", "mcp__b"], disallowedTools: [] }), "search", undefined)).toBe(false);
  });

  it("hides an engine extra under an allow-list and leaves it under a deny-list", () => {
    const extra = { name: "some_engine_extra" };
    expect(visibleTools(config({ tools: ["Read"], disallowedTools: [] }), [extra])).toEqual([]);
    expect(visibleTools(config({ tools: [], disallowedTools: ["Bash"] }), [extra])).toEqual([extra]);
  });
});

describe("isUnderConfinedRoot", () => {
  const roots = NATIVE_CONFINED_READ_ROOTS;

  it("admits the platform route and the offload root, in their canonical virtual form", () => {
    expect(isUnderConfinedRoot("/.stigmer/skills/a/SKILL.md", roots)).toBe(true);
    expect(isUnderConfinedRoot("/large_tool_results/call_1.txt", roots)).toBe(true);
  });

  it("refuses the workspace, a traversal out of a root, a sibling prefix, a relative path and a non-string", () => {
    expect(isUnderConfinedRoot("/src/app.ts", roots)).toBe(false);
    expect(isUnderConfinedRoot("/.stigmer/../src/app.ts", roots)).toBe(false);
    expect(isUnderConfinedRoot("/.stigmerx/a", roots)).toBe(false);
    expect(isUnderConfinedRoot(".stigmer/a", roots)).toBe(false);
    expect(isUnderConfinedRoot(undefined, roots)).toBe(false);
  });
});
