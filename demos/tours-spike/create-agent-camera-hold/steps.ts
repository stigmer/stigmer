/**
 * SPIKE V3-HOLD (throwaway) — V3 with the camera reset removed so the zoomed
 * state persists, purely to make the zoom screenshot-able for the gate
 * review. Not a candidate framing.
 */
import type { ScenarioStep } from "@scenar/react";
import {
  type CreateAgentTourStep,
  createAgentTourSteps,
} from "../../tours/create-agent-tour/steps";

export const spikeCameraHoldSteps: ScenarioStep<CreateAgentTourStep>[] =
  createAgentTourSteps.map((step, index) =>
    index === 1
      ? {
          ...step,
          interactions: [
            {
              type: "viewport_transition",
              target: "thread",
              viewportZoom: 1.5,
              atPercent: 0.3,
            },
          ],
        }
      : step,
  );
