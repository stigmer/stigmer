/**
 * V3 protocol event factories for the translator's and the builder's arms.
 *
 * Shapes are derived from real recordings in /tmp/stigmer-v3-provider/
 * captured during Phase 1 validation with Claude claude-sonnet-4-6.
 *
 * Namespaces default to LangGraph 1.3.2's REAL shape (S4 M2 C4, plan finding
 * F-M2-16): a model event arrives under `["model_request:<uuid>"]` and a tool
 * event under `["tools:<uuid>"]` — one segment each, a fresh uuid per LLM
 * call / tool run. Until C4 the model factories defaulted to `[]`, so the
 * arms never saw the namespace miss the hermetic goldens showed (S3 M0
 * finding F-M0-1: the root builder filed text under the raw namespace and
 * looked a tool's parent up under `""`). A sub-agent's events pass their own
 * `namespace` (`["tools:<taskUuid>", "model_request:<inner>"]`).
 */

import type { V3ProtocolEvent } from "../v3-event-recorder.js";

/** The namespace a root model event carries: the model node's segment, per LLM call. */
function modelNamespace(runId: string): string[] {
  return [`model_request:${runId}`];
}

let seqCounter = 0;
export function resetSeq(): void { seqCounter = 0; }
function nextSeq(): number { return seqCounter++; }

// ── Core Factory ──────────────────────────────────────────────────

