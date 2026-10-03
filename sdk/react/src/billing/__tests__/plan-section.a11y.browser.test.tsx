// Accessibility audit — the plan surfaces.
//
// Covers the plan section on Free (the comparison list, its choices and the
// Enterprise link), an active plan with its estimated invoice (the
// definition list of lines, the standing badge), the confirm dialog, and
// the operator's plan catalog — each in light and dark against the shipped
// stylesheet, at the settings canvas's width.

import { afterEach, describe, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Stigmer } from "@stigmer/sdk";
import { SubscriptionState } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/status_pb";
import { COLOR_MODES, auditA11y, renderAudited, resetAudit } from "../../__tests__/helpers/a11y-audit.js";
import { PlanCatalogConsole } from "../../plan-catalog/PlanCatalogConsole.js";
import { PlanSection } from "../PlanSection.js";
import { BUSINESS, NOW, RETIRED, TEAM, TEAM_ESTIMATE, notFound, subscription } from "./fixtures.js";

const CANVAS = { width: 720, height: 1100 } as const;

function client(subscribed: boolean): Stigmer {
  return {
    plan: { list: async () => ({ entries: [TEAM, BUSINESS, RETIRED] }) },
    subscription: {
      getForOrg: async () => {
        if (!subscribed) throw notFound();
        return subscription(SubscriptionState.active);
      },
      getPeriodEstimate: async () => TEAM_ESTIMATE,
    },
    iamPolicy: { checkMyPermission: async () => ({ isAuthorized: true }) },
  } as unknown as Stigmer;
}

afterEach(resetAudit);

describe("Plan surfaces a11y", () => {
  it.each(COLOR_MODES)("Free with the comparison (%s)", async (mode) => {
    const container = renderAudited(<PlanSection org="acme" hasPaymentMethod now={NOW} />, mode, {
      ...CANVAS,
      client: client(false),
    });
    await screen.findByRole("list", { name: "Plans" });
    await auditA11y(container, `plan section free · ${mode}`);
  });

  it.each(COLOR_MODES)("an active plan with its estimate (%s)", async (mode) => {
    const container = renderAudited(<PlanSection org="acme" hasPaymentMethod now={NOW} />, mode, {
      ...CANVAS,
      client: client(true),
    });
    await screen.findByText("Estimated invoice on Feb 28, 2027");
    await auditA11y(container, `plan section active · ${mode}`);
  });

  it.each(COLOR_MODES)("the confirm dialog without a card (%s)", async (mode) => {
    const container = renderAudited(<PlanSection org="acme" hasPaymentMethod={false} now={NOW} />, mode, {
      ...CANVAS,
      client: client(false),
    });
    const [subscribe] = await screen.findAllByRole("button", { name: "Subscribe" });
    await userEvent.click(subscribe!);
    await screen.findByRole("button", { name: "Add a payment method" });
    await auditA11y(container, `plan confirm dialog · ${mode}`);
  });

  it.each(COLOR_MODES)("the operator's plan catalog (%s)", async (mode) => {
    const container = renderAudited(<PlanCatalogConsole />, mode, { ...CANVAS, client: client(false) });
    await screen.findByRole("list", { name: "Plan catalog" });
    await auditA11y(container, `plan catalog · ${mode}`);
  });
});
