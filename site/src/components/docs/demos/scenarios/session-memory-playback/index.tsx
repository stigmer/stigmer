"use client";

import { useMemo } from "react";
import { StigmerProvider } from "@stigmer/react";
import { createDemoClient } from "@stigmer/react/demo";
import type { DemoScenario } from "@stigmer/react/demo";
import { ScenarioPlayer, useNarrationManifest } from "@scenar/react";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
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
  const narrationManifest = useNarrationManifest("session-memory-playback");

  return (
    <StigmerProvider client={client}>
      <StigmerDemoViewport>
        <ScenarioPlayer
          steps={sessionMemorySteps}
          narrationManifest={narrationManifest}
        >
          {(step) => renderStep(step)}
        </ScenarioPlayer>
      </StigmerDemoViewport>
    </StigmerProvider>
  );
}
