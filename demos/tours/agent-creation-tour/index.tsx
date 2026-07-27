import type { CSSProperties, ReactNode } from "react";
import { BrowserView } from "@scenar/react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AppShell } from "../_shared/AppShell";
import { SessionView } from "../_shared/SessionView";
import { ResourceListPage } from "../_shared/ResourceListPage";
import {
  type AgentCreationTourStep,
  AGENT_CREATOR_REF,
  ALL_AGENTS,
  EXISTING_AGENTS,
} from "./steps";

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

/**
 * The artifact the story creates — opened as the panel's document tab in
 * the apply beat. Deriving the name from the execution keeps the opened
 * tab and the fixture one identity (the artifact exists exactly once, on
 * the execution).
 */
function firstArtifactName(execution: AgentExecution) {
  return execution.status!.artifacts[0]!.name;
}

/** Placeholder content area before the tour navigates anywhere. */
const HOME_HINT: CSSProperties = {
  display: "flex",
  height: "100%",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  fontSize: 12,
  color: "var(--stgm-muted-foreground)",
};

/**
 * Pure `renderStep`: maps a step's data to the view it renders. The player,
 * cursor, narration, and viewport are supplied by `scenar pack` (embed) and
 * `scenar render` (video) — this stays declarative. Cursor targets referenced
 * by the steps' interactions: `library` and `create-agent` come from the
 * shared chrome, `panel-chip` from `SessionView`'s chip anchor, and
 * `apply-resource-button` from the real ArtifactDocument itself.
 */
export function renderStep(data: AgentCreationTourStep): ReactNode {
  switch (data.view) {
    case "library-click":
      return consoleWindow(
        "home",
        "/",
        <AppShell highlightNav="library" contentKey="home">
          <div style={HOME_HINT}>Start a new session</div>
        </AppShell>,
      );

    case "agents-list":
      return consoleWindow(
        "agents",
        "/library/agents",
        <AppShell activeNav="library" contentKey="agents" slideDirection="forward">
          <ResourceListPage
            title="Agents"
            createLabel="Add Agent"
            cursorTarget="create-agent"
            items={EXISTING_AGENTS}
            layout="grid"
          />
        </AppShell>,
      );

    case "create-agent-click":
      return consoleWindow(
        "agents",
        "/library/agents",
        <AppShell activeNav="library" contentKey="agents">
          <ResourceListPage
            title="Agents"
            createLabel="Add Agent"
            cursorTarget="create-agent"
            items={EXISTING_AGENTS}
            layout="grid"
            highlightCreate
          />
        </AppShell>,
      );

    case "composer-ready":
      return consoleWindow(
        "composer",
        "/?draft=agent",
        <AppShell activeNav="library" contentKey="composer" slideDirection="forward">
          <SessionView agentRef={AGENT_CREATOR_REF} heading="Add an Agent" />
        </AppShell>,
      );

    case "conversation":
    case "panel-click":
      // The panel stays collapsed through the conversation — the console's
      // default. When the final beat's execution carries the artifact, the
      // chip picks up its badge, and the panel-click beat's cursor finds it.
      return consoleWindow(
        "composer",
        "/?draft=agent",
        <AppShell activeNav="library" contentKey="composer">
          <SessionView execution={data.execution} />
        </AppShell>,
      );

    case "panel-open":
      // The shipped arc, not the retired preview modal: the panel opens on
      // the Artifacts facet with the definition listed.
      return consoleWindow(
        "composer",
        "/?draft=agent",
        <AppShell activeNav="library" contentKey="composer">
          <SessionView execution={data.execution} panelView="artifacts" />
        </AppShell>,
      );

    case "apply-agent":
      // The artifact opens as the panel's document tab (ArtifactDocument),
      // whose action bar carries the "Apply to acme" CTA the cursor finds.
      return consoleWindow(
        "composer",
        "/?draft=agent",
        <AppShell activeNav="library" contentKey="composer">
          <SessionView
            execution={data.execution}
            panelView="artifacts"
            openArtifactName={firstArtifactName(data.execution)}
          />
        </AppShell>,
      );

    case "library-complete":
      return consoleWindow(
        "agents",
        "/library/agents",
        <AppShell activeNav="library" contentKey="agents" slideDirection="backward">
          <ResourceListPage
            title="Agents"
            createLabel="Add Agent"
            cursorTarget="create-agent"
            items={ALL_AGENTS}
            layout="grid"
            showNewItem
          />
        </AppShell>,
      );
  }
}
