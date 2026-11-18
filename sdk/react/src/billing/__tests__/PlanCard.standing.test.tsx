/**
 * The plan card's standings beyond Active, and the public agent hours block
 * on its own: a failed payment is said in the failed tone as a status, a
 * cancel names the day the plan ends, and AgentHoursStanding draws the hours
 * used of those included over a meter with the plan's terms.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PlanCard } from "../PlanCard";
import { AgentHoursStanding } from "../AgentHoursStanding";
import { FREE_HOURS } from "./fixtures";

afterEach(cleanup);

describe("PlanCard's standing", () => {
  it("says a failed payment as a status, and that the plan stays in force", () => {
    render(<PlanCard planName="Team" standing={{ kind: "past-due", planId: "team" }} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/payment failed/);
    expect(status.textContent).toMatch(/The plan stays in force meanwhile/);
    expect(screen.getByText("Payment failed")).toBeTruthy();
  });

  it("names the day a canceled plan ends, and that nothing is deleted", () => {
    render(
      <PlanCard planName="Team" standing={{ kind: "ending", planId: "team", endsAt: new Date("2027-03-01T00:00:00Z") }} />,
    );
    expect(screen.getByText(/^Canceled\. The plan stays in force until Mar 1, 2027/)).toBeTruthy();
    expect(screen.getByText(/Nothing you built is deleted/)).toBeTruthy();
  });
});

describe("AgentHoursStanding", () => {
  it("draws the hours used of those included over a meter, with the plan's terms", () => {
    render(<AgentHoursStanding hours={FREE_HOURS} />);
    expect(screen.getByText("3.2 h of 10 h used this month")).toBeTruthy();
    const meter = screen.getByRole("meter", { name: "Agent hours used" });
    expect([meter.getAttribute("aria-valuenow"), meter.getAttribute("aria-valuemax")]).toEqual(["11520", "36000"]);
    expect(screen.getByText("Resets Mar 1, 2027 (UTC). New work pauses at the allowance.")).toBeTruthy();
  });
});
