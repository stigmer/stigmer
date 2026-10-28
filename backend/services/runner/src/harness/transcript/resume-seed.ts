/**
 * What a resumed invocation seeds from the session's log: the asks its
 * engine resumes onto, and nothing else of the transcript.
 *
 * A run is one turn, and its re-invocations (an approval resume, a pause
 * and resume, a transient retry) each build their own rows: the run's
 * status carries no rows, and what earlier invocations did is already in
 * the log. A resumed engine resumes onto only one thing the runtime must
 * hold as rows: the calls that asked and are not finished. Each engine
 * re-emits each under its own id and the builder flips the seeded row
 * (`transcript/builder.ts`). The runtime's own readers of a seeded row (the
 * answers' copy onto it, the settle of a denied call, provenance) read the
 * same rows.
 *
 * So the seed is, per thread (the root, or a sub-agent's), one message with
 * no text holding:
 *  - every asked call with no result in the log: an `agent.tool_use` or
 *    `agent.mcp_tool_use` whose `evaluated_permission` is `ask`, as a
 *    WAITING_APPROVAL row carrying what its `stigmer.permission.asked` says
 *    (the message, the preview, the rule and hook that asked); the answers
 *    and grants are
 *    copied on afterwards (`approval-answers.ts` `copyAnswersOntoRows`);
 *  - in the root, the `task` call of every sub-agent thread that holds such
 *    an ask, RUNNING, so the thread's end and the call's result are written
 *    when the resumed sub-agent finishes;
 * and one sub-agent row per such thread, IN_PROGRESS, named and briefed as
 * its `session.thread_created` and `agent.thread_message_sent` say.
 *
 * A seeded row's id is its tool use id's call part (`events/ids.ts`): the
 * provider's call id as written, or its hashed form for one the id rule
 * hashed, which derives the same tool use id again, so whatever the turn
 * writes for the row lands under the id the log already holds. The seeded
 * messages write nothing (they have no text) and their tool uses are in the
 * log already, so the emitter numbers the invocation's own messages on from
 * the log's highest index per scope (`events/emitter.ts`).
 *
 * The same read gives two more facts an earlier invocation wrote: the run's
 * newest root `agent.message` (the run's answer, when this invocation
 * writes none) and its `stigmer.memory.recalled` (the memory selection a
 * resumed turn replays rather than re-selects).
 *
 * Proven by `transcript/__tests__/resume-seed.test.ts` and both harnesses' hermetic
 * resume goldens. It lives with the builder because it creates rows: the
 * seed's rows are built here and enter the turn through `seed()`.
 */

import { create } from "@bufbuild/protobuf";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import { POLICY_SOURCE_WORDS } from "../events/emitter.js";
import type { TranscriptSeed } from "./state.js";
import { classifyTool } from "../../shared/tool-kind.js";
import {
  AgentMessageSchema,
  RecalledMemoriesReportSchema,
  SubAgentRunSchema,
  ToolCallSchema,
  type AgentMessage,
  type RecalledMemoriesReport,
  type SubAgentRun,
  type ToolCall,
} from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import {
  ApprovalPolicySource,
  MessageType,
  SubAgentStatus,
  ToolCallStatus,
} from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

/** The log types the seed reads. */
export const RESUME_SEED_EVENT_TYPES = [
  "agent.tool_use",
  "agent.mcp_tool_use",
  "agent.tool_result",
  "agent.mcp_tool_result",
  "stigmer.permission.asked",
  "session.thread_created",
  "agent.thread_message_sent",
  "agent.message",
  "stigmer.memory.recalled",
] as const;

/** What a resumed invocation takes from the log (the module header). */
export interface ResumeSeed {
  /** The asks the engine resumes onto, and the threads that hold them. */
  readonly rows: TranscriptSeed;
  /** The text of the run's newest root `agent.message`; `undefined` when the log holds none. */
  readonly answerText: string | undefined;
  /** The run's memory selection as `stigmer.memory.recalled` states it; `undefined` when it holds none. */
  readonly recalledMemoriesReport: RecalledMemoriesReport | undefined;
}

/** Nothing to seed: a fresh turn. */
export const NO_RESUME_SEED: ResumeSeed = {
  rows: { messages: [], subAgentRuns: [] },
  answerText: undefined,
  recalledMemoriesReport: undefined,
};

/** One tool use as the log holds it. */
interface LoggedUse {
  readonly id: string;
  readonly name: string;
  readonly input: ToolCall["args"];
  readonly mcpServerSlug: string;
  readonly permission: string;
  readonly threadId: string;
}

/** The policy source enum of a logged word; UNSPECIFIED for a word no source has. */
const POLICY_SOURCE_BY_WORD: ReadonlyMap<string, ApprovalPolicySource> = new Map(
  (Object.entries(POLICY_SOURCE_WORDS) as [string, string][])
    .filter(([, word]) => word !== "")
    .map(([value, word]) => [word, Number(value) as ApprovalPolicySource]),
);

/** A tool use id's call part: the row id that derives the same tool use id again (the module header). */
export function rowIdOf(runId: string, toolUseId: string): string {
  return toolUseId.startsWith(`${runId}.`) ? toolUseId.slice(runId.length + 1) : toolUseId;
}

