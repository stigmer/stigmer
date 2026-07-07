"use client";

import { useCallback, useRef, useState } from "react";
import { AgentDetailView } from "@stigmer/react";
import { PreviewProvider } from "@scenar/preview/runtime";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { ScenarioPlayer, useNarrationManifest, Cursor, useStepInteractions, CodeEditorView, TerminalView } from "@scenar/react";
import type { FileTreeEntry } from "@scenar/react";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { connectFixture } from "@scenar/preview/connect";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { DEMO_CONTENT_ZOOM } from "../../shared/tokens";
import { DemoDetailShell } from "../../shared/DemoDetailShell";
import {
  type CreateAgentTourStep,
  createAgentTourSteps,
  buildDemoAgent,
  DEMO_ORG,
  DEMO_SLUG,
  SIMPLIFIED_CODE,
  RESULT_OUTPUT,
} from "./steps";

const demoAgent = buildDemoAgent();

const previewFixtures = [
  connectFixture(AgentQueryController, "getByReference", () => demoAgent),
];

const FILE_TREE: FileTreeEntry[] = [
  { name: "ask-agent.ts", type: "file", depth: 0 },
  { name: "package.json", type: "file", depth: 0 },
  { name: "tsconfig.json", type: "file", depth: 0 },
];

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Create Agent overview tour for the "What you'll build" section.
 *
 * Five-step multi-surface preview: Agent Creator conversation →
 * agent definition artifact → real AgentDetailView → simplified
 * code → terminal result. Uses the real AgentDetailView from
 * @stigmer/react backed by fixture data.
 */
export function CreateAgentTour() {
  const narrationManifest = useNarrationManifest("create-agent-tour");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (_step: CreateAgentTourStep, index: number) => {
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
    steps: createAgentTourSteps,
  });

  return (
    <PreviewProvider providers={PreviewProviders} fixtures={previewFixtures}>
      <StigmerDemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={createAgentTourSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => {
            switch (step.view) {
              case "agent-creator-typing":
                return (
                  <AppShell activeNav="new-session" contentKey="creator">
                    <ComposerView
                      typingMessage="I want to create a customer support agent. It should use the return-policy skill and the order-management-api MCP server."
                    />
                  </AppShell>
                );

              case "agent-created":
                return (
                  <AppShell activeNav="new-session" contentKey="created">
                    <ComposerView execution={step.execution} />
                  </AppShell>
                );

              case "agent-config":
                return (
                  <DemoDetailShell>
                    <div
                      data-scroll-container
                      className="h-full overflow-y-auto p-4"
                      style={{ zoom: DEMO_CONTENT_ZOOM }}
                    >
                      <AgentDetailView org={DEMO_ORG} slug={DEMO_SLUG} />
                    </div>
                  </DemoDetailShell>
                );

              case "code-simplified":
                return (
                  <CodeEditorView
                    filename="ask-agent.ts"
                    lines={SIMPLIFIED_CODE}
                    highlightLines={[8, 9, 10]}
                    fileTree={FILE_TREE}
                    workspaceName="stigmer-quickstart"
                    contentKey="simplified"
                  />
                );

              case "terminal-result":
                return (
                  <TerminalView
                    title="Terminal — zsh"
                    cwd="~/stigmer-quickstart"
                    lines={RESULT_OUTPUT}
                    contentKey="result"
                  />
                );
            }
          }}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </StigmerDemoViewport>
    </PreviewProvider>
  );
}
