/**
 * A Cursor sub-agent's transcript, from the `task` tool's completed result to
 * the canonical events that fold it (`harness/transcript/events.ts`), scoped
 * to the sub-agent's own `subAgentId`.
 *
 * WHY THE TRANSCRIPT ARRIVES AS A BLOB. The Cursor SDK returns sub-agent work
 * inside the `task` tool's completed event, not as streaming events with a
 * distinct agent id. Re-verified 2026-08-23 on the pinned SDK (1.0.13) AND the
 * latest (1.0.28), including the write side (stigmer/stigmer#839): an injected
 * platform.eventStore/eventNotifier receives parent events only on 1.0.13 and
 * is bypassed entirely on 1.0.28 (persistence moved into the executor daemon's
 * own state dir); zero events reach the parent's run.stream() mid-task; the
 * agentId in the task args is not a platform-store agent id at all, so it can
 * never be addressable via Agent.listRuns / Agent.getRun (this is WHY the
 * 2026-07-02 read-side polls all returned not-found). On 1.0.28 the child
 * transcript lands at a deterministic path knowable at spawn
 * (~/.cursor/projects/<slug>/agent-transcripts/<parentId>/subagents/<argsAgentId>.jsonl)
 * but is flushed only at completion — verified with 200ms sampling across a
 * full sub-agent run. Live nested visibility is therefore still an upstream
 * SDK limitation — do not try to fake it here; the UI shows an elapsed-time
 * affordance instead (SubAgentSection). Probe scripts and recordings:
 * stigmer-cloud _projects/2026-08/20260823.03.cursor-subagent-live-progress.
 * This is Cursor's timing — the sub-agent's rows exist only at completion —
 * and it stays Cursor's (Q-S4-4).
 *
 * THE SHAPE. The result is `{ status: "success", value: { conversationSteps } }`
 * (or a bare `{ conversationSteps }`), where each ConversationStep is a
 * protobuf-oneof object keyed DIRECTLY by its kind — there is NO
 * `{ type, message }` envelope in production blobs, though the legacy `type`
 * form is still read:
 *   - { thinkingMessage: { text, thinkingDurationMs? } }
 *   - { assistantMessage: { text } }
 *   - { toolCall: { toolCallId, <kind>ToolCall: { args, result } } }
 * The tool family is the lone `<kind>ToolCall` sibling of `toolCallId`
 * (`readToolCall`, `globToolCall`, `grepToolCall`, `shellToolCall`, …); the bare
 * tool name is the suffix-stripped key, which feeds the shared `classifyTool`
 * exactly like a top-level call. `result` is itself a oneof
 * `{ success | error | permissionDenied | rejected }`. This is deliberately
 * key-driven rather than an enumerated switch, so a new tool family the SDK
 * adds surfaces automatically instead of being dropped. History: an earlier
 * revision parsed a `{ type: "toolCall", message: { type, args, result } }`
 * envelope that never appears in the real blob, so every sub-agent tool call
 * was silently discarded and the UI showed a sub-agent that "did nothing".
 *
 * WHAT THIS MODULE EMITS, AND WHY EVENTS. Until S4 M4 this parser built
 * `AgentMessage` protos itself (the conversation-steps extractor in the accumulator)
 * — a third copy of the folding rule, whose message boundary drifted from the
 * root's until A5. Now each step becomes the events any harness's translator
 * would emit for the same thing, and the shared `TranscriptBuilder` folds them
 * with the root's own rules: an `assistantMessage` step is its own message
 * (`runId` `<subAgentId>:step:<i>`, so two consecutive steps never merge); a
 * `thinkingMessage` step a THINKING row under the same key; a `toolCall` step
 * a `tool_started` then a `tool_finished`/`tool_error`, which the builder
 * attaches to the transcript's current AI message (the assistant step that
 * proposed it) or an empty one when there is none (Q-S4-5). Unknown step
 * kinds and empty texts are skipped for forward compatibility. The rows carry
 * no attribution or provenance (S4 review finding 11; S5's).
 *
 * The `task` row's own `tool_finished` and the sub-agent's `sub_agent_finished`
 * are the translator's (`translator.ts`); this module answers only "what
 * happened inside".
 */

import type { TranscriptEvent } from "../../harness/transcript/events.js";
import { canonicalizeImageResult } from "./tool-result.js";

/**
 * The failure branches of a sub-agent tool call's `result` oneof. A completion
 * is `{ success: ... }`; every other branch is a non-completion the UI must show
 * as failed — an errored read/glob/grep (`error`), or a shell the approval gate
 * stopped (`permissionDenied` / `rejected`).
 */
const SUBAGENT_TOOL_RESULT_FAILURE_KEYS: ReadonlySet<string> = new Set([
  "error",
  "permissionDenied",
  "rejected",
]);

