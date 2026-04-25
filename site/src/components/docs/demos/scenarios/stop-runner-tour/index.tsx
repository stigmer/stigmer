"use client";

import { useCallback, useRef, useState } from "react";
import {
  ScenarioPlayer,
  useNarrationManifest,
  Cursor,
  useStepInteractions,
  TerminalView,
} from "@scenar/react";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import {
  type StopRunnerTourStep,
  stopRunnerTourSteps,
  LIST_ACTIVE_OUTPUT,
  STOP_ONE_OUTPUT,
  STOP_ALL_OUTPUT,
} from "./steps";

// ---------------------------------------------------------------------------
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: StopRunnerTourStep) {
  switch (step.view) {
    case "list-active":
      return (
        <TerminalView
          title="Terminal — zsh"
          cwd="~/projects/my-app"
          lines={LIST_ACTIVE_OUTPUT}
          contentKey="list"
        />
      );

    case "stop-one":
      return (
        <TerminalView
          title="Terminal — zsh"
          cwd="~/projects/my-app"
          lines={STOP_ONE_OUTPUT}
          contentKey="stop-one"
        />
      );

    case "stop-all":
      return (
        <TerminalView
          title="Terminal — zsh"
          cwd="~/projects/my-app"
          lines={STOP_ALL_OUTPUT}
          contentKey="stop-all"
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Stop runner CLI tour.
 *
 * Three-step playback: list active runners → stop one by name →
 * stop everything at once. Placed at the top of the stop-and-cleanup
 * guide as a visual overview.
 */
export function StopRunnerTour() {
  const narrationManifest = useNarrationManifest("stop-runner-tour");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (_step: StopRunnerTourStep, index: number) => {
      setCursorTarget(undefined);
      setStepIndex(index);
    },
    [],
  );

  useStepInteractions({
    stepIndex,
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: stopRunnerTourSteps,
  });

  return (
    <StigmerDemoViewport containerRef={containerRef}>
      <ScenarioPlayer
        steps={stopRunnerTourSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </StigmerDemoViewport>
  );
}
