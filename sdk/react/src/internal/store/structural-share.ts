import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

/**
 * Compares two `AgentExecution` snapshots and returns a hybrid object
 * that reuses old references for unchanged subtrees.
 *
 * The runner appends new messages and mutates the streaming tail.
 * Messages at stable indices with unchanged content keep the previous
 * reference so downstream `React.memo` can skip re-renders.
 *
 * When `prev` is `null` (first snapshot), returns `next` unchanged.
 */
export function structuralShare(
  prev: AgentExecution | null,
  next: AgentExecution,
): AgentExecution {
  if (prev === null) return next;

  const prevStatus = prev.status;
  const nextStatus = next.status;

  if (!prevStatus || !nextStatus) return next;

  const sharedMessages = shareMessages(
    prevStatus.messages,
    nextStatus.messages,
  );
  const sharedSubAgents = shareSubAgents(
    prevStatus.subAgentExecutions,
    nextStatus.subAgentExecutions,
  );
  const sharedApprovals = shareApprovals(
    prevStatus.pendingApprovals,
    nextStatus.pendingApprovals,
  );
  const sharedTodos = shareTodos(prevStatus.todos, nextStatus.todos);

  const messagesUnchanged = sharedMessages === prevStatus.messages;
  const subAgentsUnchanged = sharedSubAgents === prevStatus.subAgentExecutions;
  const approvalsUnchanged = sharedApprovals === prevStatus.pendingApprovals;
  const todosUnchanged = sharedTodos === prevStatus.todos;

  const statusFieldsUnchanged =
    prevStatus.phase === nextStatus.phase &&
    prevStatus.error === nextStatus.error &&
    prevStatus.startedAt === nextStatus.startedAt &&
    prevStatus.completedAt === nextStatus.completedAt &&
    prevStatus.runnerId === nextStatus.runnerId;

  if (
    messagesUnchanged &&
    subAgentsUnchanged &&
    approvalsUnchanged &&
    todosUnchanged &&
    statusFieldsUnchanged &&
    prevStatus.artifacts.length === nextStatus.artifacts.length &&
    prevStatus.workspaceWriteBacks.length ===
      nextStatus.workspaceWriteBacks.length
  ) {
    return prev;
  }

  const sharedStatus = Object.create(Object.getPrototypeOf(nextStatus));
  Object.assign(sharedStatus, nextStatus);
  sharedStatus.messages = sharedMessages;
  sharedStatus.subAgentExecutions = sharedSubAgents;
  sharedStatus.pendingApprovals = sharedApprovals;
  sharedStatus.todos = sharedTodos;

  const sharedExec = Object.create(Object.getPrototypeOf(next));
  Object.assign(sharedExec, next);
  sharedExec.status = sharedStatus;

  return sharedExec;
}

// ---------------------------------------------------------------------------
// Messages — compare by index (append-only slots)
// ---------------------------------------------------------------------------

function shareMessages(
  prev: readonly AgentMessage[],
  next: readonly AgentMessage[],
): readonly AgentMessage[] {
  if (prev.length === 0 && next.length === 0) return prev;
  if (prev.length === 0) return next;

  let allSame = prev.length === next.length;
  const result: AgentMessage[] = new Array(next.length);

  for (let i = 0; i < next.length; i++) {
    if (i < prev.length && messageEqual(prev[i], next[i])) {
      result[i] = prev[i];
    } else {
      result[i] = shareToolCalls(
        i < prev.length ? prev[i] : null,
        next[i],
      );
      allSame = false;
    }
  }

  return allSame ? prev : result;
}

function messageEqual(a: AgentMessage, b: AgentMessage): boolean {
  return (
    a.type === b.type &&
    a.content === b.content &&
    a.isStreaming === b.isStreaming &&
    a.timestamp === b.timestamp &&
    a.toolCalls.length === b.toolCalls.length &&
    toolCallsEqual(a.toolCalls, b.toolCalls)
  );
}

function toolCallsEqual(
  a: readonly ToolCall[],
  b: readonly ToolCall[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!toolCallEqual(a[i], b[i])) return false;
  }
  return true;
}

/**
 * When the message itself has changed, try to preserve unchanged
 * tool call references within it. Returns a new message with the
 * tool calls array potentially reusing old references.
 */
