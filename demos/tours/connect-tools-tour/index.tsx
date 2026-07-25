/**
 * Pure `renderStep` for the Connect Tools overview tour. The player, cursor,
 * narration, and viewport are supplied by `scenar pack` — this file only
 * maps step data to views.
 *
 * The connected server is the shared `ORDER_MGMT_CONNECTED` snapshot,
 * injected through `McpServerDetailView`'s `mcpServerState` prop (no
 * `getByReference` fires — scenar-cloud DD-006). The approval story's two
 * `AgentExecution` snapshots are built once at module load, entirely from
 * frozen data:
 *
 * - The pending tool call and its approval share the literal id
 *   `tc-process-return-1`. The id match is what routes the gate INLINE onto
 *   the tool row (`ApprovalCardBody`, timestamp-free); an unmatched approval
 *   falls through to `MessageThread`'s bottom backstop card, whose header
 *   ticks a live elapsed-time counter — a DD-006 violation in an embed.
 * - `PendingApproval.requestedAt` is deliberately OMITTED as belt and
 *   braces: `useElapsedSince` renders nothing for an absent timestamp, so
 *   even a broken id match cannot tick.
 * - The completed call carries hand-written frozen ISO timestamps 2.4s
 *   apart, so the rendered duration chip reads a stable "2.4s" — never the
 *   "0ms"/"1ms" flake `samples.toolCall`'s live clock produces (which is why
 *   that factory is denylisted by `verify-scenar-tours`).
 *
 * The depicted surfaces sit inside `inert` wrappers: the approval gate
 * renders real Approve/Deny buttons a viewer must not be able to click
 * mid-playback, and a depicted page should not be interactive at all.
 * The Scenar cursor is an overlay, so `inert` does not affect it.
 */
