/**
 * Runtime verification: does a SUB-AGENT approval interrupt propagate to the
 * PARENT checkpoint, and does Command(resume=…) route back into the nested
 * interrupt?
 *
 * This is the make-or-break question behind installing the approval gate on
 * sub-agent graphs (HITL Phase 2, Slice B). The resume path in `hitl.ts` /
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
 */

import { describe, it, expect } from "vitest";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Command, MemorySaver } from "@langchain/langgraph";
import { createDeepAgent, StateBackend } from "deepagents";
import { createApprovalGateMiddleware } from "../../../middleware/approval-gate.js";

// A deterministic two-role chat model. It detects whether it is driving the
// PARENT (the bound tools include `task`) or the WORKER (they don't), and walks
// a fixed script: parent → call `task` → (after task result) finish; worker →
// call the gated `overwrite_file` → (after the tool result) finish.
class ScriptedModel extends BaseChatModel {
  toolNames: string[] = [];

  _llmType(): string {
    return "scripted";
  }

  bindTools(tools: unknown[]): this {
    const next = new ScriptedModel({});
    next.toolNames = (tools as Array<{ name?: string }>).map((t) => t?.name ?? "");
    return next as unknown as this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    // createDeepAgent injects a `task` tool into BOTH agents, so role is keyed on
    // the worker's unique gated tool instead.
    const isWorker = this.toolNames.includes("overwrite_file");
    const last = messages[messages.length - 1];
    const lastIsToolResult = last instanceof ToolMessage;

    let message: AIMessage;
    if (isWorker) {
      message = lastIsToolResult
        ? new AIMessage({ content: "worker done" })
        : new AIMessage({
            content: "",
            tool_calls: [
              { name: "overwrite_file", args: { path: "/out.txt", content: "hello" }, id: "write_1", type: "tool_call" },
            ],
          });
    } else {
      message = lastIsToolResult
        ? new AIMessage({ content: "parent done" })
        : new AIMessage({
            content: "",
            tool_calls: [
              { name: "task", args: { description: "write the file", subagent_type: "worker" }, id: "task_1", type: "tool_call" },
            ],
          });
    }

    const text = typeof message.content === "string" ? message.content : "";
    return { generations: [{ message, text }] };
  }
}

interface PendingInterrupt {
  taskId: string;
  interruptId: string;
  toolCallId: string;
  toolName: string;
  message: string;
}

// Mirrors the extraction in hitl.ts / index.ts: read top-level parent tasks.
function readPendingInterrupts(state: {
  tasks?: ReadonlyArray<{ id: string; interrupts?: ReadonlyArray<{ id?: string; value?: unknown; resumeValue?: unknown }> }>;
}): PendingInterrupt[] {
  const out: PendingInterrupt[] = [];
  for (const task of state.tasks ?? []) {
    for (const intr of task.interrupts ?? []) {
      if (intr.resumeValue !== undefined) continue;
      const v = (intr.value ?? {}) as Record<string, unknown>;
      out.push({
        taskId: task.id,
        interruptId: (intr.id as string) ?? task.id,
        toolCallId: (v.tool_call_id as string) ?? "",
        toolName: (v.tool_name as string) ?? "",
        message: (v.message as string) ?? "",
      });
    }
  }
  return out;
}

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
      model: new ScriptedModel({}),
      tools: [overwriteFile],
      middleware: [
        createApprovalGateMiddleware({ policies: new Map(), autoApproveAll: false, toolServerMap: new Map() }),
      ],
      backend: new StateBackend(),
      generalPurposeAgent: false,
    } as unknown as Parameters<typeof createDeepAgent>[0]);

    const checkpointer = new MemorySaver();
    const parent = await createDeepAgent({
      model: new ScriptedModel({}),
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
      model: new ScriptedModel({}),
      checkpointer: checkpointer as never,
      backend: new StateBackend(),
      tools: [overwriteFile],
      middleware: [
        createApprovalGateMiddleware({ policies: new Map(), autoApproveAll: false, toolServerMap: new Map() }),
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
});
