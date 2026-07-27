import type { CSSProperties, ReactNode } from "react";
import { AgentDetailView } from "@stigmer/react";
import { BrowserView, CodeEditorView, TerminalView } from "@scenar/react";
import { AppShell } from "../_shared/AppShell";
import { SessionView } from "../_shared/SessionView";
import { DEMO_ORG } from "../_shared/fixtures";
import {
  ORDER_LOOKUP_OUTPUT,
  QUICKSTART_FILE_TREE,
  QUICKSTART_WORKSPACE,
} from "../_shared/quickstart-workspace";
import { type CreateAgentTourStep, DEMO_SLUG, SIMPLIFIED_CODE } from "./steps";

const TYPING_MESSAGE =
  "I want to create a customer support agent. It should use the return-policy " +
  "skill and the order-management-api MCP server.";

/** The console's address as the depicted browser shows it. */
const CONSOLE_URL = "app.stigmer.ai";

/**
 * The library zone's page scroll pane and content column, at the console's
 * own geometry (`LibraryLayout`: `mx-auto max-w-4xl px-6 py-8`). No zoom —
 * the shell lays out at real size (one scale factor per frame).
 */
const DETAIL_PAGE: CSSProperties = {
  height: "100%",
  overflowY: "auto",
  background: "var(--stgm-background)",
};
const DETAIL_CONTENT: CSSProperties = {
  margin: "0 auto",
  maxWidth: 896,
  padding: "32px 24px",
};

/**
 * The console beats render inside a browser window — a screen recording
 * depicts an app in its container, not a floating fragment. The editor and
 * terminal beats keep their own window chrome (`CodeEditorView`,
 * `TerminalView`), so the tour reads as switching between real apps.
 */
function consoleWindow(contentKey: string, path: string, children: ReactNode) {
  return (
    <BrowserView url={`${CONSOLE_URL}${path}`} contentKey={contentKey}>
      {children}
    </BrowserView>
  );
}

/**
 * Pure `renderStep`: maps a step's data to the view it renders. The player,
 * cursor, narration, and viewport are supplied by `scenar pack` (embed) and
 * `scenar render` (video) — this stays declarative.
 */
export function renderStep(data: CreateAgentTourStep): ReactNode {
  switch (data.view) {
    case "agent-creator-typing":
      return consoleWindow(
        "creator",
        "/?draft=agent",
        <AppShell activeNav="new-session" contentKey="creator">
          <SessionView heading="Add an Agent" typingMessage={TYPING_MESSAGE} />
        </AppShell>,
      );

    case "agent-created":
      return consoleWindow(
        "created",
        "/?draft=agent",
        <AppShell activeNav="new-session" contentKey="created">
          {/* Cursor/camera anchor for steps that zoom into the reply. */}
          <div data-cursor-target="thread" style={{ height: "100%" }}>
            <SessionView execution={data.execution} />
          </div>
        </AppShell>,
      );

    case "agent-config":
      return consoleWindow(
        "config",
        `/library/agents/${DEMO_SLUG}`,
        <div style={DETAIL_PAGE}>
          <div style={DETAIL_CONTENT}>
            <AgentDetailView org={DEMO_ORG} slug={DEMO_SLUG} />
          </div>
        </div>,
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
