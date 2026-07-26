/**
 * SPIKE VARIANT V3 (throwaway) — the pilot's timeline plus one camera move:
 * on the "agent created" beat, zoom into the conversation thread while the
 * narration walks through the reply, then pull back before the beat ends.
 *
 * Exports exactly one steps array: `scenar pack` duck-types the first
 * exported array of objects with `delayMs`, so re-exporting the base steps
 * alongside this one would be ambiguous.
 */
import type { ScenarioStep } from "@scenar/react";
import {
  type CreateAgentTourStep,
  createAgentTourSteps,
} from "../../tours/create-agent-tour/steps";

export const spikeCameraSteps: ScenarioStep<CreateAgentTourStep>[] =
  createAgentTourSteps.map((step, index) =>
    index === 1
      ? {
          ...step,
          interactions: [
            // Zoom into the thread while narration describes the reply
            // (`thread` is the pilot's cursor/camera anchor around the
            // conversation), then pull back to rest before the beat ends.
            {
              type: "viewport_transition",
              target: "thread",
              viewportZoom: 1.5,
              atPercent: 0.3,
            },
            { type: "viewport_transition", viewportReset: true, atPercent: 0.8 },
          ],
        }
      : step,
  );
