import React, { useMemo } from "react";
import { Box, Text, Static } from "ink";
import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type {
  AgentMessage,
  ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  ApprovalAction,
  ExecutionPhase,
  FileChangeSetStatus,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  isTerminalPhase,
  FileReviewContext,
  type FileReviewContextValue,
} from "@stigmer/react";
import { displayFileChangeSets } from "@stigmer/sdk";
import { MessageEntry } from "./MessageEntry.js";
import { ToolCallGroup } from "./ToolCallGroup.js";
import { SubAgentBlock } from "./SubAgentBlock.js";
import { ExecutionProgress } from "./ExecutionProgress.js";
import { ApprovalPrompt } from "./ApprovalPrompt.js";
import { FileReviewRecord } from "./FileReviewRecord.js";

/** Props for {@link MessageThread}. */
export interface MessageThreadProps {
  /** Completed executions in chronological order. */
  readonly executions: readonly AgentExecution[];
  /** The currently streaming execution (appended after `executions`). */
  readonly activeStreamExecution?: AgentExecution | null;
  /** Optimistic user message shown before the stream delivers it. */
  readonly pendingUserMessage?: string | null;
  /** Callback for approval actions. Shows approval UI when provided. */
  readonly onApprovalSubmit?: (
    toolCallId: string,
    action: ApprovalAction,
  ) => void;
  /** Set of tool call IDs currently being submitted for approval. */
  readonly submittingApprovalIds?: ReadonlySet<string>;
  /** Whether tool call groups should be rendered in expanded mode. Toggled via Ctrl+O. */
  readonly expandToolCalls?: boolean;
  /**
   * Whether to render a read-only settled record for each decided/reconciled/
   * failed change set (the terminal analogue of the web's in-thread record,
   * DD-27 D2). Off by default so bare consumers stay minimal; `SessionView`
   * opts in. Pending (AWAITING_REVIEW) sets are never records here — their
   * decision surface is the docked `FileReviewPrompt`.
   */
  readonly showFileReviewRecords?: boolean;
}

type ThreadItem =
  | { readonly kind: "message"; readonly message: AgentMessage; readonly key: string }
  | { readonly kind: "tool-group"; readonly toolCalls: readonly ToolCall[]; readonly key: string }
  | { readonly kind: "sub-agent"; readonly subAgent: SubAgentExecution; readonly key: string }
  | { readonly kind: "phase"; readonly phase: ExecutionPhase; readonly key: string }
  | { readonly kind: "pending-message"; readonly content: string; readonly key: string }
  | { readonly kind: "file-review-record"; readonly set: FileChangeSet; readonly key: string }
  | { readonly kind: "approval"; readonly pendingApproval: PendingApproval; readonly key: string };

/** A change set is "settled" once a decision has been folded (or reconcile failed). */
function isSettledSet(status: FileChangeSetStatus): boolean {
  return (
    status === FileChangeSetStatus.DECIDED ||
    status === FileChangeSetStatus.RECONCILED ||
    status === FileChangeSetStatus.FAILED
  );
}

/**
 * Builds the observational thread items for a single execution: the spec
 * message, each AI/human message, tool-call groups, and sub-agent blocks —
 * plus (when `includeFileReviewRecords`) a read-only settled record appended at
 * the execution's tail for each decided/reconciled/failed change set.
 */
