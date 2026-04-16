"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ArtifactPreviewContent, StigmerProvider } from "@stigmer/react";
import {
  createDemoClient,
  fixtures,
  buildScenario,
  samples,
} from "@stigmer/react/demo";
import { create } from "@bufbuild/protobuf";
import { GetArtifactContentResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import {
  type StepInteractions,
  useStepInteractions,
} from "../../engine/useStepInteractions";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { ResourceListPage } from "../../views/ResourceListPage";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { DemoViewport } from "../../engine/DemoViewport";
import { DEMO_CONTENT_ZOOM } from "../../shared/tokens";
import { DEMO_ORG } from "../../engine/shared";
import {
  type GuidedTourStep,
  skillCreationTourSteps,
  SKILL_MD_PREVIEW,
} from "./steps";

const noop = () => {};
const SKILL_CREATOR_REF = { org: "demo-org", slug: "skill-creator" };

function firstArtifact(execution: AgentExecution) {
  return execution.status!.artifacts[0];
}

const EXISTING_SKILLS = [
  samples.searchResult({
    id: "skl-00000000-0000-0000-0000-000000000001",
    kind: ApiResourceKind.skill,
    name: "Product Catalog",
    slug: "product-catalog",
    description: "Technical specs and pricing for all product lines.",
  }),
  samples.searchResult({
    id: "skl-00000000-0000-0000-0000-000000000002",
    kind: ApiResourceKind.skill,
    name: "Escalation Runbook",
    slug: "escalation-runbook",
    description: "Step-by-step process for customer issue escalation.",
  }),
];

const ALL_SKILLS = [
  ...EXISTING_SKILLS,
  samples.searchResult({
    id: "skl-00000000-0000-0000-0000-000000000003",
    kind: ApiResourceKind.skill,
    name: "Return Policy",
    slug: "return-policy",
    description: "Acme Corp's customer return and refund policy.",
  }),
];

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
      return "apply-resource-button";
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
            <p className="text-xs text-muted-foreground">
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
          <ResourceListPage
            title="Skills"
            createLabel="Add Skill"
            cursorTarget="create-skill"
            items={EXISTING_SKILLS}
          />
        </AppShell>
      );

    case "create-skill-click":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
        >
          <ResourceListPage
            title="Skills"
            createLabel="Add Skill"
            cursorTarget="create-skill"
            items={EXISTING_SKILLS}
            highlightCreate
          />
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
    case "push-skill":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
          aside={renderWidgetsSidebar(step.execution)}
        >
          <div className="absolute inset-0 overflow-hidden">
            <ComposerView execution={step.execution} />
          </div>
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <div style={{ zoom: DEMO_CONTENT_ZOOM }}>
              <div className="w-[36rem] rounded-lg border border-border bg-background shadow-lg">
                <ArtifactPreviewContent
                  artifact={firstArtifact(step.execution)}
                  executionId={step.execution.metadata!.id}
                  org={DEMO_ORG}
                  isTerminal
                  onClose={noop}
                />
              </div>
            </div>
          </div>
        </AppShell>
      );

    case "library-complete":
      return (
        <AppShell
          activeNav="library"
          contentKey={contentKey}
          slideDirection={slide}
        >
          <ResourceListPage
            title="Skills"
            createLabel="Add Skill"
            cursorTarget="create-skill"
            items={ALL_SKILLS}
            showNewItem
          />
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
const INTERACTIONS: StepInteractions = {};

export function SkillCreationTour() {
  const client = useMemo(() => createDemoClient(demoScenario), []);
  const narrationManifest = useNarrationManifest("skill-creation-tour");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (step: GuidedTourStep, index: number) => {
      setCursorTarget(cursorTargetFor(step));
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
    steps: skillCreationTourSteps,
  });

  return (
    <StigmerProvider client={client}>
      <DemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={skillCreationTourSteps}
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