export function makeProtocolEvent(
  method: string,
  data: unknown,
  opts?: {
    seq?: number;
    namespace?: string[];
    node?: string;
    timestamp?: number;
  },
): V3ProtocolEvent {
  return {
    type: "event",
    seq: opts?.seq ?? nextSeq(),
    method,
    params: {
      namespace: opts?.namespace ?? [],
      timestamp: opts?.timestamp ?? Date.now(),
      node: opts?.node,
      data,
    },
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────

export function makeLifecycleRunning(graphName = "root"): V3ProtocolEvent {
  return makeProtocolEvent("lifecycle", { event: "running", graph_name: graphName });
}

export function makeLifecycleStarted(graphName: string, ns?: string[]): V3ProtocolEvent {
  return makeProtocolEvent("lifecycle", { event: "started", graph_name: graphName }, { namespace: ns });
}

export function makeLifecycleCompleted(graphName: string, ns?: string[]): V3ProtocolEvent {
  return makeProtocolEvent("lifecycle", { event: "completed", graph_name: graphName }, { namespace: ns });
}

// ── Messages: message-start / message-finish ──────────────────────

export function makeMessageStart(
  runId: string,
  opts?: { messageId?: string; namespace?: string[]; node?: string; usage?: Record<string, unknown> },
): V3ProtocolEvent {
  return makeProtocolEvent("messages", {
    event: "message-start",
    id: opts?.messageId ?? `msg_${runId}`,
    usage: opts?.usage,
    run_id: runId,
  }, { namespace: opts?.namespace ?? modelNamespace(runId), node: opts?.node ?? "model_request" });
}

export function makeMessageFinish(
  runId: string,
  opts?: {
    reason?: string;
    usage?: Record<string, unknown>;
    namespace?: string[];
    node?: string;
    metadata?: Record<string, unknown>;
  },
): V3ProtocolEvent {
  return makeProtocolEvent("messages", {
    event: "message-finish",
    reason: opts?.reason ?? "end_turn",
    usage: opts?.usage,
    metadata: opts?.metadata,
    responseMetadata: opts?.metadata,
    run_id: runId,
  }, { namespace: opts?.namespace ?? modelNamespace(runId), node: opts?.node ?? "model_request" });
}

// ── Messages: content-block-start/delta/finish ────────────────────

export function makeContentBlockStartText(
  runId: string,
  index = 0,
  opts?: { namespace?: string[] },
): V3ProtocolEvent {
  return makeProtocolEvent("messages", {
    event: "content-block-start",
    index,
    content: { type: "text", text: "" },
    run_id: runId,
  }, { namespace: opts?.namespace ?? modelNamespace(runId), node: "model_request" });
}

export function makeTextDelta(
  runId: string,
  text: string,
  opts?: { index?: number; namespace?: string[] },
): V3ProtocolEvent {
  return makeProtocolEvent("messages", {
    event: "content-block-delta",
    index: opts?.index ?? 0,
    delta: { type: "text-delta", text },
    run_id: runId,
  }, { namespace: opts?.namespace ?? modelNamespace(runId), node: "model_request" });
}

export function makeReasoningDelta(
  runId: string,
  text: string,
  opts?: { index?: number; namespace?: string[] },
): V3ProtocolEvent {
  return makeProtocolEvent("messages", {
    event: "content-block-delta",
    index: opts?.index ?? 0,
    delta: { type: "reasoning-delta", reasoning: text },
    run_id: runId,
  }, { namespace: opts?.namespace ?? modelNamespace(runId), node: "model_request" });
}

export function makeToolCallArgDelta(
  runId: string,
  callId: string,
  args: string,
  opts?: { index?: number; namespace?: string[] },
): V3ProtocolEvent {
  return makeProtocolEvent("messages", {
    event: "content-block-delta",
    index: opts?.index ?? 0,
    delta: {
      type: "block-delta",
      fields: { type: "tool_call_chunk", id: callId, args },
    },
    run_id: runId,
  }, { namespace: opts?.namespace ?? modelNamespace(runId), node: "model_request" });
}

export function makeContentBlockFinish(
  runId: string,
  index = 0,
  opts?: { content?: unknown; namespace?: string[] },
): V3ProtocolEvent {
  return makeProtocolEvent("messages", {
    event: "content-block-finish",
    index,
    content: opts?.content ?? { type: "text", text: "" },
    run_id: runId,
  }, { namespace: opts?.namespace ?? modelNamespace(runId), node: "model_request" });
}

// ── Messages: usage / provider ────────────────────────────────────

export function makeUsageEvent(
  runId: string,
  usage: Record<string, unknown>,
  opts?: { namespace?: string[] },
): V3ProtocolEvent {
  return makeProtocolEvent("messages", {
    event: "usage",
    usage,
    run_id: runId,
  }, { namespace: opts?.namespace ?? modelNamespace(runId), node: "model_request" });
}

export function makeProviderEvent(
  runId: string,
  provider: string,
  model: string,
  opts?: { namespace?: string[] },
): V3ProtocolEvent {
  return makeProtocolEvent("messages", {
    event: "provider",
    provider,
    name: "message_start",
    payload: { model, id: `msg_${runId}` },
    run_id: runId,
  }, { namespace: opts?.namespace ?? modelNamespace(runId), node: "model_request" });
}

// ── Tools ─────────────────────────────────────────────────────────

export function makeToolStarted(
  callId: string,
  toolName: string,
  input: unknown = "{}",
  opts?: { namespace?: string[] },
): V3ProtocolEvent {
  return makeProtocolEvent("tools", {
    event: "tool-started",
    tool_call_id: callId,
    tool_name: toolName,
    input,
  }, { namespace: opts?.namespace ?? [`tools:${callId}`] });
}

export function makeToolFinished(
  callId: string,
  output: unknown = "ok",
  opts?: { namespace?: string[] },
): V3ProtocolEvent {
  const wrappedOutput = typeof output === "string"
    ? {
        lc: 1, type: "constructor",
        id: ["langchain_core", "messages", "ToolMessage"],
        kwargs: { status: "success", content: output, tool_call_id: callId, name: "tool" },
      }
    : output;

  return makeProtocolEvent("tools", {
    event: "tool-finished",
    tool_call_id: callId,
    output: wrappedOutput,
  }, { namespace: opts?.namespace ?? [`tools:${callId}`] });
}

export function makeToolError(
  callId: string,
  message: string,
  opts?: { namespace?: string[] },
): V3ProtocolEvent {
  return makeProtocolEvent("tools", {
    event: "tool-error",
    tool_call_id: callId,
    message,
  }, { namespace: opts?.namespace ?? [`tools:${callId}`] });
}

export function makeToolOutputDelta(
  callId: string,
  delta: string,
  opts?: { namespace?: string[] },
): V3ProtocolEvent {
  return makeProtocolEvent("tools", {
    event: "tool-output-delta",
    tool_call_id: callId,
    delta,
  }, { namespace: opts?.namespace ?? [`tools:${callId}`] });
}

// ── Ignored channels (for normalizer completeness tests) ──────────

export function makeCheckpointEvent(): V3ProtocolEvent {
  return makeProtocolEvent("checkpoints", {
    id: "ckpt_001",
    parent_id: "ckpt_000",
    step: 1,
    source: "loop",
  });
}

export function makeTasksEvent(): V3ProtocolEvent {
  return makeProtocolEvent("tasks", {
    id: "task_001",
    name: "model_request",
    input: {},
    triggers: [],
    interrupts: [],
  });
}

export function makeValuesEvent(): V3ProtocolEvent {
  return makeProtocolEvent("values", {
    messages: [],
    todos: [],
    files: {},
  });
}

export function makeUpdatesEvent(node = "model_request"): V3ProtocolEvent {
  return makeProtocolEvent("updates", {
    node,
    values: {},
  }, { node });
}
