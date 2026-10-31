/**
 * Runtime verification: does a SUB-AGENT approval interrupt propagate to the
 * PARENT checkpoint, and does Command(resume=…) route back into the nested
 * interrupt?
 *
 * This is the make-or-break question behind installing the approval gate on
 * sub-agent graphs. The resume path in `hitl.ts` /
 * `index.ts` reads pending interrupts from the PARENT's top-level
 * `graphState.tasks[].interrupts` and resumes via `Command(resume={taskId: …})`.
 * If a sub-agent interrupt does NOT surface there (or cannot be resumed),
 * gating sub-agent tools would hang executions — strictly worse than the current
 * bypass. So we prove the mechanism end-to-end against the real deepagents +
 * LangGraph runtime before wiring it.
 *
 * Shape under test (faithful to the real pipeline): a deepagents PARENT with a
 * checkpointer and `subagents: [worker]`; the worker is a deepagents agent
 * carrying our real ApprovalGate middleware and NO checkpointer (exactly how
 * compileSubagents builds it). The parent's `task` tool invokes the worker via
 * `worker.invoke(state, {...parentConfig})` — so a GraphInterrupt thrown inside
 * the worker (no checkpointer → re-thrown) must bubble to the parent (has
 * checkpointer → records it).
 *
 * The resume value carries back the arguments a card showed when a hook
 * rewrote the call (`hitl.ts` `resolveResumeInput`): through the nested
 * interrupt into the worker's gate, which runs the approved call only as
 * shown. A worker's hook that rewrites alike on resume runs its rewrite once;
 * one that rewrites otherwise has the approved call refused unrun.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { HookGroupSchema, HookHandlerSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Command, MemorySaver } from "@langchain/langgraph";
import { createDeepAgent, StateBackend } from "deepagents";
import { createApprovalGateMiddleware } from "../../../middleware/approval-gate.js";
import {
  ScriptedModel,
  readPendingInterrupts,
  type ScriptSelector,
} from "../__test-utils__/scripted-model.js";
import { McpToolIndex } from "../../../shared/mcp-tool-names.js";
import { CHANGED_MESSAGE } from "../../../shared/approval-policy.js";
import { HookEvaluator } from "../../../shared/hooks/evaluate.js";
import { HookSet } from "../../../shared/hooks/hook-set.js";
import { StigmerToolViews } from "../../../shared/hooks/tool-view.js";
import { ApprovalAction } from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { resolveResumeInput, type GraphStateSnapshot } from "../hitl.js";

// Role script for this test: the WORKER (its bound tools include the gated
// `overwrite_file`) writes a file; the PARENT delegates via `task`. createDeepAgent
// injects `task` into both, so the role is keyed on the worker's unique tool.
const roleScript: ScriptSelector = (toolNames) =>
  toolNames.includes("overwrite_file")
    ? {
        toolCalls: [
          { name: "overwrite_file", args: { path: "/out.txt", content: "hello" }, id: "write_1" },
        ],
        done: "worker done",
      }
    : {
        toolCalls: [
          { name: "task", args: { description: "write the file", subagent_type: "worker" }, id: "task_1" },
        ],
        done: "parent done",
      };

describe("sub-agent approval interrupt propagation", () => {
  it("surfaces a sub-agent interrupt at the parent checkpoint AND resumes it", async () => {
    let executed = 0;
    const overwriteFile = tool(
      async () => {
        executed += 1;
        return "wrote file";
      },
      {
        name: "overwrite_file",
        description: "overwrite a file at a path",
        schema: z.object({ path: z.string(), content: z.string() }),
      },
    );

    // Worker: real ApprovalGate middleware, NO checkpointer — exactly how
    // compileSubagents builds a sub-agent. overwrite_file classifies as
    // FILE_WRITE, so the gate must interrupt before it runs.
    const worker = await createDeepAgent({
      model: new ScriptedModel(roleScript),
      tools: [overwriteFile],
      middleware: [
        createApprovalGateMiddleware({ mcpDefault: { destructive: new Set(), unlisted: new Set<string>(), leasedServers: new Set() }, mcpIndex: McpToolIndex.EMPTY }),
      ],
      backend: new StateBackend(),
      generalPurposeAgent: false,
    } as unknown as Parameters<typeof createDeepAgent>[0]);

    const checkpointer = new MemorySaver();
    const parent = await createDeepAgent({
      model: new ScriptedModel(roleScript),
      checkpointer: checkpointer as never,
      backend: new StateBackend(),
      subagents: [{ name: "worker", description: "writes files", runnable: worker as never }],
    } as unknown as Parameters<typeof createDeepAgent>[0]);

    const config = { configurable: { thread_id: "thread-1" }, recursionLimit: 50 };

    // Drive to the first pause. The worker's gated tool call must NOT have run.
    await parent.invoke({ messages: [new HumanMessage({ content: "go" })] }, config);

    const afterFirst = await parent.getState(config);
    const pending = readPendingInterrupts(afterFirst as never);

    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0].toolCallId).toBe("write_1");
    expect(executed).toBe(0);

    // Resume with APPROVE, keyed by the actual interrupt id (NOT task.id — for a
    // nested sub-agent interrupt the two differ, and only the interrupt id routes
    // the resume value into the worker's interrupt()).
    const resumeDict: Record<string, { action: string }> = {};
    for (const p of pending) resumeDict[p.interruptId] = { action: "approve" };

    await parent.invoke(new Command({ resume: resumeDict }), config);

    const afterResume = await parent.getState(config);
    const stillPending = readPendingInterrupts(afterResume as never);

    expect(stillPending.length).toBe(0);
    expect(executed).toBe(1);
  });

  it("PARENT-level gated tool: interrupt-id keyed resume also works (fix is safe)", async () => {
    // Guards the hitl.ts change: keying resume by interrupts[].id must also drive
    // a top-level (non-sub-agent) approval, so switching off task.id is safe.
    let executed = 0;
    const overwriteFile = tool(
      async () => {
        executed += 1;
        return "wrote file";
      },
      {
        name: "overwrite_file",
        description: "overwrite a file at a path",
        schema: z.object({ path: z.string(), content: z.string() }),
      },
    );

    const checkpointer = new MemorySaver();
    const parent = await createDeepAgent({
      model: new ScriptedModel(roleScript),
      checkpointer: checkpointer as never,
      backend: new StateBackend(),
      tools: [overwriteFile],
      middleware: [
        createApprovalGateMiddleware({ mcpDefault: { destructive: new Set(), unlisted: new Set<string>(), leasedServers: new Set() }, mcpIndex: McpToolIndex.EMPTY }),
      ],
    } as unknown as Parameters<typeof createDeepAgent>[0]);

    const config = { configurable: { thread_id: "thread-parent" }, recursionLimit: 50 };
    await parent.invoke({ messages: [new HumanMessage({ content: "go" })] }, config);

    const afterFirst = await parent.getState(config);
    const pending = readPendingInterrupts(afterFirst as never);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(executed).toBe(0);

    const resumeDict: Record<string, { action: string }> = {};
    for (const p of pending) resumeDict[p.interruptId] = { action: "approve" };
    await parent.invoke(new Command({ resume: resumeDict }), config);

    expect(readPendingInterrupts((await parent.getState(config)) as never).length).toBe(0);
    expect(executed).toBe(1);
  });

  describe("a worker's hook rewrites its call and asks", () => {
    /** A hook that asks before every fetch, rewriting its url by `urlOfRun` (its runs counted from 1). */
    function rewritingHooks(urlOfRun: (run: number) => string): HookEvaluator {
      let runs = 0;
      return new HookEvaluator({
        set: HookSet.of([{
          source: { plugin: "fetch-guard", root: "/p", data: "/d", options: new Map() },
          groups: [create(HookGroupSchema, { event: "PreToolUse", matcher: "WebFetch", handlers: [create(HookHandlerSchema, { command: "guard" })] })],
        }]),
        views: new StigmerToolViews({ workspaceRoot: "/ws", toVirtualPath: () => undefined, serverNames: new Map(), platformServerSlugs: new Set() }),
        sessionId: "ses",
        workspaceRoot: "/ws",
        permissionMode: "default",
        baseEnv: {},
        homeDir: "/home",
        leases: new Set(),
        run: async () => ({
          exitCode: 0,
          stderr: "",
          timedOut: false,
          stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask", updatedInput: { url: urlOfRun(++runs) } } }),
        }),
      });
    }

    async function approveAcrossResume(hooks: HookEvaluator) {
      const fetched: string[] = [];
      const results: string[] = [];
      const webFetch = tool(
        async ({ url }) => {
          fetched.push(url);
          return `fetched ${url}`;
        },
        { name: "web_fetch", description: "fetch a url", schema: z.object({ url: z.string() }) },
      );
      const script: ScriptSelector = (toolNames) =>
        toolNames.includes("web_fetch")
          ? { toolCalls: [{ name: "web_fetch", args: { url: "https://example.com" }, id: "fetch_1" }], done: "worker done" }
          : { toolCalls: [{ name: "task", args: { description: "fetch it", subagent_type: "worker" }, id: "task_1" }], done: "parent done" };
      const worker = await createDeepAgent({
        model: new ScriptedModel(script),
        tools: [webFetch],
        middleware: [
          // Outside the gate, so it reads what the gate answers.
          {
            name: "ResultTap",
            wrapToolCall: async (request: unknown, handler: (r: unknown) => Promise<unknown>) => {
              const out = await handler(request);
              if (out instanceof ToolMessage) results.push(String(out.content));
              return out;
            },
          },
          createApprovalGateMiddleware({ mcpDefault: { destructive: new Set(), unlisted: new Set<string>(), leasedServers: new Set() }, mcpIndex: McpToolIndex.EMPTY, hooks }),
        ],
        backend: new StateBackend(),
        generalPurposeAgent: false,
      } as unknown as Parameters<typeof createDeepAgent>[0]);
      const parent = await createDeepAgent({
        model: new ScriptedModel(script),
        checkpointer: new MemorySaver() as never,
        backend: new StateBackend(),
        subagents: [{ name: "worker", description: "fetches", runnable: worker as never }],
      } as unknown as Parameters<typeof createDeepAgent>[0]);
      const config = { configurable: { thread_id: "thread-rewrite" }, recursionLimit: 50 };

      await parent.invoke({ messages: [new HumanMessage({ content: "go" })] }, config);
      const paused = await parent.getState(config);
      const [card] = readPendingInterrupts(paused as never);
      expect(card?.toolCallId).toBe("fetch_1");
      const resume = resolveResumeInput(new Map([["fetch_1", ApprovalAction.APPROVE]]), paused as unknown as GraphStateSnapshot);
      if (!resume.isResumeFromApproval) throw new Error("expected an approval resume");
      await parent.invoke(resume.graphInput, config);
      expect(readPendingInterrupts((await parent.getState(config)) as never)).toEqual([]);
      return { fetched, results };
    }

    it("runs a rewrite that resumes as its card showed it, once", async () => {
      const { fetched, results } = await approveAcrossResume(rewritingHooks(() => "https://example.com/safe"));
      expect(fetched).toEqual(["https://example.com/safe"]);
      expect(results).toEqual(["fetched https://example.com/safe"]);
    });

    it("refuses the approved call unrun when the rewrite changed on resume", async () => {
      const { fetched, results } = await approveAcrossResume(rewritingHooks((run) => `https://example.com/${run}`));
      expect(fetched).toEqual([]);
      expect(results).toEqual([CHANGED_MESSAGE]);
    });
  });
});
