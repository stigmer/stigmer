"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { StigmerProvider } from "@stigmer/react";
import {
  createDemoClient,
  fixtures,
  buildScenario,
} from "@stigmer/react/demo";
import { create } from "@bufbuild/protobuf";
import { GetArtifactContentResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { Cursor } from "../../engine/Cursor";
import { AppShell } from "../../views/AppShell";
import { ComposerView, type ArtifactMeta } from "../../views/ComposerView";
import { McpServersListView } from "../../views/McpServersListView";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import {
  type McpCreationStep,
  mcpCreationTourSteps,
  MCP_SERVER_YAML,
} from "./steps";

const MCP_SERVER_CREATOR_REF = { org: "demo-org", slug: "mcp-server-creator" };

const MCP_SERVER_ARTIFACT_META: ArtifactMeta = {
  icon: "file",
  name: "order-management-api",
  label: "MCP Server",
  title: "Order Management API",
  description:
    "REST API for order lookup, inventory checks, and return processing.",
  fileName: "mcp-server.yaml",
  contentType: "text/yaml",
  pushLabel: "Push MCP Server to acme",
};

const yamlBytes = new TextEncoder().encode(MCP_SERVER_YAML);

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

function contentKeyFor(step: McpCreationStep): string {
  switch (step.view) {
    case "library-click":
      return "home";
    case "mcp-servers-list":
    case "create-mcp-server-click":
    case "library-complete":
      return "mcp-servers";
    case "composer-ready":
    case "conversation":
    case "artifact-click":
    case "artifact-preview":
    case "push-mcp-server":
      return "composer";
  }
}

function slideDirectionFor(
  step: McpCreationStep,
): "forward" | "backward" | undefined {
  switch (step.view) {
    case "mcp-servers-list":
      return "forward";
    case "composer-ready":
      return "forward";
    case "library-complete":
      return "backward";
    default:
      return undefined;
  }
}

function cursorTargetFor(step: McpCreationStep): string | undefined {
  switch (step.view) {
    case "library-click":
      return "library";
    case "create-mcp-server-click":
      return "create-mcp-server";
    case "artifact-click":
      return "artifact-widget";
    case "push-mcp-server":
      return "push-button";
    default:
      return undefined;
  }
}

function renderStep(step: McpCreationStep) {
  const contentKey = contentKeyFor(step);
  const slide = slideDirectionFor(step);

  switch (step.view) {
    case "library-click":
      return (
        <AppShell highlightNav="library" contentKey={contentKey}>
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-[10px] text-muted-foreground">
              Start a new session
            </p>
          </div>
        </AppShell>
      );

    case "mcp-servers-list":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
        >
          <McpServersListView />
        </AppShell>
      );

    case "create-mcp-server-click":
      return (
        <AppShell activeNav="library" contentKey={contentKey}>
          <McpServersListView highlightCreate />
        </AppShell>
      );

    case "composer-ready":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
        >
          <ComposerView agentRef={MCP_SERVER_CREATOR_REF} />
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
            artifactMeta={MCP_SERVER_ARTIFACT_META}
          />
        </AppShell>
      );

    case "push-mcp-server":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          aside={renderWidgetsSidebar(step.execution)}
        >
          <ComposerView
            execution={step.execution}
            artifactContent={MCP_SERVER_YAML}
            artifactMeta={MCP_SERVER_ARTIFACT_META}
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
          <McpServersListView showNewServer />
        </AppShell>
      );
  }
}

export function McpServerCreationTour() {
  const client = useMemo(() => createDemoClient(buildDemoScenario()), []);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback((step: McpCreationStep) => {
    setCursorTarget(cursorTargetFor(step));
  }, []);

  return (
    <StigmerProvider client={client}>
      <div ref={containerRef} className={DEMO_PLAYER_CLASSES}>
        <ScenarioPlayer
          steps={mcpCreationTourSteps}
          onStepChange={handleStepChange}
        >
          {(step) => renderStep(step)}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </div>
    </StigmerProvider>
  );
}