import type { CSSProperties, ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { McpServerDetailView } from "@stigmer/react";
import { samples } from "@stigmer/react/test";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionPhase,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { CodeEditorView, TerminalView } from "@scenar/react";
import { AppShell } from "../_shared/AppShell";
import { ComposerView } from "../_shared/ComposerView";
import { renderWidgetsSidebar } from "../_shared/WidgetsSidebar";
import { DEMO_CONTENT_ZOOM, DEMO_ORG, snapshot } from "../_shared/fixtures";
import {
  ORDER_MGMT_CONNECTED,
  ORDER_MGMT_MCP,
} from "../_shared/order-management-mcp";
import {
  ORDER_LOOKUP_OUTPUT,
  QUICKSTART_FILE_TREE,
  QUICKSTART_WORKSPACE,
} from "../_shared/quickstart-workspace";
import {
  type ConnectToolsTourStep,
  MCP_REFS_CODE,
  MCP_REFS_HIGHLIGHT_LINE,
} from "./steps";

// ---------------------------------------------------------------------------
// Approval story fixtures (frozen — no clock, no randomness)
// ---------------------------------------------------------------------------

/** Ties the pending tool call to its approval; the match keeps the gate inline. */
const RETURN_TOOL_CALL_ID = "tc-process-return-1";

/** Frozen instants for the completed call's rendered "2.4s" duration chip. */
const RETURN_STARTED_AT = "2026-07-20T09:31:00.000Z";
const RETURN_COMPLETED_AT = "2026-07-20T09:31:02.400Z";

const returnRequest = samples.humanMessage(
  "Process a return for order #ORD-4821 — the headphones are defective.",
);

const pendingToolCall = create(ToolCallSchema, {
  id: RETURN_TOOL_CALL_ID,
  name: "process_return",
  status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
  // No startedAt/completedAt: formatDuration needs both ends, so the
  // pending row shows no chip. approvalAction stays unset — a resolved
  // action would repaint the row as decided before the viewer approves.
});

const pendingApproval = create(PendingApprovalSchema, {
  toolCallId: RETURN_TOOL_CALL_ID,
  toolName: "process_return",
  // The server's classified policy template, rendered — the same policy the
  // detail beat shows on the Policies tab.
  message: "Process return for order 'ORD-4821' — refund $79.99 to original_payment",
  argsPreview: JSON.stringify(
    {
      order_id: "ORD-4821",
      reason: "defective",
      refund_amount: 79.99,
      refund_method: "original_payment",
    },
    null,
    2,
  ),
  mcpServerSlug: ORDER_MGMT_MCP.slug,
  // requestedAt deliberately omitted — see the file header.
});

const completedToolCall = create(ToolCallSchema, {
  id: RETURN_TOOL_CALL_ID,
  name: "process_return",
  status: ToolCallStatus.TOOL_CALL_COMPLETED,
  startedAt: RETURN_STARTED_AT,
  completedAt: RETURN_COMPLETED_AT,
  result: JSON.stringify(
    {
      return_id: "RET-1092",
      status: "approved",
      refund_amount: 79.99,
      refund_method: "original_payment",
      estimated_refund_date: "2026-04-07",
    },
    null,
    2,
  ),
});

const approvedSummary = samples.aiMessage(
  "The return has been processed. Here's a summary:\n\n" +
    "- **Return ID**: RET-1092\n" +
    "- **Refund**: $79.99 to original payment method\n" +
    "- **Estimated refund date**: April 7, 2026",
);

function buildWaitingExecution(): AgentExecution {
  const exec = snapshot(
    [returnRequest, samples.aiMessage("", [pendingToolCall])],
    ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
  );
  exec.status!.pendingApprovals = [pendingApproval];
  return exec;
}

const WAITING = buildWaitingExecution();
const APPROVED = snapshot(
  [returnRequest, samples.aiMessage("", [completedToolCall]), approvedSummary],
  ExecutionPhase.EXECUTION_COMPLETED,
);

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Scrollable frame for the real detail view (mcp-server-connect-tour's idiom). */
const DETAIL_SCROLL: CSSProperties = {
  height: "100%",
  overflowY: "auto",
  padding: 16,
  zoom: DEMO_CONTENT_ZOOM,
};

const FULL_HEIGHT: CSSProperties = { height: "100%" };

export function renderStep(data: ConnectToolsTourStep): ReactNode {
  switch (data.view) {
    case "detail":
      return (
        // Stable contentKey: both detail beats show one page, so AppShell
        // must not replay its navigation transition between them. The inner
        // key remounts the view exactly when defaultCapabilityTab changes
        // (the reset idiom — stigmer DD-014); step 1's scroll_to
        // re-establishes scroll after the remount.
        <AppShell activeNav="library" contentKey="mcp-detail">
          <div key={`detail-${data.tab}`} style={DETAIL_SCROLL} inert>
            <McpServerDetailView
              org={DEMO_ORG}
              slug={ORDER_MGMT_MCP.slug}
              activeOrg={DEMO_ORG}
              editable
              mcpServerState={ORDER_MGMT_CONNECTED}
              defaultCapabilityTab={data.tab}
            />
          </div>
        </AppShell>
      );

    case "code":
      return (
        <CodeEditorView
          filename={QUICKSTART_WORKSPACE.entryFile}
          lines={MCP_REFS_CODE}
          highlightLines={[MCP_REFS_HIGHLIGHT_LINE]}
          fileTree={QUICKSTART_FILE_TREE}
          workspaceName={QUICKSTART_WORKSPACE.name}
          contentKey="mcp-refs"
        />
      );

    case "terminal":
      return (
        <TerminalView
          title={QUICKSTART_WORKSPACE.terminalTitle}
          cwd={QUICKSTART_WORKSPACE.cwd}
          lines={ORDER_LOOKUP_OUTPUT}
          contentKey="order"
        />
      );

    case "thread": {
      const execution = data.phase === "awaiting-approval" ? WAITING : APPROVED;
      return (
        <AppShell
          activeNav="new-session"
          contentKey={data.phase}
          aside={renderWidgetsSidebar(execution)}
        >
          <div style={FULL_HEIGHT} inert>
            <ComposerView
              execution={execution}
              showApprovals={data.phase === "awaiting-approval"}
            />
          </div>
        </AppShell>
      );
    }
  }
}
