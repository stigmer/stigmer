import type { CSSProperties, ReactNode } from "react";
import { AgentDetailView } from "@stigmer/react";
import { CodeEditorView, TerminalView } from "@scenar/react";
import { AppShell } from "../_shared/AppShell";
import { ComposerView } from "../_shared/ComposerView";
import { DEMO_CONTENT_ZOOM, DEMO_ORG } from "../_shared/fixtures";
import {
  ORDER_LOOKUP_OUTPUT,
  QUICKSTART_FILE_TREE,
  QUICKSTART_WORKSPACE,
} from "../_shared/quickstart-workspace";
import { type CreateAgentTourStep, DEMO_SLUG, SIMPLIFIED_CODE } from "./steps";

const TYPING_MESSAGE =
  "I want to create a customer support agent. It should use the return-policy " +
  "skill and the order-management-api MCP server.";

/** Bordered detail card that frames a standalone SDK component (no app shell). */
const DETAIL_CARD: CSSProperties = {
  height: "var(--scenar-shell-height, clamp(320px, 55vh, 560px))",
  overflow: "hidden",
  border: "1px solid var(--stgm-border)",
  borderRadius: "var(--stgm-radius)",
  background: "var(--stgm-card)",
};

const DETAIL_SCROLL: CSSProperties = {
  height: "100%",
  overflowY: "auto",
  padding: 16,
  zoom: DEMO_CONTENT_ZOOM,
};

/**
 * Pure `renderStep`: maps a step's data to the view it renders. The player,
 * cursor, narration, and viewport are supplied by `scenar pack` (embed) and
 * `scenar render` (video) — this stays declarative.
 */
export function renderStep(data: CreateAgentTourStep): ReactNode {
  switch (data.view) {
    case "agent-creator-typing":
      return (
        <AppShell activeNav="new-session" contentKey="creator">
          <ComposerView typingMessage={TYPING_MESSAGE} />
        </AppShell>
      );

    case "agent-created":
      return (
        <AppShell activeNav="new-session" contentKey="created">
          <ComposerView execution={data.execution} />
        </AppShell>
      );

    case "agent-config":
      return (
        <div style={DETAIL_CARD}>
          <div style={DETAIL_SCROLL}>
            <AgentDetailView org={DEMO_ORG} slug={DEMO_SLUG} />
          </div>
        </div>
      );

    case "code-simplified":
      return (
        <CodeEditorView
          filename={QUICKSTART_WORKSPACE.entryFile}
          lines={SIMPLIFIED_CODE}
          highlightLines={[8, 9, 10]}
          fileTree={QUICKSTART_FILE_TREE}
          workspaceName={QUICKSTART_WORKSPACE.name}
          contentKey="simplified"
        />
      );

    case "terminal-result":
      return (
        <TerminalView
          title={QUICKSTART_WORKSPACE.terminalTitle}
          cwd={QUICKSTART_WORKSPACE.cwd}
          lines={ORDER_LOOKUP_OUTPUT}
          contentKey="result"
        />
      );
  }
}
