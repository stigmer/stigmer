"use client";

import { useMemo } from "react";
import { StigmerProvider } from "@stigmer/react";
import { createDemoClient } from "@stigmer/react/demo";
import type { DemoScenario } from "@stigmer/react/demo";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { type SessionMemoryStep, sessionMemorySteps } from "./steps";

const emptyScenario: DemoScenario = { fixtures: new Map() };

function renderStep(step: SessionMemoryStep) {
  switch (step.view) {
    case "composer-empty":
      return (
        <AppShell activeNav="new-session" contentKey="session">
          <ComposerView placeholder="Ask anything..." />
        </AppShell>
      );

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

export function SessionMemoryPlayback() {
  const client = useMemo(() => createDemoClient(emptyScenario), []);

  return (
    <StigmerProvider client={client}>
      <div className="not-prose mx-auto max-w-4xl">
        <ScenarioPlayer steps={sessionMemorySteps}>
          {(step) => renderStep(step)}
        </ScenarioPlayer>
      </div>
    </StigmerProvider>
  );
}
