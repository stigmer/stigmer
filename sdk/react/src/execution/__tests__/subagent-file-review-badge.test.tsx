/**
 * Sub-agent file-review badges (DD-24/T05_0 follow-up).
 *
 * A sub-agent's flowed file-edit row is stamped by the runner with the PARENT
 * turn's change set id (sub-agent writes fold into the parent set). These tests
 * lock the React side: a stamped row rendered inside a `SubAgentSection`
 * resolves its review-state badge against the session-wide `FileReviewContext`
 * map, and — end to end through `MessageThread` — that map is built from the
 * parent execution's `status.fileChangeSets` and reaches the nested row.
 *
 * The per-row badge resolution itself (pending/kept/discarded/none) is covered
 * exhaustively in `ToolCallItem.test.tsx`; here the emphasis is the SUB-AGENT
 * wiring — the novel path this change enables.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
  FileContentSchema,
  type AgentMessage,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  SubAgentExecutionSchema,
  type SubAgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  FileDecisionSchema,
  type FileChangeSet,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  DiffCompleteness,
  ExecutionPhase,
  FileChangeKind,
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
  MessageType,
  SubAgentStatus,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SubAgentSection } from "../SubAgentSection";
import { ApprovalContext, type ApprovalContextValue } from "../ApprovalContext";
import { FileReviewContext } from "../FileReviewContext";
import { MessageThread } from "../MessageThread";

const SET_ID = "exec-1:0";
const ROW_PATH = "src/a.ts";

const emptyApprovalCtx: ApprovalContextValue = {
  approvalsByToolCallId: new Map(),
  submittingIds: new Set(),
  errorsByToolCallId: new Map(),
};

afterEach(cleanup);

/** A sub-agent whose message carries one stamped, flowed file-edit row. */
function subAgentWithStampedEdit(
  status: SubAgentStatus,
  fileChangeSetId: string,
  rowPath = ROW_PATH,
): SubAgentExecution {
  return create(SubAgentExecutionSchema, {
    id: "sa-1",
    name: "code_editor",
    status,
    messages: [
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        toolCalls: [
          create(ToolCallSchema, {
            id: "sa-tc-edit",
            name: "edit",
            status: ToolCallStatus.TOOL_CALL_COMPLETED,
            args: { path: rowPath, old_string: "a", new_string: "b" },
            fileChangeSetId,
          }),
        ],
      }),
    ],
  });
}

/** A change set carrying one change for {@link ROW_PATH}, with optional verdict. */
function reviewSet(
  status: FileChangeSetStatus,
  decisions: FileDecisionAction[] = [],
): FileChangeSet {
  return create(FileChangeSetSchema, {
    id: SET_ID,
    status,
    aggregateDigest: "agg-1",
    diffCompleteness: DiffCompleteness.COMPLETE,
    changes: [
      create(CapturedFileChangeSchema, {
        id: `${SET_ID}:${ROW_PATH}`,
        pathBefore: ROW_PATH,
        pathAfter: ROW_PATH,
        kind: FileChangeKind.MODIFY,
        before: create(FileContentSchema, { body: { case: "inline", value: "old\n" } }),
        after: create(FileContentSchema, { body: { case: "inline", value: "new\n" } }),
        fileDigest: "d-a",
        diffComplete: true,
      }),
    ],
    decisions: decisions.map((action) =>
      create(FileDecisionSchema, {
        changeSetId: SET_ID,
        scope: FileDecisionScope.CHANGE_SET,
        action,
      }),
    ),
  });
}

function renderSubAgentRow(sub: SubAgentExecution, set: FileChangeSet | null) {
  const map = set ? new Map([[set.id, set]]) : new Map<string, FileChangeSet>();
  return render(
    <ApprovalContext.Provider value={emptyApprovalCtx}>
      <FileReviewContext.Provider value={{ changeSetsById: map }}>
        {/* collapsible=false renders the nested rows flat — deterministic, no
            dependence on the card's auto-disclosure state. */}
        <SubAgentSection subAgentExecution={sub} collapsible={false} />
      </FileReviewContext.Provider>
    </ApprovalContext.Provider>,
  );
}

function badge(container: HTMLElement): Element | null {
  return container.querySelector('[data-cursor-target="file-review-row-badge"]');
}

