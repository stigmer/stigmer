"use client";

import { useMemo } from "react";
import { StigmerProvider } from "@stigmer/react";
import { createDemoClient } from "@stigmer/react/demo";
import type { DemoScenario } from "@stigmer/react/demo";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import { type ApprovalFlowStep, approvalFlowSteps } from "./steps";

const emptyScenario: DemoScenario = { fixtures: new Map() };

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

  return (
    <StigmerProvider client={client}>
      <div className={DEMO_PLAYER_CLASSES}>
        <ScenarioPlayer steps={approvalFlowSteps}>
          {(step) => renderStep(step)}
        </ScenarioPlayer>
      </div>
    </StigmerProvider>
  );
}
