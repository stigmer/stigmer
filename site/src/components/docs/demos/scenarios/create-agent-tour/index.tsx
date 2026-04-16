"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { StigmerProvider, AgentDetailView } from "@stigmer/react";
import {
  createDemoClient,
  buildScenario,
  fixtures,
} from "@stigmer/react/demo";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import {
  type StepInteractions,
  useStepInteractions,
} from "../../engine/useStepInteractions";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { CodeEditorView, type FileTreeEntry } from "../../views/CodeEditorView";
import { TerminalView } from "../../views/TerminalView";
import { DemoViewport } from "../../engine/DemoViewport";
import { DEMO_CONTENT_ZOOM } from "../../shared/tokens";
import { DEMO_DETAIL_CLASSES } from "../../shared/tokens";
import {
  type CreateAgentTourStep,
  createAgentTourSteps,
  buildDemoAgent,
  DEMO_ORG,
  DEMO_SLUG,
  SIMPLIFIED_CODE,
  RESULT_OUTPUT,
} from "./steps";

const FILE_TREE: FileTreeEntry[] = [
  { name: "ask-agent.ts", type: "file", depth: 0 },
  { name: "package.json", type: "file", depth: 0 },
  { name: "tsconfig.json", type: "file", depth: 0 },
];

// ---------------------------------------------------------------------------
// Mid-step interactions
// ---------------------------------------------------------------------------

const INTERACTIONS: StepInteractions = {};

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
  const conversationClient = useMemo(
    () => createDemoClient({ fixtures: new Map() }),
    [],
  );

  const agentClient = useMemo(() => {
    const agent = buildDemoAgent();
    const scenario = buildScenario(
      fixtures.agent.getByReference(() => agent),
    );
    return createDemoClient(scenario);
  }, []);

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
    interactions: INTERACTIONS,
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: createAgentTourSteps,
  });

  return (
    <DemoViewport containerRef={containerRef}>
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
                  <StigmerProvider client={conversationClient}>
                    <ComposerView
                      typingMessage="I want to create a customer support agent. It should use the return-policy skill and the order-management-api MCP server."
                    />
                  </StigmerProvider>
                </AppShell>
              );

            case "agent-created":
              return (
                <AppShell activeNav="new-session" contentKey="created">
                  <StigmerProvider client={conversationClient}>
                    <ComposerView execution={step.execution} />
                  </StigmerProvider>
                </AppShell>
              );

            case "agent-config":
              return (
                <StigmerProvider client={agentClient}>
                  <div className={DEMO_DETAIL_CLASSES}>
                    <div
                      data-scroll-container
                      className="h-full overflow-y-auto p-4"
                      style={{ zoom: DEMO_CONTENT_ZOOM }}
                    >
                      <AgentDetailView org={DEMO_ORG} slug={DEMO_SLUG} />
                    </div>
                  </div>
                </StigmerProvider>
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
    </DemoViewport>
  );
}
