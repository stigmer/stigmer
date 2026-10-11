"use client";

/**
 * Renders the marketplace connect tour: the Plugins grid, then the real
 * `PluginDetailView` for Neon over preview fixtures (the plugin's read, My
 * vault's read, and the server's tools listing).
 *
 * The tools beat is the real "Check tools": `RealButtonTarget` tags the
 * button for the cursor on the beat before, and on the tools beat (a fresh
 * mount) presses it, so `usePluginTools` asks `listTools` and the fixture
 * answers. Every other beat is the page as it loads.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { PluginDetailView } from "@stigmer/react";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import {
  ScenarioPlayer,
  useNarrationManifest,
  Cursor,
  useStepInteractions,
} from "@scenar/react";
import { myVaultHolding } from "../../fixtures";
import { StigmerPreviewProvider } from "../../shared/StigmerPreviewProvider";
import { RealButtonTarget } from "../../shared/RealButtonTarget";
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
  NEON_KEY,
  NEON_PLUGIN,
  NEON_TOOLS,
} from "./steps";

function cursorTargetFor(step: MarketplaceConnectStep): string | undefined {
  switch (step.view) {
    case "grid-select":
      return step.targetSlug;
    case "click-check-tools":
      return "check-tools";
    default:
      return undefined;
  }
}

function contentKeyFor(step: MarketplaceConnectStep): string {
  switch (step.view) {
    case "grid-browse":
    case "grid-select":
      return "plugins-grid";
    case "plugin-detail":
    case "click-check-tools":
    case "tools-listed":
      return "plugin-detail";
  }
}

function slideDirectionFor(
  step: MarketplaceConnectStep,
): "forward" | "backward" | undefined {
  if (step.view === "plugin-detail") return "forward";
  return undefined;
}

/** The page stays mounted until the tools beat, whose fresh mount presses Check tools. */
function componentKeyFor(step: MarketplaceConnectStep): string {
  return step.view === "tools-listed" ? "tools-listed" : "plugin-detail";
}

function renderGridStep(step: MarketplaceConnectStep) {
  if (step.view !== "grid-browse" && step.view !== "grid-select") return null;
  return (
    <AppShell
      activeNav="library"
      contentKey={contentKeyFor(step)}
    >
      <ResourceListPage
        title="Plugins"
        createLabel="Add MCP server"
        cursorTarget="add-mcp-server"
        items={step.plugins}
        layout="grid"
      />
    </AppShell>
  );
}

export function MarketplaceConnectTour() {
  const narrationManifest = useNarrationManifest(
    "marketplace-connect-tour",
  );

  const previewFixtures = useMemo(
    () => [
      connectFixture(PluginQueryController, "getByReference", () => NEON_PLUGIN),
      connectFixture(VaultQueryController, "getMine", () =>
        myVaultHolding(NEON_KEY, "Neon API key"),
      ),
      connectFixture(PluginCommandController, "listTools", () => NEON_TOOLS),
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
    <StigmerPreviewProvider fixtures={previewFixtures}>
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
                    <RealButtonTarget
                      label="Check tools"
                      target="check-tools"
                      press={step.view === "tools-listed"}
                    >
                      <PluginDetailView org={DEMO_ORG} slug={DEMO_SLUG} />
                    </RealButtonTarget>
                    <div data-scroll-target="plugin-bottom" />
                  </div>
                </div>
              </AppShell>
            );
          }}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </StigmerDemoViewport>
    </StigmerPreviewProvider>
  );
}
