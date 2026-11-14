// The plan dialog's own words for a withdrawn cancellation: the resume move
// says the cancellation is withdrawn and the plan runs on, in the dialog's
// quiet supporting tone (the kit's text styling, so the kit's margin reset
// reaches it in a host without a CSS reset).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { PlanSchema } from "@stigmer/apis/ai/stigmer/billing/plan/v1/api_pb";
import { ChangePlanDialog } from "../ChangePlanDialog.js";

afterEach(cleanup);

describe("ChangePlanDialog", () => {
  it("says a resumed plan runs on, the cancellation withdrawn", () => {
    const team = create(PlanSchema, { metadata: { id: "pln_team", name: "Team" } });
    render(
      <ChangePlanDialog
        move={{ kind: "resume", to: team }}
        planName={() => "Team"}
        hasPaymentMethod
        isSubmitting={false}
        error={null}
        onConfirm={vi.fn()}
        onAddPaymentMethod={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const words = screen.getByText("The cancellation is withdrawn, and Team runs on into its next period.");
    expect(words.tagName).toBe("P");
    expect(words.className).toContain("stg:text-muted-foreground");
  });
});
