"use client";

import { useCallback, useRef, useState } from "react";
import { PreviewProvider } from "@scenar/preview/runtime";
import { ScenarioPlayer, useNarrationManifest, useStepInteractions, Cursor } from "@scenar/react";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  type ApprovalFlowStep,
  approvalFlowSteps,
  completedExecution,
} from "./steps";

type ApprovalSubmitHandler = (
  toolCallId: string,
  action: ApprovalAction,
  comment?: string,
) => void;

export function ApprovalFlowPlayback() {
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
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: approvalFlowSteps,
  });

  return (
    <PreviewProvider providers={PreviewProviders}>
      <StigmerDemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={approvalFlowSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => renderStep(step, approved, handleApprovalSubmit)}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </StigmerDemoViewport>
    </PreviewProvider>
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
