import type { ScenarioStep } from "@scenar/react";

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
    interactions: [
      {
        atPercent: 0.3,
        type: "viewport_transition",
        target: "success-rate",
        viewportZoom: 1.8,
      },
      {
        atPercent: 0.7,
        type: "set_cursor",
        target: "success-rate",
      },
    ],
  },
  {
    delayMs: 4000,
    data: { view: "dashboard-zoomed" },
  },
  {
    delayMs: 4000,
    data: { view: "dashboard-clicked" },
    interactions: [
      {
        atPercent: 0.2,
        type: "viewport_transition",
        viewportReset: true,
      },
      {
        atPercent: 0.6,
        type: "clear_cursor",
      },
    ],
  },
];
