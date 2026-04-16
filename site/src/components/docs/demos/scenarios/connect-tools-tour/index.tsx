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
import { DemoViewport } from "../../engine/DemoViewport";
import { DEMO_CONTENT_ZOOM } from "../../shared/tokens";
import {
  type ConnectToolsTourStep,
  connectToolsTourSteps,
  connectedServer,
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

function componentKeyFor(step: ConnectToolsTourStep): string {
  return step.view === "connected" ? "connected" : "other";
}

// ---------------------------------------------------------------------------
// Step renderer (uses McpServerDetailView client from the map)
// ---------------------------------------------------------------------------

function renderMcpDetailStep(
  step: ConnectToolsTourStep & { server: McpServer },
  clientMap: Map<McpServer, ReturnType<typeof buildClient>>,
) {
  return (
    <AppShell activeNav="library" contentKey="mcp-detail">
      <StigmerProvider
        key={componentKeyFor(step)}
        client={clientMap.get(step.server)!}
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
              defaultCapabilityTab="policies"
            />
            <div data-scroll-target="capabilities-bottom" />
          </div>
        </div>
      </StigmerProvider>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Mid-step interactions
// ---------------------------------------------------------------------------

const INTERACTIONS: StepInteractions = {
  0: [
    { atPercent: 0.25, type: "scroll-to", target: "capabilities-bottom" },
  ],
};

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Connect Tools overview tour for the "What you'll build" section.
 *
 * Five-step multi-surface preview: connect MCP server (tools + policies) →
 * add mcpServerRefs to code → terminal with real order data →
 * approval card → approved result.
 */
export function ConnectToolsTour() {
  const clientMap = useMemo(() => {
    const map = new Map<McpServer, ReturnType<typeof buildClient>>();
    map.set(connectedServer, buildClient(connectedServer));
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
    <DemoViewport containerRef={containerRef}>
      <ScenarioPlayer
        steps={connectToolsTourSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => {
          switch (step.view) {
            case "connected":
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
                <AppShell
                  activeNav="new-session"
                  contentKey="approval"
                  aside={renderWidgetsSidebar(step.execution)}
                >
                  <StigmerProvider client={conversationClient}>
                    <ComposerView
                      execution={step.execution}
                      onApprovalSubmit={noop}
                    />
                  </StigmerProvider>
                </AppShell>
              );

            case "approved":
              return (
                <AppShell
                  activeNav="new-session"
                  contentKey="approved"
                  aside={renderWidgetsSidebar(step.execution)}
                >
                  <StigmerProvider client={conversationClient}>
                    <ComposerView execution={step.execution} />
                  </StigmerProvider>
                </AppShell>
              );
          }
        }}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </DemoViewport>
  );
}
