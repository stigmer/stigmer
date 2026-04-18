"use client";

import { useCallback, useRef, useState } from "react";
import { ArtifactPreviewContent } from "@stigmer/react";
import { samples } from "@stigmer/react/test";
import { PreviewProvider } from "@scenar/preview/runtime";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import { create } from "@bufbuild/protobuf";
import { GetArtifactContentResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ScenarioPlayer, useNarrationManifest, Cursor } from "@scenar/react";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { connectFixture } from "../../shared/preview-helpers";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { ResourceListPage } from "../../views/ResourceListPage";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import { DEMO_CONTENT_ZOOM } from "../../shared/tokens";
import { DEMO_ORG } from "../../fixtures";
import {
  type McpCreationStep,
  mcpCreationTourSteps,
  MCP_SERVER_YAML,
} from "./steps";

const noop = () => {};
const MCP_SERVER_CREATOR_REF = { org: "demo-org", slug: "mcp-server-creator" };

function firstArtifact(execution: AgentExecution) {
  return execution.status!.artifacts[0];
}

const EXISTING_SERVERS = [
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000001",
    kind: ApiResourceKind.mcp_server,
    name: "GitHub",
    slug: "github",
    description: "Repository management, issues, and pull requests.",
  }),
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000002",
    kind: ApiResourceKind.mcp_server,
    name: "Slack Notifications",
    slug: "slack-notifications",
    description: "Send messages and manage channels via Slack API.",
  }),
];

const ALL_SERVERS = [
  ...EXISTING_SERVERS,
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000003",
    kind: ApiResourceKind.mcp_server,
    name: "Order Management API",
    slug: "order-management-api",
    description:
      "REST API for order lookup, inventory, and return processing.",
  }),
];

const yamlBytes = new TextEncoder().encode(MCP_SERVER_YAML);

const previewFixtures = [
  connectFixture(AgentExecutionQueryController, "getArtifactContent", () =>
    create(GetArtifactContentResponseSchema, {
      content: yamlBytes,
      contentType: "text/yaml",
      totalSizeBytes: BigInt(yamlBytes.length),
      truncated: false,
    }),
  ),
];

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
    case "apply-mcp-server":
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
    case "apply-mcp-server":
      return "apply-resource-button";
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
            <p className="text-xs text-muted-foreground">
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
          <ResourceListPage
            title="MCP Servers"
            createLabel="Add MCP Server"
            cursorTarget="create-mcp-server"
            items={EXISTING_SERVERS}
            layout="grid"
          />
        </AppShell>
      );

    case "create-mcp-server-click":
      return (
        <AppShell activeNav="library" contentKey={contentKey}>
          <ResourceListPage
            title="MCP Servers"
            createLabel="Add MCP Server"
            cursorTarget="create-mcp-server"
            items={EXISTING_SERVERS}
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
    case "apply-mcp-server":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          aside={renderWidgetsSidebar(step.execution)}
        >
          <div className="absolute inset-0 overflow-hidden">
            <ComposerView execution={step.execution} />
          </div>
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <div style={{ zoom: DEMO_CONTENT_ZOOM }}>
              <div className="w-[36rem] rounded-lg border border-border bg-background shadow-lg">
                <ArtifactPreviewContent
                  artifact={firstArtifact(step.execution)}
                  executionId={step.execution.metadata!.id}
                  org={DEMO_ORG}
                  isTerminal
                  onClose={noop}
                />
              </div>
            </div>
          </div>
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
            title="MCP Servers"
            createLabel="Add MCP Server"
            cursorTarget="create-mcp-server"
            items={ALL_SERVERS}
            layout="grid"
            showNewItem
          />
        </AppShell>
      );
  }
}

export function McpServerCreationTour() {
  const narrationManifest = useNarrationManifest("mcp-server-creation-tour");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback((step: McpCreationStep) => {
    setCursorTarget(cursorTargetFor(step));
  }, []);

  return (
    <PreviewProvider providers={PreviewProviders} fixtures={previewFixtures}>
      <StigmerDemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={mcpCreationTourSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => renderStep(step)}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </StigmerDemoViewport>
    </PreviewProvider>
  );
}