/** The text of a content array, its text blocks joined. */
function textOf(content: readonly { readonly type: string; readonly text: string }[]): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** The seed of a resumed invocation from its run's events, oldest first (the module header). A pure map. */
export function resumeSeedOf(runId: string, events: readonly SessionEvent[]): ResumeSeed {
  const uses: LoggedUse[] = [];
  const usesById = new Map<string, LoggedUse>();
  const finished = new Set<string>();
  const asks = new Map<string, Extract<SessionEvent["event"], { case: "stigmerPermissionAsked" }>["value"]>();
  const threadNames = new Map<string, string>();
  const threadInputs = new Map<string, string>();
  let answerText: string | undefined;
  let recalledMemoriesReport: RecalledMemoriesReport | undefined;

  for (const event of events) {
    if (event.runId !== "" && event.runId !== runId) continue;
    switch (event.event.case) {
      case "agentToolUse":
      case "agentMcpToolUse": {
        const value = event.event.value;
        const use: LoggedUse = {
          id: value.id,
          name: value.name,
          input: value.input,
          mcpServerSlug: event.event.case === "agentMcpToolUse" ? event.event.value.mcpServerName : "",
          permission: value.evaluatedPermission,
          threadId: value.sessionThreadId,
        };
        if (!usesById.has(use.id)) {
          uses.push(use);
          usesById.set(use.id, use);
        }
        break;
      }
      case "agentToolResult":
        finished.add(event.event.value.toolUseId);
        break;
      case "agentMcpToolResult":
        finished.add(event.event.value.mcpToolUseId);
        break;
      case "stigmerPermissionAsked":
        if (!asks.has(event.event.value.toolUseId)) asks.set(event.event.value.toolUseId, event.event.value);
        break;
      case "sessionThreadCreated":
        threadNames.set(event.event.value.sessionThreadId, event.event.value.agentName);
        break;
      case "agentThreadMessageSent":
        threadInputs.set(event.event.value.toSessionThreadId, textOf(event.event.value.content));
        break;
      case "agentMessage":
        if (event.threadId === "") answerText = textOf(event.event.value.content);
        break;
      case "stigmerMemoryRecalled": {
        const { selectionActive, injectedMemoryIds, embeddingModel } = event.event.value;
        recalledMemoriesReport ??= create(RecalledMemoriesReportSchema, {
          selectionActive,
          injectedMemoryIds: [...injectedMemoryIds],
          embeddingModel,
        });
        break;
      }
      default:
        break;
    }
  }

  const openAsks = uses.filter((use) => use.permission === "ask" && !finished.has(use.id));
  const rootCalls: ToolCall[] = [];
  const subAgentRuns: SubAgentRun[] = [];
  const threadRows = new Map<string, ToolCall[]>();
  for (const use of openAsks) {
    if (use.threadId === "") {
      rootCalls.push(askedRow(runId, use, asks.get(use.id)));
      continue;
    }
    let calls = threadRows.get(use.threadId);
    if (calls === undefined) {
      calls = [];
      threadRows.set(use.threadId, calls);
    }
    calls.push(askedRow(runId, use, asks.get(use.id)));
  }
  for (const [thread, calls] of threadRows) {
    const subAgentId = rowIdOf(runId, thread);
    // The thread's id is its `task` call's tool use id (`events/ids.ts`).
    const task = usesById.get(thread);
    if (task !== undefined && !finished.has(task.id)) rootCalls.push(runningRow(runId, task));
    subAgentRuns.push(
      create(SubAgentRunSchema, {
        id: subAgentId,
        name: threadNames.get(thread) ?? task?.name ?? "",
        input: threadInputs.get(thread) ?? "",
        status: SubAgentStatus.SUB_AGENT_IN_PROGRESS,
        messages: [holder(calls)],
      }),
    );
  }
  // The root's rows in log order: a thread's `task` call opened before the ask it holds.
  const order = new Map(uses.map((use, index) => [rowIdOf(runId, use.id), index]));
  rootCalls.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return {
    rows: { messages: rootCalls.length === 0 ? [] : [holder(rootCalls)], subAgentRuns },
    answerText,
    recalledMemoriesReport,
  };
}

/** A message with no text holding seeded rows: it writes nothing to the log. */
function holder(calls: ToolCall[]): AgentMessage {
  return create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content: "", toolCalls: calls });
}

/** An asked call still waiting, as its tool use and its ask state it. */
function askedRow(
  runId: string,
  use: LoggedUse,
  ask: { readonly message: string; readonly argsPreview: string; readonly policySource: string; readonly policyHook: string; readonly processedAt: string } | undefined,
): ToolCall {
  const row = create(ToolCallSchema, {
    id: rowIdOf(runId, use.id),
    name: use.name,
    status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    requiresApproval: true,
    mcpServerSlug: use.mcpServerSlug,
  });
  if (use.input !== undefined) row.args = use.input;
  row.toolKind = classifyTool(row.name, row.mcpServerSlug);
  if (ask !== undefined) {
    row.approvalMessage = ask.message;
    row.argsPreview = ask.argsPreview;
    row.approvalPolicySource = POLICY_SOURCE_BY_WORD.get(ask.policySource) ?? ApprovalPolicySource.UNSPECIFIED;
    row.approvalPolicyHook = ask.policyHook;
    row.approvalRequestedAt = ask.processedAt;
  }
  return row;
}

/** A sub-agent's `task` call, still running while its thread waits on an ask. */
function runningRow(runId: string, use: LoggedUse): ToolCall {
  const row = create(ToolCallSchema, {
    id: rowIdOf(runId, use.id),
    name: use.name,
    status: ToolCallStatus.TOOL_CALL_RUNNING,
    mcpServerSlug: use.mcpServerSlug,
  });
  if (use.input !== undefined) row.args = use.input;
  row.toolKind = classifyTool(row.name, row.mcpServerSlug);
  return row;
}

