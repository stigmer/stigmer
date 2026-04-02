"use client";

import { useMemo } from "react";
import { StigmerProvider } from "@stigmer/react";
import { createDemoClient } from "@stigmer/react/demo";
import type { DemoScenario } from "@stigmer/react/demo";
import { ScenarioPlayer } from "./ScenarioPlayer";
import { DemoAppShell } from "./DemoAppShell";
import { SkillsListView } from "./SkillsListView";
import { ComposerView } from "./ComposerView";
import {
  type GuidedTourStep,
  skillCreationTourSteps,
} from "./scenarios/skill-creation-tour";

const emptyScenario: DemoScenario = { fixtures: new Map() };

/**
 * Derive the content-area key from the current step so that
 * DemoAppShell only triggers a fade transition when the view
 * category changes — not on every message snapshot.
 */
function contentKeyFor(step: GuidedTourStep): string {
  switch (step.view) {
    case "library-click":
      return "dashboard";
    case "skills-list":
    case "create-skill-click":
      return "skills";
    case "composer-ready":
    case "conversation":
      return "composer";
  }
}

function renderStep(step: GuidedTourStep) {
  switch (step.view) {
    case "library-click":
      return (
        <DemoAppShell
          highlightNav="library"
          contentKey={contentKeyFor(step)}
        >
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-[11px] text-muted-foreground">Dashboard</p>
          </div>
        </DemoAppShell>
      );

    case "skills-list":
      return (
        <DemoAppShell activeNav="library" contentKey={contentKeyFor(step)}>
          <SkillsListView />
        </DemoAppShell>
      );

    case "create-skill-click":
      return (
        <DemoAppShell activeNav="library" contentKey={contentKeyFor(step)}>
          <SkillsListView highlightCreate />
        </DemoAppShell>
      );

    case "composer-ready":
      return (
        <DemoAppShell activeNav="library" contentKey={contentKeyFor(step)}>
          <ComposerView agentName={step.agentName} />
        </DemoAppShell>
      );

    case "conversation":
      return (
        <DemoAppShell activeNav="library" contentKey={contentKeyFor(step)}>
          <ComposerView
            agentName="Skill Creator"
            execution={step.execution}
          />
        </DemoAppShell>
      );
  }
}

/**
 * Guided-tour demo for the "Your first Skill" docs page.
 *
 * Auto-plays a timed walkthrough of the Stigmer web app navigation:
 * sidebar → Library → Skills list → Create Skill → Session Composer
 * → conversation with the Skill Creator agent.
 *
 * Uses real `@stigmer/react` components (MessageThread) for the
 * conversation portion, backed by fixture data — no live backend.
 */
export function DemoSkillCreationTour() {
  const client = useMemo(() => createDemoClient(emptyScenario), []);

  return (
    <StigmerProvider client={client}>
      <ScenarioPlayer
        steps={skillCreationTourSteps}
        className="not-prose mx-auto max-w-2xl"
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
    </StigmerProvider>
  );
}
