/**
 * Pure `renderStep` for the Connect Tools overview tour. The player, cursor,
 * narration, and viewport are supplied by `scenar pack` — this file only
 * maps step data to views.
 *
 * The plugin page is the real one (`_shared/PluginPage`), reading the
 * shared plugin and a My vault that holds its login from the fixtures in
 * `.scenar/providers.tsx`; the launcher is the console home with the
 * plugin picked, as "Start a chat" opens it. The approval story's two
 * `Run` snapshots are built once at module load, entirely from
 * frozen data:
 *
 * - The tool calls and the approval name the server as a run does
 *   (`ORDER_MGMT_SERVER_SLUG`, `plugin_<plugin>_<server>`), so the gate
 *   classifies the call as the plugin server's tool.
 * - The pending tool call and its approval share the literal id
 *   `tc-process-return-1`. The id match is what routes the gate INLINE onto
 *   the tool row (`ApprovalCardBody`, timestamp-free); an unmatched approval
 *   falls through to `MessageThread`'s bottom backstop card, whose header
 *   ticks a live elapsed-time counter, which no packed embed may render.
 * - `PendingApproval.requestedAt` is deliberately OMITTED as belt and
 *   braces: `useElapsedSince` renders nothing for an absent timestamp, so
 *   even a broken id match cannot tick.
 * - The completed call spans `sampleInstant()` to `sampleInstant(2_400)`, so
 *   the rendered duration chip reads a stable "2.4s". It is built with
 *   `create(ToolCallSchema)` rather than `samples.toolCall` — not for
 *   determinism (that factory is frozen too), but because this beat needs
 *   both a specific 2.4s span and the shared `tc-process-return-1` id, and the
 *   factory offers neither.
 *
 * The depicted surfaces sit inside `inert` wrappers: the approval gate
 * renders real Approve/Deny buttons a viewer must not be able to click
 * mid-playback, and a depicted page should not be interactive at all.
 * The Scenar cursor is an overlay, so `inert` does not affect it.
 */
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { samples, sampleInstant } from "@stigmer/react/test";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  RunPhase,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/approval_pb";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { BrowserView, CodeEditorView, TerminalView } from "@scenar/react";
import type { ResourceRef } from "@stigmer/sdk";
import { AppShell } from "../_shared/AppShell";
import { SessionView } from "../_shared/SessionView";
import { DEMO_ORG, snapshot } from "../_shared/fixtures";
import { ORDER_MGMT, ORDER_MGMT_SERVER_SLUG } from "../_shared/order-management-plugin";
import { PluginPage } from "../_shared/PluginPage";
import {
  ORDER_LOOKUP_OUTPUT,
  QUICKSTART_FILE_TREE,
  QUICKSTART_WORKSPACE,
} from "../_shared/quickstart-workspace";
import {
  type ConnectToolsTourStep,
  ORDER_QUESTION,
  PLUGIN_REFS_CODE,
  PLUGIN_REFS_HIGHLIGHT_LINE,
} from "./steps";

// ---------------------------------------------------------------------------
// Approval story fixtures (frozen — no clock, no randomness)
// ---------------------------------------------------------------------------

/** Ties the pending tool call to its approval; the match keeps the gate inline. */
const RETURN_TOOL_CALL_ID = "tc-process-return-1";

/**
 * The completed call's span, derived from the tour world's anchor instant.
 * Only the difference renders (the "2.4s" duration chip), and a difference
 * of two derivations is 2 400 ms by construction — the stability the old
 * hand-written pair could only promise in a comment.
 */
const RETURN_STARTED_AT = sampleInstant();
const RETURN_COMPLETED_AT = sampleInstant(2_400);

const returnRequest = samples.humanMessage(
  "Process a return for order #ORD-4821 — the headphones are defective.",
);

