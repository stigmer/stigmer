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
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import {
  type StepInteractions,
  useStepInteractions,
} from "../../engine/useStepInteractions";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { CodeEditorView, type FileTreeEntry } from "../../views/CodeEditorView";
import { TerminalView } from "../../views/TerminalView";
import { DEMO_CONTENT_ZOOM, DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import {
  type ConnectToolsTourStep,
  connectToolsTourSteps,
  toolsOnlyServer,
  withPoliciesServer,
  DEMO_ORG,
  DEMO_SLUG,
  MCP_REFS_CODE,
  ORDER_OUTPUT,
} from "./steps";

const emptyEnvList = () => create(EnvironmentListSchema, {});
const noop = () => {};

function buildClient(server: McpServer) {
  return createDemoClient(
    buildScenario(
      fixtures.mcpServer.getByReference(() => server),
      fixtures.environment.list(emptyEnvList),
    ),
  );
}

const FILE_TREE: FileTreeEntry[] = [
  { name: "ask-agent.ts", type: "file", depth: 0 },
  { name: "package.json", type: "file", depth: 0 },
  { name: "tsconfig.json", type: "file", depth: 0 },
];

// ---------------------------------------------------------------------------
// Tab selection for McpServerDetailView steps
// ---------------------------------------------------------------------------

function defaultTabFor(step: ConnectToolsTourStep): "tools" | "policies" {
  return step.view === "policies-generated" ? "policies" : "tools";
}

function componentKeyFor(step: ConnectToolsTourStep): string {
  switch (step.view) {
    case "tools-discovered":
      return "tools";
    case "policies-generated":
      return "policies";
    default:
      return "other";
  }
}

// ---------------------------------------------------------------------------
// Step renderer (uses McpServerDetailView client from the map)
// ---------------------------------------------------------------------------

function renderMcpDetailStep(
  step: ConnectToolsTourStep & { server: McpServer },
  clientMap: Map<McpServer, ReturnType<typeof buildClient>>,
) {
  return (
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
            {/* Sentinel for scroll-to interactions — tools & policies are at the bottom */}
            <div data-scroll-target="capabilities-bottom" />
          </div>
        </div>
      </AppShell>
    </StigmerProvider>
  );
}

// ---------------------------------------------------------------------------
// Mid-step interactions
// ---------------------------------------------------------------------------

const INTERACTIONS: StepInteractions = {
  0: [
    { atPercent: 0.25, type: "scroll-to", target: "capabilities-bottom" },
  ],
  1: [
    { atPercent: 0.25, type: "scroll-to", target: "capabilities-bottom" },
  ],
};

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Connect Tools overview tour for the "What you'll build" section.
 *
 * Six-step multi-surface preview: discover tools on MCP server →
 * generate approval policies → add mcpServerRefs to code →
 * terminal with real order data → approval card → approved result.
 */
export function ConnectToolsTour() {
  const clientMap = useMemo(() => {
    const map = new Map<McpServer, ReturnType<typeof buildClient>>();
    map.set(toolsOnlyServer, buildClient(toolsOnlyServer));
    map.set(withPoliciesServer, buildClient(withPoliciesServer));
    return map;
  }, []);

  const conversationClient = useMemo(
    () => createDemoClient({ fixtures: new Map() }),
    [],
  );

  const narrationManifest = useNarrationManifest("connect-tools-tour");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (_step: ConnectToolsTourStep, index: number) => {
      setCursorTarget(undefined);
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
    steps: connectToolsTourSteps,
  });

  return (
    <div ref={containerRef} className={DEMO_PLAYER_CLASSES}>
      <ScenarioPlayer
        steps={connectToolsTourSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => {
          switch (step.view) {
            case "tools-discovered":
            case "policies-generated":
              return renderMcpDetailStep(step, clientMap);

            case "code-mcp-refs":
              return (
                <CodeEditorView
                  filename="ask-agent.ts"
                  lines={MCP_REFS_CODE}
                  highlightLines={[11]}
                  fileTree={FILE_TREE}
                  workspaceName="stigmer-quickstart"
                  contentKey="mcp-refs"
                />
              );

            case "terminal-order":
              return (
                <TerminalView
                  title="Terminal — zsh"
                  cwd="~/stigmer-quickstart"
                  lines={ORDER_OUTPUT}
                  contentKey="order"
                />
              );

            case "approval-card":
              return (
                <StigmerProvider client={conversationClient}>
                  <AppShell
                    activeNav="new-session"
                    contentKey="approval"
                    aside={renderWidgetsSidebar(step.execution)}
                  >
                    <ComposerView
                      execution={step.execution}
                      onApprovalSubmit={noop}
                    />
                  </AppShell>
                </StigmerProvider>
              );

            case "approved":
              return (
                <StigmerProvider client={conversationClient}>
                  <AppShell
                    activeNav="new-session"
                    contentKey="approved"
                    aside={renderWidgetsSidebar(step.execution)}
                  >
                    <ComposerView execution={step.execution} />
                  </AppShell>
                </StigmerProvider>
              );
          }
        }}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </div>
  );
}
