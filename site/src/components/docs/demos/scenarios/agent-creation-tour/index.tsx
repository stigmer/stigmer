"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { StigmerProvider } from "@stigmer/react";
import {
  createDemoClient,
  fixtures,
  buildScenario,
  samples,
} from "@stigmer/react/demo";
import { create } from "@bufbuild/protobuf";
import { GetArtifactContentResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import { AppShell } from "../../views/AppShell";
import { ComposerView, type ArtifactMeta } from "../../views/ComposerView";
import { ResourceListPage } from "../../views/ResourceListPage";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import {
  type AgentCreationStep,
  agentCreationTourSteps,
  AGENT_YAML,
} from "./steps";

const AGENT_CREATOR_REF = { org: "demo-org", slug: "agent-creator" };

const EXISTING_AGENTS = [
  samples.searchResult({
    id: "agt-00000000-0000-0000-0000-000000000001",
    kind: ApiResourceKind.agent,
    name: "assistant",
    slug: "assistant",
    description: "General-purpose AI assistant.",
  }),
];

const ALL_AGENTS = [
  ...EXISTING_AGENTS,
  samples.searchResult({
    id: "agt-00000000-0000-0000-0000-000000000002",
    kind: ApiResourceKind.agent,
    name: "Support Agent",
    slug: "support-agent",
    description:
      "Handles customer support requests — answers questions using company knowledge, looks up orders, and processes returns with human approval.",
  }),
];

const AGENT_ARTIFACT_META: ArtifactMeta = {
  icon: "file",
  name: "support-agent",
  label: "Agent",
  title: "Support Agent",
  description:
    "Handles customer support requests — answers questions using company knowledge, looks up orders, and processes returns with human approval.",
  fileName: "agent.yaml",
  contentType: "text/yaml",
  pushLabel: "Apply Agent to acme",
};

const yamlBytes = new TextEncoder().encode(AGENT_YAML);

function buildDemoScenario() {
  return buildScenario(
    fixtures.agentExecution.getArtifactContent(() =>
      create(GetArtifactContentResponseSchema, {
        content: yamlBytes,
        contentType: "text/yaml",
        totalSizeBytes: BigInt(yamlBytes.length),
        truncated: false,
      }),
    ),
  );
}

function contentKeyFor(step: AgentCreationStep): string {
  switch (step.view) {
    case "library-click":
      return "home";
    case "agents-list":
    case "create-agent-click":
    case "library-complete":
      return "agents";
    case "composer-ready":
    case "conversation":
    case "artifact-click":
    case "artifact-preview":
    case "apply-agent":
      return "composer";
  }
}

function slideDirectionFor(
  step: AgentCreationStep,
): "forward" | "backward" | undefined {
  switch (step.view) {
    case "agents-list":
      return "forward";
    case "composer-ready":
      return "forward";
    case "library-complete":
      return "backward";
    default:
      return undefined;
  }
}

function cursorTargetFor(step: AgentCreationStep): string | undefined {
  switch (step.view) {
    case "library-click":
      return "library";
    case "create-agent-click":
      return "create-agent";
    case "artifact-click":
      return "artifact-widget";
    case "apply-agent":
      return "push-button";
    default:
      return undefined;
  }
}

function renderStep(step: AgentCreationStep) {
  const contentKey = contentKeyFor(step);
  const slide = slideDirectionFor(step);

  switch (step.view) {
    case "library-click":
      return (
        <AppShell highlightNav="library" contentKey={contentKey}>
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-xs text-muted-foreground">
              Start a new session
            </p>
          </div>
        </AppShell>
      );

    case "agents-list":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
        >
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
        <AppShell activeNav="library" contentKey={contentKey}>
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
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
        >
          <ComposerView agentRef={AGENT_CREATOR_REF} />
        </AppShell>
      );

    case "conversation":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          aside={renderWidgetsSidebar(step.execution)}
        >
          <ComposerView execution={step.execution} />
        </AppShell>
      );

    case "artifact-click":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          aside={renderWidgetsSidebar(step.execution)}
        >
          <ComposerView execution={step.execution} />
        </AppShell>
      );

    case "artifact-preview":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          aside={renderWidgetsSidebar(step.execution)}
        >
          <ComposerView
            execution={step.execution}
            artifactContent={step.artifactContent}
            artifactMeta={AGENT_ARTIFACT_META}
          />
        </AppShell>
      );

    case "apply-agent":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          aside={renderWidgetsSidebar(step.execution)}
        >
          <ComposerView
            execution={step.execution}
            artifactContent={AGENT_YAML}
            artifactMeta={AGENT_ARTIFACT_META}
            pushState="ready"
          />
        </AppShell>
      );

    case "library-complete":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
        >
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

/**
 * Guided-tour demo for the "Create your Agent" docs page.
 *
 * Auto-plays a timed walkthrough of Agent creation in the Stigmer
 * web app. Uses the same three-layer visual storytelling pattern
 * as the Skill and MCP Server creation tours: captions, slide
 * transitions, and animated cursor with click ripple.
 */
export function AgentCreationTour() {
  const client = useMemo(() => createDemoClient(buildDemoScenario()), []);
  const narrationManifest = useNarrationManifest("agent-creation-tour");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback((step: AgentCreationStep) => {
    setCursorTarget(cursorTargetFor(step));
  }, []);

  return (
    <StigmerProvider client={client}>
      <div ref={containerRef} className={DEMO_PLAYER_CLASSES}>
        <ScenarioPlayer
          steps={agentCreationTourSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => renderStep(step)}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </div>
    </StigmerProvider>
  );
}
