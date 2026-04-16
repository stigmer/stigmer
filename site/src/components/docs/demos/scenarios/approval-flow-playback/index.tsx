"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { StigmerProvider } from "@stigmer/react";
import { createDemoClient } from "@stigmer/react/demo";
import type { DemoScenario } from "@stigmer/react/demo";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { useStepInteractions } from "../../engine/useStepInteractions";
import { Cursor } from "../../engine/Cursor";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { DemoViewport } from "../../engine/DemoViewport";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  type ApprovalFlowStep,
  APPROVAL_INTERACTIONS,
  approvalFlowSteps,
  completedExecution,
} from "./steps";

const emptyScenario: DemoScenario = { fixtures: new Map() };

type ApprovalSubmitHandler = (
  toolCallId: string,
  action: ApprovalAction,
  comment?: string,
) => void;

export function ApprovalFlowPlayback() {
  const client = useMemo(() => createDemoClient(emptyScenario), []);
  const narrationManifest = useNarrationManifest("approval-flow-playback");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);
  const [approved, setApproved] = useState(false);

  const handleStepChange = useCallback(
    (_step: ApprovalFlowStep, index: number) => {
      setCursorTarget(undefined);
      setStepIndex(index);
      setApproved(false);
    },
    [],
  );

  const handleApprovalSubmit: ApprovalSubmitHandler = useCallback(() => {
    setApproved(true);
  }, []);

  useStepInteractions({
    stepIndex,
    interactions: APPROVAL_INTERACTIONS,
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: approvalFlowSteps,
  });

  return (
    <StigmerProvider client={client}>
      <DemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={approvalFlowSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => renderStep(step, approved, handleApprovalSubmit)}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </DemoViewport>
    </StigmerProvider>
  );
}

function renderStep(
  step: ApprovalFlowStep,
  approved: boolean,
  onApprovalSubmit: ApprovalSubmitHandler,
) {
  switch (step.view) {
    case "composer-typing":
      return (
        <AppShell activeNav="new-session" contentKey="session">
          <ComposerView
            typingMessage={step.message}
            placeholder="Ask anything..."
          />
        </AppShell>
      );

    case "approval-pending": {
      if (approved) {
        return (
          <AppShell
            activeNav="new-session"
            contentKey="session"
            aside={renderWidgetsSidebar(completedExecution)}
          >
            <ComposerView execution={completedExecution} />
          </AppShell>
        );
      }
      return (
        <AppShell
          activeNav="new-session"
          contentKey="session"
          aside={renderWidgetsSidebar(step.execution)}
        >
          <ComposerView
            execution={step.execution}
            onApprovalSubmit={onApprovalSubmit}
          />
        </AppShell>
      );
    }

    case "conversation":
      return (
        <AppShell
          activeNav="new-session"
          contentKey="session"
          aside={renderWidgetsSidebar(step.execution)}
        >
          <ComposerView execution={step.execution} />
        </AppShell>
      );
  }
}
