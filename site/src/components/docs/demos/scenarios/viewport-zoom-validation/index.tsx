"use client";

import { useCallback, useRef, useState } from "react";
import {
  ScenarioPlayer,
  useStepInteractions,
  Cursor,
  ViewportTransformLayer,
  VIEWPORT_TRANSFORM_IDENTITY,
  type ViewportTransform,
} from "@scenar/react";
import { DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import {
  type MetricCard,
  type ViewportZoomStep,
  METRICS,
  viewportZoomSteps,
} from "./steps";

// ---------------------------------------------------------------------------
// Dashboard UI (inlined — single-consumer validation scenario)
// ---------------------------------------------------------------------------

const TREND_ICONS: Record<MetricCard["trend"], string> = {
  up: "\u2191",
  down: "\u2193",
  flat: "\u2192",
};

const TREND_COLORS: Record<MetricCard["trend"], string> = {
  up: "text-green-500",
  down: "text-red-500",
  flat: "text-muted-foreground",
};

function MetricCardView({ metric }: { readonly metric: MetricCard }) {
  return (
    <div
      data-cursor-target={metric.id}
      className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4 shadow-sm"
    >
      <span className="text-xs font-medium text-muted-foreground">
        {metric.label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-card-foreground">
          {metric.value}
        </span>
        <span className={`text-sm font-medium ${TREND_COLORS[metric.trend]}`}>
          {TREND_ICONS[metric.trend]}
        </span>
      </div>
    </div>
  );
}

function Dashboard() {
  return (
    <div className="flex h-[380px] flex-col bg-background p-6">
      <h3 className="mb-4 text-sm font-semibold text-foreground">
        Agent Metrics
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {METRICS.map((m) => (
          <MetricCardView key={m.id} metric={m} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario component
// ---------------------------------------------------------------------------

/**
 * Viewport transition validation scenario.
 *
 * Renders a minimal 2x2 metric dashboard. Step 0 zooms into the
 * "success-rate" card at 1.8x, then sets the cursor on it
 * (validating cursor positioning during zoom). Step 1 persists the
 * zoomed state. Step 2 resets the viewport to identity.
 *
 * Validates: ViewportTransformLayer zoom/pan animation, cursor
 * positioning through CSS transform, viewport reset, overflow
 * clipping during zoom.
 *
 * Not registered in SCENARIO_REGISTRY — this is a validation
 * fixture, not a recordable demo.
 */
export function ViewportZoomValidation() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);
  const [viewportTransform, setViewportTransform] = useState<ViewportTransform>(
    VIEWPORT_TRANSFORM_IDENTITY,
  );

  const handleStepChange = useCallback(
    (_step: ViewportZoomStep, index: number) => {
      setCursorTarget(undefined);
      setStepIndex(index);
      if (index === 0) {
        setViewportTransform(VIEWPORT_TRANSFORM_IDENTITY);
      }
    },
    [],
  );

  useStepInteractions({
    stepIndex,
    narrationManifest: undefined,
    containerRef,
    setCursorTarget,
    steps: viewportZoomSteps,
    setViewportTransform,
  });

  return (
    <StigmerDemoViewport containerRef={containerRef}>
      <ViewportTransformLayer transform={viewportTransform}>
        <ScenarioPlayer
          steps={viewportZoomSteps}
          onStepChange={handleStepChange}
        >
          {() => <Dashboard />}
        </ScenarioPlayer>
      </ViewportTransformLayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </StigmerDemoViewport>
  );
}
