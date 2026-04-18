"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { McpServerDetailView } from "@stigmer/react";
import { PreviewProvider } from "@scenar/preview/runtime";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { create } from "@bufbuild/protobuf";
import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  ScenarioPlayer,
  useNarrationManifest,
  Cursor,
  useStepInteractions,
} from "@scenar/react";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { connectFixture } from "@scenar/preview/connect";
import { AppShell } from "../../views/AppShell";
import { ResourceListPage } from "../../views/ResourceListPage";
import { DEMO_CONTENT_ZOOM } from "../../shared/tokens";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import {
  type MarketplaceConnectStep,
  marketplaceConnectSteps,
  DEMO_ORG,
  DEMO_SLUG,
} from "./steps";

const emptyEnvList = () => create(EnvironmentListSchema, {});

function cursorTargetFor(step: MarketplaceConnectStep): string | undefined {
  switch (step.view) {
    case "grid-select":
      return step.targetSlug;
    case "click-connect":
      return "connect-button";
    case "connected-policies":
      return "tab-policies";
    default:
      return undefined;
  }
}

function defaultTabFor(step: MarketplaceConnectStep): "tools" | "policies" {
  return step.view === "connected-policies" ? "policies" : "tools";
}

function contentKeyFor(step: MarketplaceConnectStep): string {
  switch (step.view) {
    case "grid-browse":
    case "grid-select":
      return "mcp-servers-grid";
    case "detail-view":
    case "click-connect":
    case "connected-tools":
    case "connected-policies":
      return "mcp-detail";
  }
}

function slideDirectionFor(
  step: MarketplaceConnectStep,
): "forward" | "backward" | undefined {
  if (step.view === "detail-view") return "forward";
  return undefined;
}

function componentKeyFor(step: MarketplaceConnectStep): string {
  switch (step.view) {
    case "grid-browse":
    case "grid-select":
      return "grid";
    case "detail-view":
    case "click-connect":
      return "detail-base";
    case "connected-tools":
      return "connected-tools";
    case "connected-policies":
      return "connected-policies";
  }
}

function renderGridStep(step: MarketplaceConnectStep) {
  if (step.view !== "grid-browse" && step.view !== "grid-select") return null;
  return (
    <AppShell
      activeNav="library"
      contentKey={contentKeyFor(step)}
    >
      <ResourceListPage
        title="MCP Servers"
        createLabel="Add MCP Server"
        cursorTarget="create-mcp-server"
        items={step.servers}
        layout="grid"
      />
    </AppShell>
  );
}

export function MarketplaceConnectTour() {
  const narrationManifest = useNarrationManifest(
    "marketplace-connect-tour",
  );

  const currentServerRef = useRef<McpServer>(null!);

  const previewFixtures = useMemo(
    () => [
      connectFixture(McpServerQueryController, "getByReference", () => currentServerRef.current),
      connectFixture(EnvironmentQueryController, "list", emptyEnvList),
    ],
    [],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (step: MarketplaceConnectStep, index: number) => {
      setCursorTarget(cursorTargetFor(step));
      setStepIndex(index);
    },
    [],
  );

  useStepInteractions({
    stepIndex,
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: marketplaceConnectSteps,
  });

  return (
    <PreviewProvider providers={PreviewProviders} fixtures={previewFixtures}>
      <StigmerDemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={marketplaceConnectSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => {
            if (step.view === "grid-browse" || step.view === "grid-select") {
              return renderGridStep(step);
            }

            currentServerRef.current = step.server;
            return (
              <AppShell
                activeNav="library"
                contentKey={contentKeyFor(step)}
                slideDirection={slideDirectionFor(step)}
              >
                <div
                  key={componentKeyFor(step)}
                  data-scroll-container
                  className="h-full overflow-y-auto"
                  style={{ zoom: DEMO_CONTENT_ZOOM }}
                >
                  <div className="p-4">
                    <McpServerDetailView
                      org={DEMO_ORG}
                      slug={DEMO_SLUG}
                      defaultCapabilityTab={defaultTabFor(step)}
                    />
                    <div data-scroll-target="capabilities-bottom" />
                  </div>
                </div>
              </AppShell>
            );
          }}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </StigmerDemoViewport>
    </PreviewProvider>
  );
}
