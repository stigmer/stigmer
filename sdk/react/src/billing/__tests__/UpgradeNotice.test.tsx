// The upgrade notice at a plan refusal: the reason is read from the
// refusal's ErrorInfo (never its text), the server's copy is shown with the
// way to the plans, and any other error is not a plan refusal.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StigmerError } from "@stigmer/sdk";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { UpgradeNotice, planUpgradeFeature } from "../UpgradeNotice";
import { refusal } from "./fixtures";

afterEach(cleanup);

const TEAMS_COPY =
  "Teams need the Team plan or above. Organization 'acme' keeps its existing teams; upgrade its plan to create a team or add a member.";

describe("planUpgradeFeature", () => {
  it("reads the feature from the refusal's reason, not its copy", () => {
    expect(planUpgradeFeature(refusal(TEAMS_COPY, "PLAN_UPGRADE_REQUIRED", { feature: "teams", org: "acme" }))).toBe(
      Feature.teams,
    );
    expect(
      planUpgradeFeature(refusal("x", "PLAN_UPGRADE_REQUIRED", { feature: "managed_organizations", org: "p" })),
    ).toBe(Feature.managed_organizations);
    expect(
      planUpgradeFeature(refusal("x", "PLAN_UPGRADE_REQUIRED", { feature: "byo_provider_keys", org: "acme" })),
    ).toBe(Feature.byo_provider_keys);
    expect(planUpgradeFeature(new StigmerError("failed-precondition", TEAMS_COPY, 9))).toBeNull();
    expect(planUpgradeFeature(refusal("x", "PAYMENT_METHOD_REQUIRED", { org: "acme" }))).toBeNull();
  });
});

describe("UpgradeNotice", () => {
  it("shows the server's copy and links to the host's plans", () => {
    const error = refusal(TEAMS_COPY, "PLAN_UPGRADE_REQUIRED", { feature: "teams", org: "acme" });
    render(<UpgradeNotice feature={Feature.teams} error={error} billingHref="/org/acme/billing" />);
    expect(screen.getByText(TEAMS_COPY)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View plans" }).getAttribute("href")).toBe("/org/acme/billing");
  });

  it("names the plan that unlocks the feature ahead of an attempt", () => {
    render(<UpgradeNotice feature={Feature.teams} unlockingPlanName="Team" />);
    expect(screen.getByText("Teams need the Team plan or above.")).toBeTruthy();
  });

  it("names the feature ahead of an attempt when no plan is known", () => {
    render(<UpgradeNotice feature={Feature.teams} />);
    expect(screen.getByText("Teams are not included in this organization's plan.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View plans" }).getAttribute("href")).toBe("/settings/billing");
  });
});
