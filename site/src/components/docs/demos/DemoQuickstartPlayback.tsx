"use client";

import { useMemo } from "react";
import { StigmerProvider, MessageThread } from "@stigmer/react";
import { createDemoClient } from "@stigmer/react/demo";
import type { DemoScenario } from "@stigmer/react/demo";
import { ScenarioPlayer } from "./ScenarioPlayer";
import { quickstartPlaybackSteps } from "./scenarios/quickstart-playback";

const emptyScenario: DemoScenario = { fixtures: new Map() };

/**
 * Animated quickstart conversation for the Cloud quickstart page.
 *
 * Auto-plays a timed sequence of messages through a real MessageThread,
 * showing a basic exchange with the implicit assistant agent. Backed by
 * fixture data — no live backend required.
 */
export function DemoQuickstartPlayback() {
  const client = useMemo(() => createDemoClient(emptyScenario), []);

  return (
    <StigmerProvider client={client}>
      <ScenarioPlayer
        steps={quickstartPlaybackSteps}
        className="not-prose mx-auto max-w-2xl"
      >
        {(execution) => <MessageThread executions={[execution]} />}
      </ScenarioPlayer>
    </StigmerProvider>
  );
}
