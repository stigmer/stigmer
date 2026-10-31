/**
 * Pins RunPhaseBadge, a public export: each run phase reads as its label,
 * announced as a status, in its phase colour; a run waiting for approval
 * is drawn in the at-risk colour and a completed run in the ready colour
 * the theme contract measures as text on the page and on a card, never the
 * badge-fill amber or green; and an unspecified phase renders nothing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunPhaseBadge } from "../RunPhaseBadge";

afterEach(cleanup);

describe("RunPhaseBadge", () => {
  it.each([
    [RunPhase.RUN_PENDING, "Pending", "stg:text-muted-foreground"],
    [RunPhase.RUN_IN_PROGRESS, "Running", "stg:text-foreground"],
    [RunPhase.RUN_COMPLETED, "Completed", "stg:text-status-ready"],
    [RunPhase.RUN_FAILED, "Failed", "stg:text-destructive"],
    [RunPhase.RUN_CANCELLED, "Cancelled", "stg:text-muted-foreground"],
    [RunPhase.RUN_TERMINATED, "Terminated", "stg:text-destructive"],
    [RunPhase.RUN_WAITING_FOR_APPROVAL, "Waiting for approval", "stg:text-status-degraded"],
    [RunPhase.RUN_PAUSED, "Paused", "stg:text-muted-foreground"],
  ])("shows phase %i as %s in %s", (phase, label, colorClass) => {
    render(<RunPhaseBadge phase={phase} />);
    const badge = screen.getByRole("status", { name: label });
    expect(badge.textContent).toBe(label);
    expect(badge.className.split(" ")).toContain(colorClass);
  });

  it("renders nothing for an unspecified phase", () => {
    const { container } = render(<RunPhaseBadge phase={RunPhase.RUN_PHASE_UNSPECIFIED} />);
    expect(container.firstChild).toBeNull();
  });
});
