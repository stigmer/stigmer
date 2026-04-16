"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { StigmerProvider } from "@stigmer/react";
import { createDemoClient } from "@stigmer/react/demo";
import type { DemoScenario } from "@stigmer/react/demo";
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
import {
  type FirstSkillTourStep,
  firstSkillTourSteps,
  SKILL_REFS_CODE,
  EXPERT_OUTPUT,
} from "./steps";

const emptyScenario: DemoScenario = { fixtures: new Map() };

const FILE_TREE: FileTreeEntry[] = [
  { name: "ask-agent.ts", type: "file", depth: 0 },
  { name: "package.json", type: "file", depth: 0 },
  { name: "tsconfig.json", type: "file", depth: 0 },
];

// ---------------------------------------------------------------------------
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: FirstSkillTourStep) {
  switch (step.view) {
    case "skill-creator-typing":
      return (
        <AppShell activeNav="new-session" contentKey="typing">
          <ComposerView
            typingMessage="I want to create a skill for our customer return policy."
            placeholder="Describe your skill..."
          />
        </AppShell>
      );

    case "skill-created":
      return (
        <AppShell
          activeNav="new-session"
          contentKey="created"
          aside={renderWidgetsSidebar(step.execution)}
        >
          <ComposerView execution={step.execution} />
        </AppShell>
      );

    case "code-skill-refs":
      return (
        <CodeEditorView
          filename="ask-agent.ts"
          lines={SKILL_REFS_CODE}
          highlightLines={[10]}
          fileTree={FILE_TREE}
          workspaceName="stigmer-quickstart"
          contentKey="skill-refs"
        />
      );

    case "terminal-expert":
      return (
        <TerminalView
          title="Terminal — zsh"
          cwd="~/stigmer-quickstart"
          lines={EXPERT_OUTPUT}
          contentKey="expert"
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Mid-step interactions
// ---------------------------------------------------------------------------

const INTERACTIONS: StepInteractions = {};

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * First Skill overview tour for the "What you'll build" section.
 *
 * Four-step multi-surface preview: describe domain in Skill Creator →
 * Skill generated → add skillRefs to code → expert response.
 */
export function FirstSkillTour() {
  const client = useMemo(() => createDemoClient(emptyScenario), []);
  const narrationManifest = useNarrationManifest("first-skill-tour");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (_step: FirstSkillTourStep, index: number) => {
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
    steps: firstSkillTourSteps,
  });

  return (
    <StigmerProvider client={client}>
      <DemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={firstSkillTourSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => renderStep(step)}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </DemoViewport>
    </StigmerProvider>
  );
}
