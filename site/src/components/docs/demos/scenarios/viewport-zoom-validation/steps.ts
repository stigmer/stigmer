import type { ScenarioStep } from "../../engine/ScenarioPlayer";
import type { StepInteractions } from "../../engine/useStepInteractions";

// ---------------------------------------------------------------------------
// Step data
// ---------------------------------------------------------------------------

export interface MetricCard {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly trend: "up" | "down" | "flat";
}

export type ViewportZoomStep =
  | { readonly view: "dashboard" }
  | { readonly view: "dashboard-zoomed" }
  | { readonly view: "dashboard-clicked" };

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

export const METRICS: readonly MetricCard[] = [
  { id: "executions", label: "Executions", value: "2,847", trend: "up" },
  { id: "success-rate", label: "Success Rate", value: "98.2%", trend: "up" },
  { id: "avg-duration", label: "Avg Duration", value: "3.4s", trend: "down" },
  { id: "active-agents", label: "Active Agents", value: "12", trend: "flat" },
];

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export const viewportZoomSteps: ScenarioStep<ViewportZoomStep>[] = [
  {
    delayMs: 0,
    data: { view: "dashboard" },
    caption: "Dashboard overview — zoom into metrics",
  },
  {
    delayMs: 4000,
    data: { view: "dashboard-zoomed" },
    caption: "Zoomed into success rate metric",
  },
  {
    delayMs: 4000,
    data: { view: "dashboard-clicked" },
    caption: "Viewport reset — full dashboard",
  },
];

// ---------------------------------------------------------------------------
// Mid-step interactions
// ---------------------------------------------------------------------------

/**
 * Step 0: at 30%, zoom into the "success-rate" metric card at 1.8x.
 * At 70%, click the metric card (verifies cursor positioning works
 * during zoom). Step 1 has no interactions (zoomed view persists).
 * Step 2: at 20%, reset the viewport back to identity transform.
 */
export const VIEWPORT_INTERACTIONS: StepInteractions = {
  0: [
    {
      atPercent: 0.3,
      type: "viewport-transition",
      target: "success-rate",
      viewportZoom: 1.8,
    },
    {
      atPercent: 0.7,
      type: "set-cursor",
      target: "success-rate",
    },
  ],
  2: [
    {
      atPercent: 0.2,
      type: "viewport-transition",
      viewportReset: true,
    },
    {
      atPercent: 0.6,
      type: "clear-cursor",
    },
  ],
};
