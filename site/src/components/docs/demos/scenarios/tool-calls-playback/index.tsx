"use client";

import { ScenarioPlayer, useNarrationManifest } from "@scenar/react";
import { StigmerPreviewProvider } from "../../shared/StigmerPreviewProvider";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import { type ToolCallStep, toolCallsPlaybackSteps } from "./steps";

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
  const narrationManifest = useNarrationManifest("tool-calls-playback");

  return (
    <StigmerPreviewProvider>
      <StigmerDemoViewport>
        <ScenarioPlayer
          steps={toolCallsPlaybackSteps}
          narrationManifest={narrationManifest}
        >
          {(step) => renderStep(step)}
        </ScenarioPlayer>
      </StigmerDemoViewport>
    </StigmerPreviewProvider>
  );
}
