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
  type LocalRunnerTourStep,
  localRunnerTourSteps,
  START_NATIVE_OUTPUT,
  START_DOCKER_OUTPUT,
  LIST_RUNNERS_OUTPUT,
} from "./steps";

// ---------------------------------------------------------------------------
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: LocalRunnerTourStep) {
  switch (step.view) {
    case "start-native":
      return (
        <TerminalView
          title="Terminal — zsh"
          cwd="~/projects/my-app"
          lines={START_NATIVE_OUTPUT}
          contentKey="native"
        />
      );

    case "start-docker":
      return (
        <TerminalView
          title="Terminal — zsh"
          cwd="~/projects/my-app"
          lines={START_DOCKER_OUTPUT}
          contentKey="docker"
        />
      );

    case "list-runners":
      return (
        <TerminalView
          title="Terminal — zsh"
          cwd="~/projects/my-app"
          lines={LIST_RUNNERS_OUTPUT}
          contentKey="list"
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Local runner CLI tour.
 *
 * Three-step playback: start a native runner → start a Docker
 * runner → list all runners. Placed at the top of the local-runner
 * guide as a visual overview before the step-by-step instructions.
 */
export function LocalRunnerTour() {
  const narrationManifest = useNarrationManifest("local-runner-tour");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (_step: LocalRunnerTourStep, index: number) => {
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
    steps: localRunnerTourSteps,
  });

  return (
    <StigmerDemoViewport containerRef={containerRef}>
      <ScenarioPlayer
        steps={localRunnerTourSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </StigmerDemoViewport>
  );
}
