/**
 * Pins the console's one status pill: the state in words beside a dot
 * (never colour alone), 12px on a 20px pill whatever the state, the
 * state's own tint and hue from the status tokens, and a caller's word in
 * place of the phase's.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBadge } from "../StatusBadge";
import type { StatusPhase } from "../../resource-workbench/types";

afterEach(cleanup);

const PHASES: readonly StatusPhase[] = ["ready", "running", "pending", "degraded", "failed", "disabled", "draft"];

describe("StatusBadge", () => {
  it("draws every state at one size: 12px words on a 20px pill, with its dot", () => {
    for (const phase of PHASES) {
      const { unmount } = render(<StatusBadge phase={phase} />);
      const pill = screen.getByText(new RegExp(`^${phase}$`, "i"));
      for (const cls of ["stg:h-5", "stg:text-xs", "stg:font-medium", "stg:rounded-full", "stg:px-2"]) {
        expect(pill.className).toContain(cls);
      }
      expect(pill.className).not.toContain("stg:text-2xs");
      expect(pill.className).toContain(`--stgm-status-${phase}-subtle`);
      const dot = pill.querySelector('[aria-hidden="true"]');
      expect(dot?.className).toContain(`--stgm-status-${phase})`);
      unmount();
    }
  });

  it("says a caller's word in place of the phase's", () => {
    render(<StatusBadge phase="failed" label="Didn't finish" />);
    expect(screen.getByText("Didn't finish")).toBeTruthy();
    expect(screen.queryByText("Failed")).toBeNull();
  });
});
