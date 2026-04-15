"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { StigmerProvider, McpServerDetailView } from "@stigmer/react";
import {
  createDemoClient,
  buildScenario,
  fixtures,
} from "@stigmer/react/demo";
import { create } from "@bufbuild/protobuf";
import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { AppShell } from "../../views/AppShell";
import { ResourceListPage } from "../../views/ResourceListPage";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import {
  type StepInteractions,
  useStepInteractions,
} from "../../engine/useStepInteractions";
import { DEMO_CONTENT_ZOOM, DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import {
  type MarketplaceConnectStep,
  marketplaceConnectSteps,
  DEMO_ORG,
  DEMO_SLUG,
} from "./steps";

const emptyEnvList = () => create(EnvironmentListSchema, {});

function buildClient(server: McpServer) {
  return createDemoClient(
    buildScenario(
      fixtures.mcpServer.getByReference(() => server),
      fixtures.environment.list(emptyEnvList),
    ),
  );
}

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

// ---------------------------------------------------------------------------
// Mid-step interactions
// ---------------------------------------------------------------------------

const INTERACTIONS: StepInteractions = {
  2: [
    { atPercent: 0.4, type: "scroll-to", target: "capabilities-bottom" },
  ],
  4: [
    { atPercent: 0.3, type: "scroll-to", target: "capabilities-bottom" },
  ],
};

export function MarketplaceConnectTour() {
  const narrationManifest = useNarrationManifest(
    "marketplace-connect-tour",
  );

  const clientMap = useMemo(() => {
    const map = new Map<McpServer, ReturnType<typeof buildClient>>();
    for (const step of marketplaceConnectSteps) {
      const data = step.data;
      if ("server" in data && !map.has(data.server)) {
        map.set(data.server, buildClient(data.server));
      }
    }
    return map;
  }, []);

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
    interactions: INTERACTIONS,
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: marketplaceConnectSteps,
  });

  return (
    <div ref={containerRef} className={DEMO_PLAYER_CLASSES}>
      <ScenarioPlayer
        steps={marketplaceConnectSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => {
          if (step.view === "grid-browse" || step.view === "grid-select") {
            return renderGridStep(step);
          }

          const client = clientMap.get(step.server)!;
          return (
            <AppShell
              activeNav="library"
              contentKey={contentKeyFor(step)}
              slideDirection={slideDirectionFor(step)}
            >
              <StigmerProvider
                key={componentKeyFor(step)}
                client={client}
              >
                <div
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
              </StigmerProvider>
            </AppShell>
          );
        }}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </div>
  );
}