function buildExecutionSegment(
  exec: AgentExecution,
  ei: number,
  includeFileReviewRecords: boolean,
): ThreadItem[] {
  const seg: ThreadItem[] = [];
  const messages = exec.status?.messages ?? [];
  const subAgents = exec.status?.subAgentExecutions ?? [];

  const specMessage = exec.spec?.message;
  if (specMessage && specMessage !== "execute") {
    const humanMsg = create(AgentMessageSchema);
    humanMsg.type = MessageType.MESSAGE_HUMAN;
    humanMsg.content = specMessage;
    seg.push({ kind: "message", message: humanMsg, key: `e${ei}-spec` });
  }

  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    if (msg.type === MessageType.MESSAGE_TOOL) continue;

    const isEmptyAi = msg.type === MessageType.MESSAGE_AI && !msg.content.trim();

    if (!isEmptyAi) {
      seg.push({ kind: "message", message: msg, key: `e${ei}-m${mi}` });
    }

    if (msg.type === MessageType.MESSAGE_AI && msg.toolCalls.length > 0) {
      // Split tool calls: "task" tools become sub-agent blocks,
      // everything else goes into a regular tool group.
      const regularTools = msg.toolCalls.filter((tc) => tc.name !== "task");
      const taskTools = msg.toolCalls.filter((tc) => tc.name === "task");

      if (regularTools.length > 0) {
        seg.push({
          kind: "tool-group",
          toolCalls: regularTools,
          key: `e${ei}-m${mi}-tc`,
        });
      }

      for (let ti = 0; ti < taskTools.length; ti++) {
        const matchedSub = subAgents.find((sa) => sa.id === taskTools[ti].id);
        if (matchedSub) {
          seg.push({
            kind: "sub-agent",
            subAgent: matchedSub,
            key: `e${ei}-m${mi}-sa-${ti}`,
          });
        }
      }
    }
  }

  if (includeFileReviewRecords) {
    // `displayFileChangeSets` returns the server projection for a live
    // execution and folds the durable ledger for a terminal one, so a settled
    // record renders for both. Appended at the segment tail (the terminal
    // analogue of the web's last-stamped-row anchor); this is the only trace a
    // shell-made set — which stamps no rows — leaves behind (DD-27 D2).
    for (const set of displayFileChangeSets(exec.status)) {
      if (!isSettledSet(set.status) || set.changes.length === 0) continue;
      seg.push({ kind: "file-review-record", set, key: `e${ei}-frr-${set.id}` });
    }
  }

  return seg;
}

/**
 * Builds the full thread item list and the index at which the live region
 * begins (`liveStart`).
 *
 * The split is by execution identity, not a trailing count: every completed
 * execution's items are immutable history (safe for ink's append-only
 * `<Static>`), while the active execution's items — plus the trailing transient
 * items (phase, approvals, optimistic pending message) — stay live so their
 * review badges can transition and the optimistic message can be cleared
 * without shrinking the Static array.
 */
function buildThreadItems(
  executions: readonly AgentExecution[],
  activeStreamExecution: AgentExecution | null | undefined,
  pendingUserMessage: string | null | undefined,
  includeApprovals: boolean,
  includeFileReviewRecords: boolean,
): { items: ThreadItem[]; liveStart: number } {
  const items: ThreadItem[] = [];
  const allExecutions = activeStreamExecution
    ? [...executions, activeStreamExecution]
    : executions;

  // Boundary between immutable history and the live region. When there is an
  // active execution, it is the item count right before that execution's
  // segment; otherwise the transient tail (below) is the only live region.
  let liveStart = 0;
  let liveStartSet = false;

  for (let ei = 0; ei < allExecutions.length; ei++) {
    if (activeStreamExecution && ei === executions.length) {
      liveStart = items.length;
      liveStartSet = true;
    }
    items.push(...buildExecutionSegment(allExecutions[ei], ei, includeFileReviewRecords));
  }

  if (!liveStartSet) {
    // No active execution: every execution body is history; only the transient
    // tail appended below (e.g. an optimistic pending message) stays live.
    liveStart = items.length;
  }

  // --- Transient tail (always live) ---
  const lastExec = allExecutions[allExecutions.length - 1];
  const lastPhase =
    lastExec?.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;

  if (
    isTerminalPhase(lastPhase) &&
    lastPhase !== ExecutionPhase.EXECUTION_COMPLETED
  ) {
    items.push({ kind: "phase", phase: lastPhase, key: `phase-${lastPhase}` });
  }

  if (includeApprovals) {
    const approvals = lastExec?.status?.pendingApprovals ?? [];
    for (let ai = 0; ai < approvals.length; ai++) {
      items.push({
        kind: "approval",
        pendingApproval: approvals[ai],
        key: `approval-${approvals[ai].toolCallId || ai}`,
      });
    }
  }

  if (pendingUserMessage) {
    const alreadySynthesized = lastExec?.spec?.message === pendingUserMessage;
    if (!alreadySynthesized) {
      items.push({
        kind: "pending-message",
        content: pendingUserMessage,
        key: "pending-user-msg",
      });
    }
  }

  return { items, liveStart };
}

/**
 * Builds the id→change-set map that backs the file-review row badges, folding
 * every execution's change sets (via `displayFileChangeSets`, which reads the
 * live projection or the durable ledger). The active stream wins on an id
 * collision so a live decision is reflected before it is persisted.
 */
