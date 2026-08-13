/**
 * Scripted deep-agent test harness: a deterministic chat model plus the
 * parent-checkpoint interrupt reader.
 *
 * These two helpers are what every "drive a real deepagents/LangGraph graph
 * through the approval gate" test needs, and they were previously copy-pasted
 * inline. They are shared by:
 * - `__tests__/subagent-approval-propagation.test.ts` (sub-agent interrupt
 *   propagation against the real runtime), and
 * - `__test-utils__/gateway-substrate.ts` (the deep-agent adapter for the
 *   gateway Contract Test Kit).
 *
 * Keeping one copy means a change to how the runner reads pending interrupts (or
 * how a scripted run is driven) updates every consumer at once.
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

/** A single tool call the scripted model proposes on a non-terminal turn. */
export interface ScriptedToolCall {
  name: string;
  args: Record<string, unknown>;
  id: string;
}

/**
 * What the scripted model does for a given role: propose `toolCalls` while no
 * tool result is pending, then emit the `done` text once a tool result returns.
 */
export interface ScriptStep {
  toolCalls: ScriptedToolCall[];
  done: string;
}

/**
 * Picks the {@link ScriptStep} for the currently-bound tool set. A single-agent
 * test ignores the argument; a parent/sub-agent test keys the role on a tool
 * unique to one role (e.g. the sub-agent's gated tool), because `createDeepAgent`
 * injects the `task` tool into both the parent and its sub-agents.
 */
export type ScriptSelector = (boundToolNames: string[]) => ScriptStep;

/**
 * A deterministic two-turn chat model: on the first turn it proposes the
 * selected role's tool calls; once a tool result comes back it returns the
 * role's terminating text. No LLM, no network — the role is keyed on the bound
 * tool names so the same model instance drives a parent and its sub-agents.
 */
export class ScriptedModel extends BaseChatModel {
  toolNames: string[] = [];
  /**
   * The tool objects from the most recent `bindTools` call, exactly as the
   * agent bound them (post-middleware). Lets tests assert on the bound
   * SCHEMAS — e.g. the tool-intent middleware's bind-time shell clone — not
   * just the names. The array is shared across the clones `bindTools`
   * returns, so the instance the test holds always sees the latest bind.
   */
  readonly boundTools: unknown[];
  private readonly select: ScriptSelector;

  constructor(select: ScriptSelector, boundTools: unknown[] = []) {
    super({});
    this.select = select;
    this.boundTools = boundTools;
  }

  _llmType(): string {
    return "scripted";
  }

  bindTools(tools: unknown[]): this {
    const next = new ScriptedModel(this.select, this.boundTools);
    next.toolNames = (tools as Array<{ name?: string }>).map((t) => t?.name ?? "");
    this.boundTools.length = 0;
    this.boundTools.push(...tools);
    return next as unknown as this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const step = this.select(this.toolNames);
    const lastIsToolResult = messages[messages.length - 1] instanceof ToolMessage;

    const message = lastIsToolResult
      ? new AIMessage({ content: step.done })
      : new AIMessage({
          content: "",
          tool_calls: step.toolCalls.map((tc) => ({ ...tc, type: "tool_call" as const })),
        });

    const text = typeof message.content === "string" ? message.content : "";
    return { generations: [{ message, text }] };
  }
}

/** A pending approval interrupt surfaced at the parent checkpoint. */
export interface PendingInterrupt {
  taskId: string;
  interruptId: string;
  toolCallId: string;
  toolName: string;
  message: string;
  /**
   * Authorization provenance the gate attached to the interrupt
   * (approval-gate.ts `policy_source`) — the PolicySource union string, or "" for
   * legacy. Lets the gateway contract assert every gated side effect is
   * provenance-tagged.
   */
  policySource: string;
}

/**
 * Read the pending approval interrupts from a graph state, exactly as the
 * production resume path does (`hitl.ts` / `index.ts`): scan the parent's
 * top-level `tasks[].interrupts`, skipping any already carrying a resume value.
 *
 * Crucially `interruptId` is the interrupt's OWN id (`interrupts[].id`), not the
 * owning `task.id` — for a nested sub-agent interrupt the two differ, and only
 * the interrupt id routes a `Command(resume=...)` value back into the nested
 * `interrupt()`.
 */
export function readPendingInterrupts(state: {
  tasks?: ReadonlyArray<{
    id: string;
    interrupts?: ReadonlyArray<{ id?: string; value?: unknown; resumeValue?: unknown }>;
  }>;
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
        policySource: (v.policy_source as string) ?? "",
      });
    }
  }
  return out;
}
