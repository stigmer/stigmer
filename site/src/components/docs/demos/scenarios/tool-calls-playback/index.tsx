"use client";

import { useMemo } from "react";
import { StigmerProvider } from "@stigmer/react";
import { createDemoClient } from "@stigmer/react/demo";
import type { DemoScenario } from "@stigmer/react/demo";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { DemoViewport } from "../../engine/DemoViewport";
import { type ToolCallStep, toolCallsPlaybackSteps } from "./steps";

const emptyScenario: DemoScenario = { fixtures: new Map() };

function renderStep(step: ToolCallStep) {
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

export function ToolCallsPlayback() {
  const client = useMemo(() => createDemoClient(emptyScenario), []);
  const narrationManifest = useNarrationManifest("tool-calls-playback");

  return (
    <StigmerProvider client={client}>
      <DemoViewport>
        <ScenarioPlayer
          steps={toolCallsPlaybackSteps}
          narrationManifest={narrationManifest}
        >
          {(step) => renderStep(step)}
        </ScenarioPlayer>
      </DemoViewport>
    </StigmerProvider>
  );
}
