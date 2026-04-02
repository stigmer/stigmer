"use client";

import { useMemo } from "react";
import { StigmerProvider } from "@stigmer/react";
import { createDemoClient, fixtures, buildScenario } from "@stigmer/react/demo";
import { create } from "@bufbuild/protobuf";
import { GetArtifactContentResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ScenarioPlayer } from "./ScenarioPlayer";
import { DemoAppShell } from "./DemoAppShell";
import { DemoWidgetsSidebar } from "./DemoWidgetsSidebar";
import { SkillsListView } from "./SkillsListView";
import { ComposerView } from "./ComposerView";
import {
  type GuidedTourStep,
  skillCreationTourSteps,
  SKILL_MD_PREVIEW,
} from "./scenarios/skill-creation-tour";

const DEMO_ORG = "demo-org";

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
 * DemoAppShell only triggers a fade transition when the view
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
    case "artifact-preview":
    case "push-skill":
      return "composer";
  }
}

function widgetsSidebar(execution: AgentExecution) {
  const executions = [execution];
  return (
    <DemoWidgetsSidebar
      execution={execution}
      executions={executions}
      org={DEMO_ORG}
    />
  );
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
            <p className="text-[10px] text-muted-foreground">
              Start a new session
            </p>
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
          <ComposerView />
        </DemoAppShell>
      );

    case "conversation":
      return (
        <DemoAppShell
          activeNav="library"
          contentKey={contentKeyFor(step)}
          aside={widgetsSidebar(step.execution)}
        >
          <ComposerView execution={step.execution} />
        </DemoAppShell>
      );

    case "artifact-preview":
      return (
        <DemoAppShell
          activeNav="library"
          contentKey={contentKeyFor(step)}
          aside={widgetsSidebar(step.execution)}
        >
          <ComposerView
            execution={step.execution}
            artifactContent={step.artifactContent}
          />
        </DemoAppShell>
      );

    case "push-skill":
      return (
        <DemoAppShell
          activeNav="library"
          contentKey={contentKeyFor(step)}
          aside={widgetsSidebar(step.execution)}
        >
          <ComposerView
            execution={step.execution}
            artifactContent={SKILL_MD_PREVIEW}
            pushState="ready"
          />
        </DemoAppShell>
      );

    case "library-complete":
      return (
        <DemoAppShell activeNav="library" contentKey={contentKeyFor(step)}>
          <SkillsListView showNewSkill />
        </DemoAppShell>
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
 */
export function DemoSkillCreationTour() {
  const client = useMemo(() => createDemoClient(demoScenario), []);

  return (
    <StigmerProvider client={client}>
      <ScenarioPlayer
        steps={skillCreationTourSteps}
        className="not-prose mx-auto max-w-4xl"
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
    </StigmerProvider>
  );
}
