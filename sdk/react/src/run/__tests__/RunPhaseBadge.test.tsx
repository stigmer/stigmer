/**
 * Pins RunPhaseBadge, a public export: each run phase reads as its label,
 * announced as a status, drawn as the console's one status pill in the
 * state it reads as (a run waiting for approval or paused at risk, a
 * completed run ready, a failed or terminated run failed, a cancelled run
 * off); and an unspecified phase renders nothing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunPhaseBadge } from "../RunPhaseBadge";

afterEach(cleanup);

describe("RunPhaseBadge", () => {
  it.each([
    [RunPhase.RUN_PENDING, "Pending", "pending"],
    [RunPhase.RUN_IN_PROGRESS, "Running", "running"],
    [RunPhase.RUN_COMPLETED, "Completed", "ready"],
    [RunPhase.RUN_FAILED, "Failed", "failed"],
    [RunPhase.RUN_CANCELLED, "Cancelled", "disabled"],
    [RunPhase.RUN_TERMINATED, "Terminated", "failed"],
    [RunPhase.RUN_WAITING_FOR_APPROVAL, "Waiting for approval", "degraded"],
    [RunPhase.RUN_PAUSED, "Paused", "degraded"],
  ])("shows phase %i as %s in the %s pill", (phase, label, status) => {
    render(<RunPhaseBadge phase={phase} />);
    const badge = screen.getByRole("status", { name: label });
    expect(badge.textContent).toBe(label);
    const pill = badge.firstElementChild as HTMLElement;
    expect(pill.className).toContain(`--stgm-status-${status}-subtle`);
    expect(pill.className).toContain("stg:h-5");
  });

  it("renders nothing for an unspecified phase", () => {
    const { container } = render(<RunPhaseBadge phase={RunPhase.RUN_PHASE_UNSPECIFIED} />);
    expect(container.firstChild).toBeNull();
  });
});
