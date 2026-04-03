"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { StigmerProvider } from "@stigmer/react";
import { createDemoClient } from "@stigmer/react/demo";
import type { DemoScenario } from "@stigmer/react/demo";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { Cursor } from "../../engine/Cursor";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import { type ApprovalFlowStep, approvalFlowSteps } from "./steps";

const emptyScenario: DemoScenario = { fixtures: new Map() };

const noop = () => {};

function cursorTargetFor(step: ApprovalFlowStep): string | undefined {
  return step.view === "cursor-approve" ? "approve-button" : undefined;
}

function renderStep(step: ApprovalFlowStep) {
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

    case "approval-card":
    case "cursor-approve":
      return (
        <AppShell
          activeNav="new-session"
          contentKey="session"
          aside={renderWidgetsSidebar(step.execution)}
        >
          <ComposerView
            execution={step.execution}
            onApprovalSubmit={noop}
          />
        </AppShell>
      );

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

export function ApprovalFlowPlayback() {
  const client = useMemo(() => createDemoClient(emptyScenario), []);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback((step: ApprovalFlowStep) => {
    setCursorTarget(cursorTargetFor(step));
  }, []);

  return (
    <StigmerProvider client={client}>
      <div ref={containerRef} className={DEMO_PLAYER_CLASSES}>
        <ScenarioPlayer
          steps={approvalFlowSteps}
          onStepChange={handleStepChange}
        >
          {(step) => renderStep(step)}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </div>
    </StigmerProvider>
  );
}
