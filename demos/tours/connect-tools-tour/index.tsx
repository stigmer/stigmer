/**
 * Pure `renderStep` for the Connect Tools overview tour. The player, cursor,
 * narration, and viewport are supplied by `scenar pack` — this file only
 * maps step data to views.
 *
 * The plugin page is the real one (`_shared/PluginPage`), reading the
 * shared plugin and a My vault that holds its login from the fixtures in
 * `.scenar/providers.tsx`; the launcher is the console home with the
 * plugin picked, as "Start a chat" opens it. The approval story's two
 * conversations are folded once at module load from frozen session events:
 *
 * - The tool use names the server as a run does (`ORDER_MGMT_SERVER_SLUG`,
 *   `plugin_<plugin>_<server>`), so the gate classifies the call as the
 *   plugin server's tool.
 * - The waiting call is an ordinary tool row of its turn (its permission
 *   `ask`, its `stigmer.permission.asked` beside it), which routes its
 *   decision INLINE onto the row (`ApprovalCardBody`, timestamp-free);
 *   only a call with no row falls through to `MessageThread`'s bottom
 *   backstop card, whose header ticks a live elapsed-time counter, which
 *   no packed embed may render.
 * - The completed call's result lands at `sampleInstant(2_400)`, so the
 *   rendered duration chip reads a stable "2.4s" (the default result time
 *   would read "1.2s").
 *
 * The depicted surfaces sit inside `inert` wrappers: the approval gate
 * renders real Approve/Deny buttons a viewer must not be able to click
 * mid-playback, and a depicted page should not be interactive at all.
 * The Scenar cursor is an overlay, so `inert` does not affect it.
 */
import type { ReactNode } from "react";
import { samples, sampleInstant } from "@stigmer/react-sdk/test";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { BrowserView, CodeEditorView, TerminalView } from "@scenar/react";
import type { ResourceRef } from "@stigmer/client";
import { AppShell } from "../_shared/AppShell";
import { SessionView } from "../_shared/SessionView";
import { DEMO_ORG, conversation } from "../_shared/fixtures";
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

/** The person's request both conversations open with. */
const RETURN_REQUEST =
  "Process a return for order #ORD-4821 — the headphones are defective.";

/** The return call's input, as the agent passes it and the gate previews it. */
const RETURN_INPUT = {
  order_id: "ORD-4821",
  reason: "defective",
  refund_amount: 79.99,
  refund_method: "original_payment",
};

/** The return call, on the plugin's MCP server. */
const returnUse = (evaluatedPermission: string) =>
  samples.toolUseEvent("process_return", RETURN_INPUT, {
    mcpServerName: ORDER_MGMT_SERVER_SLUG,
    evaluatedPermission,
  });

/** The waiting call's id, which its ask names. */
const RETURN_TOOL_USE_ID = returnUse("ask").event.value!.id;

const WAITING = conversation([
  samples.userMessageEvent(RETURN_REQUEST),
  samples.runStatusEvent("running"),
  returnUse("ask"),
  samples.permissionAskedEvent(RETURN_TOOL_USE_ID, {
    // The runner's message for an MCP tool its server marks destructive.
    message: "Execute process_return",
    argsPreview: JSON.stringify(RETURN_INPUT, null, 2),
    // No rule recorded: the gate shows no provenance line.
    policySource: "",
  }),
  samples.runStatusEvent("waiting"),
]);

const APPROVED = conversation(
  [
    samples.userMessageEvent(RETURN_REQUEST),
    samples.runStatusEvent("running"),
    returnUse(""),
    samples.toolResultEvent(
      RETURN_TOOL_USE_ID,
      JSON.stringify(
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
      // The call ran 2.4s: its duration chip reads a stable "2.4s".
      { mcp: true, processedAt: sampleInstant(2_400) },
    ),
    samples.agentMessageEvent(
      "The return has been processed. Here's a summary:\n\n" +
        "- **Return ID**: RET-1092\n" +
        "- **Refund**: $79.99 to original payment method\n" +
        "- **Estimated refund date**: April 7, 2026",
    ),
    samples.runStatusEvent("completed"),
  ],
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
      const thread = data.phase === "awaiting-approval" ? WAITING : APPROVED;
      // The panel stays collapsed to its chip — the console's default, and
      // this story lives in the thread (the approval gate). SessionView's
      // root is inert, so the depicted page is non-interactive.
      return consoleWindow(
        data.phase,
        "/",
        <AppShell activeNav="new-session" contentKey={data.phase}>
          <SessionView
            conversation={thread}
            pluginRefs={PLUGIN_PICKS}
            showApprovals={data.phase === "awaiting-approval"}
          />
        </AppShell>,
      );
    }
  }
}