describe("sub-agent row badges (SubAgentSection)", () => {
  it("badges a stamped sub-agent edit row 'Pending review' while its set awaits review", () => {
    const { container } = renderSubAgentRow(
      subAgentWithStampedEdit(SubAgentStatus.SUB_AGENT_COMPLETED, SET_ID),
      reviewSet(FileChangeSetStatus.AWAITING_REVIEW),
    );
    expect(badge(container)?.textContent).toBe("Pending review");
  });

  it("flips a sub-agent row to the file's verdict once the set is decided", () => {
    const kept = renderSubAgentRow(
      subAgentWithStampedEdit(SubAgentStatus.SUB_AGENT_COMPLETED, SET_ID),
      reviewSet(FileChangeSetStatus.RECONCILED, [FileDecisionAction.APPROVE]),
    );
    expect(badge(kept.container)?.textContent).toBe("Kept");
    cleanup();

    const discarded = renderSubAgentRow(
      subAgentWithStampedEdit(SubAgentStatus.SUB_AGENT_COMPLETED, SET_ID),
      reviewSet(FileChangeSetStatus.RECONCILED, [FileDecisionAction.REJECT]),
    );
    expect(badge(discarded.container)?.textContent).toBe("Discarded");
  });

  it("shows no badge when the stamped set cannot be resolved (graceful degrade, DD-24 D3)", () => {
    // Row stamped with a set id absent from the session map.
    const orphan = renderSubAgentRow(
      subAgentWithStampedEdit(SubAgentStatus.SUB_AGENT_COMPLETED, "exec-1:missing"),
      reviewSet(FileChangeSetStatus.AWAITING_REVIEW),
    );
    expect(badge(orphan.container)).toBeNull();
    cleanup();

    // Row stamped with the right (settled) set, but its path is not in the set's
    // changes: the per-file verdict cannot be resolved, so no badge. (An
    // AWAITING_REVIEW set badges every stamped row 'pending' regardless of path —
    // path resolution only decides the verdict of a SETTLED set.)
    const pathMiss = renderSubAgentRow(
      subAgentWithStampedEdit(SubAgentStatus.SUB_AGENT_COMPLETED, SET_ID, "src/other.ts"),
      reviewSet(FileChangeSetStatus.RECONCILED, [FileDecisionAction.APPROVE]),
    );
    expect(badge(pathMiss.container)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// End-to-end through MessageThread: proves the session-wide FileReviewContext
// map is built from the PARENT execution's status.fileChangeSets and reaches a
// stamped row nested inside a sub-agent (the map + provider + nested-render path).
// ---------------------------------------------------------------------------

describe("sub-agent row badges (MessageThread integration)", () => {
  beforeEach(() => {
    // useAutoScroll depends on browser APIs absent in happy-dom.
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn(() => []),
        root: null,
        rootMargin: "",
        thresholds: [0],
      })),
    );
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })),
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => {
        cb(performance.now());
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A live execution that delegated to a sub-agent which edited a file this
   * turn. The parent carries the `task` tool call (matched to the sub-agent by
   * id) and the change set on `status.fileChangeSets`; the sub-agent (running,
   * so its card auto-opens) carries the stamped edit row.
   */
  function makeExecWithSubAgentEdit(): AgentExecution {
    const exec = create(AgentExecutionSchema);
    exec.metadata = create(ApiResourceMetadataSchema, { id: "exec-1" });
    exec.spec = create(AgentExecutionSpecSchema, { message: "Delegate an edit" });

    const status = create(AgentExecutionStatusSchema);
    status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS;
    const aiMsg: AgentMessage = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: "Delegating.",
      toolCalls: [
        create(ToolCallSchema, {
          id: "sa-1", // matches the SubAgentExecution id
          name: "task",
          status: ToolCallStatus.TOOL_CALL_COMPLETED,
        }),
      ],
    });
    status.messages = [aiMsg];
    status.subAgentExecutions = [
      subAgentWithStampedEdit(SubAgentStatus.SUB_AGENT_IN_PROGRESS, SET_ID),
    ];
    status.fileChangeSets = [reviewSet(FileChangeSetStatus.AWAITING_REVIEW)];
    exec.status = status;
    return exec;
  }

  it("badges a stamped sub-agent row from a set on the parent execution's fileChangeSets", () => {
    render(
      <MessageThread
        executions={[]}
        activeStreamExecution={makeExecWithSubAgentEdit()}
        showFileReviewRecords
      />,
    );
    const el = document.querySelector('[data-cursor-target="file-review-row-badge"]');
    expect(el?.textContent).toBe("Pending review");
  });
});
