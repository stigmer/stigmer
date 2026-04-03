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
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import { DEMO_CONTENT_ZOOM, DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import {
  type GeneratePoliciesStep,
  generatePoliciesSteps,
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

function cursorTargetFor(step: GeneratePoliciesStep): string | undefined {
  switch (step.view) {
    case "click-policies-tab":
      return "tab-policies";
    case "click-generate":
      return "generate-policies-button";
    default:
      return undefined;
  }
}

function defaultTabFor(step: GeneratePoliciesStep): "tools" | "policies" {
  switch (step.view) {
    case "tools-overview":
    case "scroll-to-capabilities":
    case "click-policies-tab":
      return "tools";
    default:
      return "policies";
  }
}

/**
 * Compute a stable React key that only changes when the component
 * state needs to reinitialize (different tab, different server).
 * Steps that only differ in scroll position or cursor share the
 * same key so the component stays mounted and scroll persists.
 */
function componentKeyFor(step: GeneratePoliciesStep): string {
  switch (step.view) {
    case "tools-overview":
    case "scroll-to-capabilities":
    case "click-policies-tab":
      return "tools";
    case "no-policies":
    case "click-generate":
      return "policies";
    case "policies-applied":
      return "policies-done";
  }
}

export function GeneratePoliciesPlayback() {
  const narrationManifest = useNarrationManifest("generate-policies-playback");
  const clientMap = useMemo(() => {
    const map = new Map<McpServer, ReturnType<typeof buildClient>>();
    for (const step of generatePoliciesSteps) {
      if (!map.has(step.data.server)) {
        map.set(step.data.server, buildClient(step.data.server));
      }
    }
    return map;
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback((step: GeneratePoliciesStep) => {
    setCursorTarget(cursorTargetFor(step));

    if (step.view === "scroll-to-capabilities") {
      setTimeout(() => {
        const scrollEl = containerRef.current?.querySelector(
          "[data-scroll-container]",
        );
        if (scrollEl) {
          scrollEl.scrollTo({
            top: scrollEl.scrollHeight,
            behavior: "smooth",
          });
        }
      }, 50);
    }
  }, []);

  return (
    <div ref={containerRef} className={DEMO_PLAYER_CLASSES}>
      <ScenarioPlayer
        steps={generatePoliciesSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => (
          <StigmerProvider
            key={componentKeyFor(step)}
            client={clientMap.get(step.server)!}
          >
            <AppShell activeNav="library" contentKey="mcp-detail">
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
                </div>
              </div>
            </AppShell>
          </StigmerProvider>
        )}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </div>
  );
}