function shareToolCalls(
  prev: AgentMessage | null,
  next: AgentMessage,
): AgentMessage {
  if (!prev || prev.toolCalls.length === 0 || next.toolCalls.length === 0) {
    return next;
  }

  const prevById = new Map<string, ToolCall>();
  for (const tc of prev.toolCalls) {
    if (tc.id) prevById.set(tc.id, tc);
  }

  if (prevById.size === 0) return next;

  let allSame = prev.toolCalls.length === next.toolCalls.length;
  const shared: ToolCall[] = new Array(next.toolCalls.length);

  for (let i = 0; i < next.toolCalls.length; i++) {
    const ntc = next.toolCalls[i];
    const ptc = ntc.id ? prevById.get(ntc.id) : undefined;

    if (ptc && toolCallEqual(ptc, ntc)) {
      shared[i] = ptc;
    } else {
      shared[i] = ntc;
      allSame = false;
    }
  }

  if (allSame) return next;

  const sharedMsg = Object.create(Object.getPrototypeOf(next));
  Object.assign(sharedMsg, next);
  sharedMsg.toolCalls = shared;
  return sharedMsg;
}

function toolCallEqual(a: ToolCall, b: ToolCall): boolean {
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.isStreaming === b.isStreaming &&
    a.result === b.result &&
    a.completedAt === b.completedAt &&
    a.error === b.error &&
    a.name === b.name &&
    a.argsPreview === b.argsPreview
  );
}

// ---------------------------------------------------------------------------
// Sub-agent executions — compare by `id`
// ---------------------------------------------------------------------------

function shareSubAgents(
  prev: readonly SubAgentExecution[],
  next: readonly SubAgentExecution[],
): readonly SubAgentExecution[] {
  if (prev.length === 0 && next.length === 0) return prev;
  if (prev.length === 0) return next;

  const prevById = new Map<string, SubAgentExecution>();
  for (const sa of prev) {
    if (sa.id) prevById.set(sa.id, sa);
  }

  let allSame = prev.length === next.length;
  const result: SubAgentExecution[] = new Array(next.length);

  for (let i = 0; i < next.length; i++) {
    const nsa = next[i];
    const psa = nsa.id ? prevById.get(nsa.id) : undefined;

    if (psa && subAgentEqual(psa, nsa)) {
      result[i] = psa;
    } else if (psa) {
      result[i] = shareSubAgentMessages(psa, nsa);
      allSame = false;
    } else {
      result[i] = nsa;
      allSame = false;
    }
  }

  return allSame ? prev : result;
}

function subAgentEqual(a: SubAgentExecution, b: SubAgentExecution): boolean {
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.output === b.output &&
    a.error === b.error &&
    a.completedAt === b.completedAt &&
    a.messages.length === b.messages.length &&
    a.subject === b.subject &&
    subAgentMessagesEqual(a.messages, b.messages)
  );
}

function subAgentMessagesEqual(
  a: readonly AgentMessage[],
  b: readonly AgentMessage[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!messageEqual(a[i], b[i])) return false;
  }
  return true;
}

function shareSubAgentMessages(
  prev: SubAgentExecution,
  next: SubAgentExecution,
): SubAgentExecution {
  const sharedMsgs = shareMessages(prev.messages, next.messages);
  if (sharedMsgs === prev.messages && subAgentEqual(prev, next)) {
    return prev;
  }

  const shared = Object.create(Object.getPrototypeOf(next));
  Object.assign(shared, next);
  shared.messages = sharedMsgs;
  return shared;
}

// ---------------------------------------------------------------------------
// Pending approvals — compare by `toolCallId`
// ---------------------------------------------------------------------------

function shareApprovals(
  prev: readonly PendingApproval[],
  next: readonly PendingApproval[],
): readonly PendingApproval[] {
  if (prev.length === 0 && next.length === 0) return prev;
  if (prev.length !== next.length) return next;

  const prevById = new Map<string, PendingApproval>();
  for (const a of prev) {
    prevById.set(a.toolCallId, a);
  }

  for (const na of next) {
    const pa = prevById.get(na.toolCallId);
    if (!pa || !approvalEqual(pa, na)) return next;
  }

  return prev;
}

function approvalEqual(a: PendingApproval, b: PendingApproval): boolean {
  return (
    a.toolCallId === b.toolCallId &&
    a.toolName === b.toolName &&
    a.message === b.message &&
    a.argsPreview === b.argsPreview &&
    a.requestedAt === b.requestedAt &&
    a.fromSubAgent === b.fromSubAgent
  );
}

// ---------------------------------------------------------------------------
// Todos — compare by map key
// ---------------------------------------------------------------------------

function shareTodos(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);

  if (prevKeys.length === 0 && nextKeys.length === 0) return prev;
  if (prevKeys.length !== nextKeys.length) return next;

  for (const key of nextKeys) {
    if (!(key in prev) || prev[key] !== next[key]) return next;
  }

  return prev;
}
