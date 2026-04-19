"use client";

import { useCallback, useRef, useState } from "react";
import { McpServerDetailView } from "@stigmer/react";
import { PreviewProvider } from "@scenar/preview/runtime";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { create } from "@bufbuild/protobuf";
import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { ScenarioPlayer, useNarrationManifest, Cursor, useStepInteractions, CodeEditorView, TerminalView } from "@scenar/react";
import type { FileTreeEntry } from "@scenar/react";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { connectFixture } from "@scenar/preview/connect";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { DEMO_CONTENT_ZOOM, DEMO_TERMINAL_MAX_WIDTH } from "../../shared/tokens";
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

const previewFixtures = [
  connectFixture(McpServerQueryController, "getByReference", () => connectedServer),
  connectFixture(EnvironmentQueryController, "list", emptyEnvList),
];

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
// Step renderer (uses McpServerDetailView via MSW fixtures)
// ---------------------------------------------------------------------------

function renderMcpDetailStep(step: ConnectToolsTourStep) {
  return (
    <AppShell activeNav="library" contentKey="mcp-detail">
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
            defaultCapabilityTab="policies"
          />
          <div data-scroll-target="capabilities-bottom" />
        </div>
      </div>
    </AppShell>
  );
}

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
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: connectToolsTourSteps,
  });

  return (
    <PreviewProvider providers={PreviewProviders} fixtures={previewFixtures}>
      <StigmerDemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={connectToolsTourSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => {
            switch (step.view) {
              case "connected":
                return renderMcpDetailStep(step);

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
                    maxWidth={DEMO_TERMINAL_MAX_WIDTH}
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
                    <ComposerView
                      execution={step.execution}
                      onApprovalSubmit={noop}
                    />
                  </AppShell>
                );

              case "approved":
                return (
                  <AppShell
                    activeNav="new-session"
                    contentKey="approved"
                    aside={renderWidgetsSidebar(step.execution)}
                  >
                    <ComposerView execution={step.execution} />
                  </AppShell>
                );
            }
          }}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </StigmerDemoViewport>
    </PreviewProvider>
  );
}
