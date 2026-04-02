"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { StigmerProvider } from "@stigmer/react";
import { createDemoClient, fixtures, buildScenario } from "@stigmer/react/demo";
import { create } from "@bufbuild/protobuf";
import { GetArtifactContentResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { Cursor } from "../../engine/Cursor";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { SkillsListView } from "../../views/SkillsListView";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import {
  type GuidedTourStep,
  skillCreationTourSteps,
  SKILL_MD_PREVIEW,
} from "./steps";

const SKILL_CREATOR_REF = { org: "demo-org", slug: "skill-creator" };

const skillMdBytes = new TextEncoder().encode(SKILL_MD_PREVIEW);

const demoScenario = buildScenario(
  fixtures.agentExecution.getArtifactContent(() =>
    create(GetArtifactContentResponseSchema, {
      content: skillMdBytes,
      contentType: "text/markdown",
      totalSizeBytes: BigInt(skillMdBytes.length),
      truncated: false,
    }),
  ),
);

/**
 * Derive the content-area key from the current step so that
 * AppShell only triggers a fade transition when the view
 * category changes — not on every message snapshot.
 */
function contentKeyFor(step: GuidedTourStep): string {
  switch (step.view) {
    case "library-click":
      return "home";
    case "skills-list":
    case "create-skill-click":
    case "library-complete":
      return "skills";
    case "composer-ready":
    case "conversation":
    case "artifact-click":
    case "artifact-preview":
    case "push-skill":
      return "composer";
  }
}

function slideDirectionFor(
  step: GuidedTourStep,
): "forward" | "backward" | undefined {
  switch (step.view) {
    case "skills-list":
      return "forward";
    case "composer-ready":
      return "forward";
    case "library-complete":
      return "backward";
    default:
      return undefined;
  }
}

function cursorTargetFor(step: GuidedTourStep): string | undefined {
  switch (step.view) {
    case "library-click":
      return "library";
    case "create-skill-click":
      return "create-skill";
    case "artifact-click":
      return "artifact-widget";
    case "push-skill":
      return "push-button";
    default:
      return undefined;
  }
}

function renderStep(step: GuidedTourStep) {
  const contentKey = contentKeyFor(step);
  const slide = slideDirectionFor(step);

  switch (step.view) {
    case "library-click":
      return (
        <AppShell
          highlightNav="library"
          contentKey={contentKey}
          slideDirection={slide}
        >
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-[10px] text-muted-foreground">
              Start a new session
            </p>
          </div>
        </AppShell>
      );

    case "skills-list":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
        >
          <SkillsListView />
        </AppShell>
      );

    case "create-skill-click":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
        >
          <SkillsListView highlightCreate />
        </AppShell>
      );

    case "composer-ready":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
        >
          <ComposerView agentRef={SKILL_CREATOR_REF} />
        </AppShell>
      );

    case "conversation":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
          aside={renderWidgetsSidebar(step.execution)}
        >
          <ComposerView execution={step.execution} />
        </AppShell>
      );

    case "artifact-click":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
          aside={renderWidgetsSidebar(step.execution)}
        >
          <ComposerView execution={step.execution} />
        </AppShell>
      );

    case "artifact-preview":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
          aside={renderWidgetsSidebar(step.execution)}
        >
          <ComposerView
            execution={step.execution}
            artifactContent={step.artifactContent}
          />
        </AppShell>
      );

    case "push-skill":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
          aside={renderWidgetsSidebar(step.execution)}
        >
          <ComposerView
            execution={step.execution}
            artifactContent={SKILL_MD_PREVIEW}
            pushState="ready"
          />
        </AppShell>
      );

    case "library-complete":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
        >
          <SkillsListView showNewSkill />
        </AppShell>
      );
  }
}

/**
 * Guided-tour demo for the "Your first Skill" docs page.
 *
 * Auto-plays a timed walkthrough of the Stigmer web app in a
 * three-column layout (nav / session / widgets) mirroring the
 * production Console. Uses real `@stigmer/react` components
 * backed by fixture data — no live backend.
 *
 * Three layers of visual storytelling:
 * 1. **Captions** — short labels below the demo describing each action
 * 2. **Slide transitions** — content slides left/right on navigation
 * 3. **Animated cursor** — pointer moves to click targets with ripple
 */
export function SkillCreationTour() {
  const client = useMemo(() => createDemoClient(demoScenario), []);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback((step: GuidedTourStep) => {
    setCursorTarget(cursorTargetFor(step));
  }, []);

  return (
    <StigmerProvider client={client}>
      <div ref={containerRef} className={DEMO_PLAYER_CLASSES}>
        <ScenarioPlayer
          steps={skillCreationTourSteps}
          onStepChange={handleStepChange}
        >
          {(step) => renderStep(step)}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </div>
    </StigmerProvider>
  );
}