const pendingToolCall = create(ToolCallSchema, {
  id: RETURN_TOOL_CALL_ID,
  name: "process_return",
  mcpServerSlug: ORDER_MGMT_SERVER_SLUG,
  status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
  // No startedAt/completedAt: formatDuration needs both ends, so the
  // pending row shows no chip. approvalAction stays unset — a resolved
  // action would repaint the row as decided before the viewer approves.
});

const pendingApproval = create(PendingApprovalSchema, {
  toolCallId: RETURN_TOOL_CALL_ID,
  toolName: "process_return",
  // The runner's message for an MCP tool its server marks destructive.
  message: "Execute process_return",
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
  mcpServerSlug: ORDER_MGMT_SERVER_SLUG,
  // requestedAt deliberately omitted — see the file header.
});

const completedToolCall = create(ToolCallSchema, {
  id: RETURN_TOOL_CALL_ID,
  name: "process_return",
  mcpServerSlug: ORDER_MGMT_SERVER_SLUG,
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

function buildWaitingExecution(): Run {
  const exec = snapshot(
    [returnRequest, samples.aiMessage("", [pendingToolCall])],
    RunPhase.RUN_WAITING_FOR_APPROVAL,
  );
  exec.status!.pendingApprovals = [pendingApproval];
  return exec;
}

const WAITING = buildWaitingExecution();
const APPROVED = snapshot(
  [returnRequest, samples.aiMessage("", [completedToolCall]), approvedSummary],
  RunPhase.RUN_COMPLETED,
);

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** The plugin the conversation lists, as "Start a chat" picks it. */
const PLUGIN_PICKS: readonly ResourceRef[] = [{ org: DEMO_ORG, slug: ORDER_MGMT.name }];

/**
 * Console beats render inside a browser window whose address bar tracks the
 * depicted route — a screen recording shows an app in its container.
 */
function consoleWindow(contentKey: string, path: string, children: ReactNode) {
  return (
    <BrowserView url={`app.stigmer.ai${path}`} contentKey={contentKey}>
      {children}
    </BrowserView>
  );
}

export function renderStep(data: ConnectToolsTourStep): ReactNode {
  switch (data.view) {
    case "plugin-page":
      return consoleWindow(
        "plugin-page",
        `/library/plugins/${DEMO_ORG}/${ORDER_MGMT.name}`,
        // Stable contentKey: both plugin-page beats show one page, so
        // AppShell must not replay its navigation transition between them.
        <AppShell activeNav="library" contentKey="plugin-page">
          <PluginPage org={DEMO_ORG} slug={ORDER_MGMT.name} serverName={ORDER_MGMT.name} />
        </AppShell>,
      );

    case "chat-launcher":
      // "Start a chat" opens the console home with the plugin picked.
      return consoleWindow(
        "chat-launcher",
        `/?plugin=${DEMO_ORG}/${ORDER_MGMT.name}`,
        <AppShell activeNav="new-session" contentKey="chat-launcher" slideDirection="forward">
          <SessionView pluginRefs={PLUGIN_PICKS} typingMessage={ORDER_QUESTION} />
        </AppShell>,
      );

    case "code":
      return (
        <CodeEditorView
          filename={QUICKSTART_WORKSPACE.entryFile}
          lines={PLUGIN_REFS_CODE}
          highlightLines={[PLUGIN_REFS_HIGHLIGHT_LINE]}
          fileTree={QUICKSTART_FILE_TREE}
          workspaceName={QUICKSTART_WORKSPACE.name}
          contentKey="plugin-refs"
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
      // The panel stays collapsed to its chip — the console's default, and
      // this story lives in the thread (the approval gate). SessionView's
      // root is inert, so the depicted page is non-interactive.
      return consoleWindow(
        data.phase,
        "/",
        <AppShell activeNav="new-session" contentKey={data.phase}>
          <SessionView
            execution={execution}
            pluginRefs={PLUGIN_PICKS}
            showApprovals={data.phase === "awaiting-approval"}
          />
        </AppShell>,
      );
    }
  }
}
