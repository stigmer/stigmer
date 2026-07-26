/**
 * SPIKE VARIANT V2 — "window on backdrop": the pilot's beats floated on the
 * stage backdrop with a window shadow and radius, Screen Studio style.
 * Numbers are hardcoded to the 1280x800 spike canvas; the production version
 * of this framing is the pack-time stage (plan Phase 4), not this wrapper.
 */
import type { ReactNode } from "react";
import { renderStep as renderPilotStep } from "../../tours/create-agent-tour/index";
import type { CreateAgentTourStep } from "../../tours/create-agent-tour/steps";
import "./stage.css";

export function renderStep(data: CreateAgentTourStep): ReactNode {
  return <div className="spike-stage">{renderPilotStep(data)}</div>;
}