/** The canonical events for one sub-agent's completed `conversationSteps`, all scoped to `subAgentId`. */
export function subAgentStepEvents(result: unknown, subAgentId: string): TranscriptEvent[] {
  const steps = conversationStepsOf(result);
  const out: TranscriptEvent[] = [];
  for (const [index, step] of steps.entries()) {
    if (step == null || typeof step !== "object") continue;
    const s = step as Record<string, unknown>;
    const type = s.type as string | undefined;
    const runId = `${subAgentId}:step:${index}`;

    if (type === "thinkingMessage" || s.thinkingMessage != null) {
      const text = stepText(type === "thinkingMessage" ? s.message : s.thinkingMessage);
      if (text) {
        out.push({ kind: "message_start", runId, subAgentId });
        out.push({ kind: "reasoning_delta", runId, text, subAgentId });
        out.push({ kind: "message_finish", runId, subAgentId });
      }
    } else if (type === "assistantMessage" || s.assistantMessage != null) {
      const text = stepText(type === "assistantMessage" ? s.message : s.assistantMessage);
      if (text) {
        out.push({ kind: "message_start", runId, subAgentId });
        out.push({ kind: "text_delta", runId, text, subAgentId });
        out.push({ kind: "message_finish", runId, subAgentId });
      }
    } else if (s.toolCall != null) {
      out.push(...subAgentToolCallEvents(s.toolCall, index, subAgentId));
    }
  }
  return out;
}

/** The `conversationSteps` array from the task result's envelope, or none. */
function conversationStepsOf(result: unknown): unknown[] {
  if (result == null || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  const value = r.value ?? r;
  if (value == null || typeof value !== "object") return [];
  const steps = (value as Record<string, unknown>).conversationSteps;
  return Array.isArray(steps) ? steps : [];
}

function stepText(message: unknown): string {
  if (message == null || typeof message !== "object") return "";
  const text = (message as Record<string, unknown>).text;
  return typeof text === "string" ? text : "";
}

/**
 * One `toolCall` step as a started row and its outcome. The SDK's real call id
 * keeps the row stable across resumes and distinct from its siblings; a
 * synthetic `sub-<name>-<stepIndex>` stands in only when the SDK omits one.
 * A step with no `<kind>ToolCall` key (malformed or forward-incompatible) emits
 * nothing rather than a blank, nameless row.
 */
function subAgentToolCallEvents(toolCall: unknown, stepIndex: number, subAgentId: string): TranscriptEvent[] {
  if (toolCall == null || typeof toolCall !== "object") return [];
  const obj = toolCall as Record<string, unknown>;

  const kindKey = Object.keys(obj).find((k) => k !== "toolCallId" && k.endsWith("ToolCall"));
  if (!kindKey) return [];

  const name = kindKey.slice(0, -"ToolCall".length);
  const inner = obj[kindKey] != null && typeof obj[kindKey] === "object"
    ? (obj[kindKey] as Record<string, unknown>)
    : {};
  const callId = typeof obj.toolCallId === "string" && obj.toolCallId
    ? obj.toolCallId
    : `sub-${name}-${stepIndex}`;
  const input = inner.args != null && typeof inner.args === "object"
    ? (inner.args as Record<string, unknown>)
    : {};

  const outcome = interpretSubAgentToolResult(inner.result);
  return [
    { kind: "tool_started", callId, name, input, mcpServerSlug: "", subAgentId },
    outcome.status === "completed"
      ? { kind: "tool_finished", callId, result: outcome.result, subAgentId }
      : { kind: "tool_error", callId, message: outcome.error, subAgentId },
  ];
}

/**
 * A sub-agent tool call's `result` oneof as an outcome: `success` → completed
 * with the serialized payload (a screenshot is canonicalized the same way as a
 * top-level result); any failure branch → failed with the serialized detail
 * (`error` alone — never a duplicate in `result`, Q-M4-3). An absent result is
 * a completed call with no output — the SDK omits `result` for a call that
 * reports nothing; an unknown oneof branch is surfaced as a completed result
 * rather than dropped.
 */
export function interpretSubAgentToolResult(result: unknown):
  | { status: "completed"; result: string }
  | { status: "failed"; error: string } {
  if (result == null || typeof result !== "object") {
    return { status: "completed", result: "" };
  }
  const r = result as Record<string, unknown>;

  if ("success" in r) {
    const val = r.success;
    const str = canonicalizeImageResult(val) ?? (typeof val === "string" ? val : JSON.stringify(val));
    return { status: "completed", result: str };
  }

  const failKey = Object.keys(r).find((k) => SUBAGENT_TOOL_RESULT_FAILURE_KEYS.has(k));
  if (failKey) {
    const val = r[failKey];
    return { status: "failed", error: typeof val === "string" ? val : JSON.stringify(val) };
  }

  return { status: "completed", result: JSON.stringify(r) };
}
