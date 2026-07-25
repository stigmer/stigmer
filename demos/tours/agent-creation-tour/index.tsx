import type { CSSProperties, ReactNode } from "react";
import { ArtifactPreviewContent } from "@stigmer/react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AppShell } from "../_shared/AppShell";
import { ComposerView } from "../_shared/ComposerView";
import { ResourceListPage } from "../_shared/ResourceListPage";
import { renderWidgetsSidebar } from "../_shared/WidgetsSidebar";
import { DEMO_CONTENT_ZOOM, DEMO_ORG } from "../_shared/fixtures";
import {
  type AgentCreationTourStep,
  AGENT_CREATOR_REF,
  ALL_AGENTS,
  EXISTING_AGENTS,
} from "./steps";
import "./preview.css";

const noop = () => {};

function firstArtifact(execution: AgentExecution) {
  return execution.status!.artifacts[0];
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

/** Conversation kept beneath the artifact-preview scrim. */
const PREVIEW_UNDERLAY: CSSProperties = {
  position: "absolute",
  inset: 0,
  overflow: "hidden",
};

/** Dimming scrim that centers the artifact-preview card over the thread. */
const PREVIEW_SCRIM: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in oklab, var(--stgm-background) 60%, transparent)",
};

/** Modal card framing the real ArtifactPreviewContent. */
const PREVIEW_CARD: CSSProperties = {
  width: 576,
  overflow: "hidden",
  border: "1px solid var(--stgm-border)",
  borderRadius: "var(--stgm-radius)",
  background: "var(--stgm-background)",
  boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
};

/**
 * Pure `renderStep`: maps a step's data to the view it renders. The player,
 * cursor, narration, and viewport are supplied by `scenar pack` (embed) and
 * `scenar render` (video) — this stays declarative. Cursor targets referenced
 * by the steps' interactions: `library` and `create-agent` come from the
 * shared chrome, `artifact-widget` from the widget rail, and
 * `apply-resource-button` from the real ArtifactPreviewContent itself.
 */
export function renderStep(data: AgentCreationTourStep): ReactNode {
  switch (data.view) {
    case "library-click":
      return (
        <AppShell highlightNav="library" contentKey="home">
          <div style={HOME_HINT}>Start a new session</div>
        </AppShell>
      );

    case "agents-list":
      return (
        <AppShell activeNav="library" contentKey="agents" slideDirection="forward">
          <ResourceListPage
            title="Agents"
            createLabel="Add Agent"
            cursorTarget="create-agent"
            items={EXISTING_AGENTS}
            layout="grid"
          />
        </AppShell>
      );

    case "create-agent-click":
      return (
        <AppShell activeNav="library" contentKey="agents">
          <ResourceListPage
            title="Agents"
            createLabel="Add Agent"
            cursorTarget="create-agent"
            items={EXISTING_AGENTS}
            layout="grid"
            highlightCreate
          />
        </AppShell>
      );

    case "composer-ready":
      return (
        <AppShell activeNav="library" contentKey="composer" slideDirection="forward">
          <ComposerView agentRef={AGENT_CREATOR_REF} />
        </AppShell>
      );

    case "conversation":
    case "artifact-click":
      return (
        <AppShell
          activeNav="library"
          contentKey="composer"
          aside={renderWidgetsSidebar(data.execution)}
        >
          <ComposerView execution={data.execution} />
        </AppShell>
      );

    case "artifact-preview":
    case "apply-agent":
      return (
        <AppShell
          activeNav="library"
          contentKey="composer"
          aside={renderWidgetsSidebar(data.execution)}
        >
          <div style={PREVIEW_UNDERLAY}>
            <ComposerView execution={data.execution} />
          </div>
          <div style={PREVIEW_SCRIM}>
            <div style={{ zoom: DEMO_CONTENT_ZOOM }}>
              <div style={PREVIEW_CARD}>
                <ArtifactPreviewContent
                  artifact={firstArtifact(data.execution)}
                  executionId={data.execution.metadata!.id}
                  org={DEMO_ORG}
                  isTerminal
                  onClose={noop}
                  className="agent-tour-preview"
                />
              </div>
            </div>
          </div>
        </AppShell>
      );

    case "library-complete":
      return (
        <AppShell activeNav="library" contentKey="agents" slideDirection="backward">
          <ResourceListPage
            title="Agents"
            createLabel="Add Agent"
            cursorTarget="create-agent"
            items={ALL_AGENTS}
            layout="grid"
            showNewItem
          />
        </AppShell>
      );
  }
}