function buildChangeSetsById(
  executions: readonly AgentExecution[],
  activeStreamExecution: AgentExecution | null | undefined,
): FileReviewContextValue {
  const changeSetsById = new Map<string, FileChangeSet>();
  for (const exec of executions) {
    for (const set of displayFileChangeSets(exec.status)) {
      changeSetsById.set(set.id, set);
    }
  }
  if (activeStreamExecution) {
    for (const set of displayFileChangeSets(activeStreamExecution.status)) {
      changeSetsById.set(set.id, set);
    }
  }
  return { changeSetsById };
}

/**
 * Renders a continuous conversation thread from one or more
 * `AgentExecution` snapshots in the terminal.
 *
 * Composes {@link MessageEntry}, {@link ToolCallGroup}, {@link SubAgentBlock},
 * {@link ExecutionProgress}, {@link ApprovalPrompt}, and (for settled change
 * sets) {@link FileReviewRecord} into a scrolling terminal log.
 *
 * Completed executions are rendered via Ink's `<Static>` component so they are
 * written once and don't re-render, keeping terminal output efficient for long
 * conversations. The active execution renders live so its file-review row
 * badges transition (Pending review → Kept/Discarded) in place, then freeze
 * into `<Static>` when the execution reaches a terminal phase. The thread is
 * wrapped in a `FileReviewContext` provider so every {@link ToolCallItem}
 * can badge its stamped edit rows.
 */
export function MessageThread({
  executions,
  activeStreamExecution,
  pendingUserMessage,
  onApprovalSubmit,
  submittingApprovalIds,
  expandToolCalls = false,
  showFileReviewRecords = false,
}: MessageThreadProps) {
  const includeApprovals = onApprovalSubmit != null;
  const { items, liveStart } = useMemo(
    () =>
      buildThreadItems(
        executions,
        activeStreamExecution,
        pendingUserMessage,
        includeApprovals,
        showFileReviewRecords,
      ),
    [
      executions,
      activeStreamExecution,
      pendingUserMessage,
      includeApprovals,
      showFileReviewRecords,
    ],
  );

  const fileReviewContext = useMemo(
    () => buildChangeSetsById(executions, activeStreamExecution),
    [executions, activeStreamExecution],
  );

  const historyItems = items.slice(0, liveStart);
  const liveItems = items.slice(liveStart);

  return (
    <FileReviewContext.Provider value={fileReviewContext}>
      <Box flexDirection="column">
        <Static items={historyItems}>
          {(item) => (
            <Box key={item.key} flexDirection="column" marginBottom={1}>
              {renderItem(item, onApprovalSubmit, submittingApprovalIds, expandToolCalls)}
            </Box>
          )}
        </Static>

        {liveItems.map((item) => (
          <Box key={item.key} flexDirection="column" marginBottom={1}>
            {renderItem(item, onApprovalSubmit, submittingApprovalIds, expandToolCalls)}
          </Box>
        ))}
      </Box>
    </FileReviewContext.Provider>
  );
}

function renderItem(
  item: ThreadItem,
  onApprovalSubmit?: (toolCallId: string, action: ApprovalAction) => void,
  submittingApprovalIds?: ReadonlySet<string>,
  expandToolCalls?: boolean,
): React.ReactNode {
  switch (item.kind) {
    case "message":
      return <MessageEntry message={item.message} />;
    case "tool-group":
      return <ToolCallGroup toolCalls={item.toolCalls} defaultExpanded={expandToolCalls} />;
    case "sub-agent":
      return <SubAgentBlock subAgent={item.subAgent} defaultExpanded={expandToolCalls} />;
    case "phase":
      return <ExecutionProgress phase={item.phase} />;
    case "file-review-record":
      return <FileReviewRecord fileChangeSet={item.set} />;
    case "approval":
      return onApprovalSubmit ? (
        <ApprovalPrompt
          pendingApproval={item.pendingApproval}
          onSubmit={(action) =>
            onApprovalSubmit(item.pendingApproval.toolCallId, action)
          }
          isSubmitting={
            submittingApprovalIds?.has(item.pendingApproval.toolCallId) ?? false
          }
        />
      ) : null;
    case "pending-message":
      return (
        <Box paddingLeft={1}>
          <Text dimColor italic>
            {item.content}
          </Text>
        </Box>
      );
  }
}
