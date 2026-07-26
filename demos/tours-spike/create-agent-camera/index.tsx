/**
 * SPIKE VARIANT V3 — backdrop framing plus the camera (see steps.ts).
 * Rendering is identical to V2; the camera move lives in the timeline.
 */
import type { ReactNode } from "react";
import { renderStep as renderPilotStep } from "../../tours/create-agent-tour/index";
import type { CreateAgentTourStep } from "../../tours/create-agent-tour/steps";
import "../create-agent-backdrop/stage.css";

export function renderStep(data: CreateAgentTourStep): ReactNode {
  return <div className="spike-stage">{renderPilotStep(data)}</div>;
}
