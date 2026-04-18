"use client";

import { PreviewProvider } from "@scenar/preview/runtime";
import { ScenarioPlayer, useNarrationManifest } from "@scenar/react";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import { type SessionMemoryStep, sessionMemorySteps } from "./steps";

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
  const narrationManifest = useNarrationManifest("session-memory-playback");

  return (
    <PreviewProvider providers={PreviewProviders}>
      <StigmerDemoViewport>
        <ScenarioPlayer
          steps={sessionMemorySteps}
          narrationManifest={narrationManifest}
        >
          {(step) => renderStep(step)}
        </ScenarioPlayer>
      </StigmerDemoViewport>
    </PreviewProvider>
  );
}
