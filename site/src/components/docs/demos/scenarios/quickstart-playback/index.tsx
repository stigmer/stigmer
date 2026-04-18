"use client";

import { PreviewProvider } from "@scenar/preview/runtime";
import { ScenarioPlayer, useNarrationManifest } from "@scenar/react";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import { type QuickstartStep, quickstartPlaybackSteps } from "./steps";

function renderStep(step: QuickstartStep) {
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

/**
 * Animated quickstart conversation for the Cloud quickstart page.
 *
 * Auto-plays a timed sequence of messages through a real MessageThread
 * inside a three-column AppShell, showing a basic exchange with
 * the implicit assistant agent. Starts from an empty composer to
 * establish the user journey. Backed by fixture data — no live
 * backend required.
 */
export function QuickstartPlayback() {
  const narrationManifest = useNarrationManifest("quickstart-playback");

  return (
    <PreviewProvider providers={PreviewProviders}>
      <StigmerDemoViewport>
        <ScenarioPlayer
          steps={quickstartPlaybackSteps}
          narrationManifest={narrationManifest}
        >
          {(step) => renderStep(step)}
        </ScenarioPlayer>
      </StigmerDemoViewport>
    </PreviewProvider>
  );
}
