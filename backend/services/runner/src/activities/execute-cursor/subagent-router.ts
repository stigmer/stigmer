/**
 * Routes Cursor SDK events to the correct scope: parent agent or sub-agent.
 *
 * When the Cursor SDK's Task tool spawns a sub-agent, events from that
 * sub-agent carry a different `agent_id` than the parent. This router
 * uses `agent_id` to direct events to per-sub-agent MessageAccumulator
 * instances, populating SubAgentExecution.messages — the same data that
 * the native harness's SubAgentTracker produces via namespace routing.
 *
 * Lifecycle:
 * 1. Parent agent_id is captured from the first stream event
 * 2. Task tool_call "running" registers a pending sub-agent
 * 3. Events with unknown agent_id are correlated to the pending sub-agent
 * 4. Sub-agent events are routed to a per-sub-agent MessageAccumulator
 * 5. syncToProto() copies accumulated messages before each persist
 *
 * If the Cursor SDK does not stream sub-agent internal events (only
 * task tool_call lifecycle), this router gracefully produces empty
 * SubAgentExecution.messages — no different from today's behavior.
 */

import type { SDKMessage } from "@cursor/sdk";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageAccumulator } from "./message-translator.js";
import { TodoTracker } from "./todo-tracker.js";

interface SubAgentState {
  readonly subAgent: SubAgentExecution;
  readonly accumulator: MessageAccumulator;
  readonly todoTracker: TodoTracker;
}

export class CursorSubAgentRouter {
  private parentAgentId: string | undefined;
  private readonly pendingByCallId = new Map<string, SubAgentExecution>();
  private readonly activeByAgentId = new Map<string, SubAgentState>();
  private readonly agentIdToCallId = new Map<string, string>();
  private _isDirty = false;

  /**
   * Returns true if the event belongs to a registered sub-agent
   * (based on its `agent_id` differing from the parent's).
   */
  isSubAgentEvent(event: SDKMessage): boolean {
    if (!this.parentAgentId) {
      this.parentAgentId = event.agent_id;
      return false;
    }
    if (event.agent_id === this.parentAgentId) return false;
    return this.activeByAgentId.has(event.agent_id) ||
      this.pendingByCallId.size > 0;
  }

  /**
   * Register a sub-agent when a task tool_call starts.
   * The SubAgentExecution is created by MessageAccumulator.trackSubAgentExecution().
   */
  registerSubAgent(taskCallId: string, sub: SubAgentExecution): void {
    if (this.pendingByCallId.has(taskCallId)) return;
    this.pendingByCallId.set(taskCallId, sub);
  }

  /**
   * Route a sub-agent event to its dedicated accumulator.
   * On first event from a new agent_id, correlates with the oldest
   * pending registration (FIFO — matches task invocation order).
   */
  routeEvent(event: SDKMessage): void {
    let state = this.activeByAgentId.get(event.agent_id);

    if (!state) {
      state = this.correlateNewAgentId(event.agent_id);
      if (!state) return;
    }

    state.accumulator.processEvent(event);

    if (event.type === "tool_call") {
      state.todoTracker.processEvent(event);
    }

    this._isDirty = true;
  }

  /**
   * Finalize sub-agent accumulators when the task tool completes.
   */
  finalizeSubAgent(taskCallId: string): void {
    const agentId = this.agentIdToCallId.get(taskCallId);
    if (!agentId) return;

    const state = this.activeByAgentId.get(agentId);
    if (state) {
      state.accumulator.finalize();
    }
  }

  /**
   * Copy accumulated messages and todos to SubAgentExecution protos.
   * Called before each persistStatus and after stream finalize.
   */
  syncToProto(): void {
    for (const state of this.activeByAgentId.values()) {
      state.accumulator.finalize();
    }
    this._isDirty = false;
  }

  get isDirty(): boolean {
    return this._isDirty;
  }

  markPersisted(): void {
    this._isDirty = false;
    for (const state of this.activeByAgentId.values()) {
      state.todoTracker.markPersisted();
    }
  }

  /**
   * Whether any sub-agents have been registered.
   */
  hasSubAgents(): boolean {
    return this.activeByAgentId.size > 0 || this.pendingByCallId.size > 0;
  }

  private correlateNewAgentId(agentId: string): SubAgentState | undefined {
    if (this.pendingByCallId.size === 0) return undefined;

    const [callId, sub] = this.pendingByCallId.entries().next().value as [string, SubAgentExecution];
    this.pendingByCallId.delete(callId);

    const messages: AgentMessage[] = [];
    sub.messages = messages;

    const state: SubAgentState = {
      subAgent: sub,
      accumulator: new MessageAccumulator(messages),
      todoTracker: new TodoTracker(sub.todos),
    };

    this.activeByAgentId.set(agentId, state);
    this.agentIdToCallId.set(callId, agentId);

    return state;
  }
}
