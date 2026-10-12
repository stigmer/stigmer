/**
 * BillingSection is the plan and the card on file for the active
 * organization, and nothing else: the section renders the plan section and
 * the payment-method card, with no balance, pack or history. A child
 * organization's plan card is told it is billed to its parent, named when
 * the person belongs to the parent too. The organization context, the
 * billing hooks and the child cards are stubbed; the plan card prints what
 * it is told about the parent, and the payment-method card the organization
 * it would open the portal for.
 */
import { create } from "@bufbuild/protobuf";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BillingAccountSchema } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { BillingAccountStatus } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";

const portals = vi.hoisted(() => [] as string[]);

interface OrgStub {
  metadata: { id: string; name?: string };
  spec: { parentOrg?: string };
}

const ACME: OrgStub = { metadata: { id: "acme" }, spec: {} };

const orgState = vi.hoisted(() => ({
  activeOrg: undefined as unknown,
  orgs: [] as unknown[],
}));

vi.mock("../../organization/OrgProvider.js", () => ({
  useOrg: () => ({ activeOrg: orgState.activeOrg ?? ACME, orgs: orgState.orgs }),
}));

vi.mock("../useBillingAccount.js", () => ({
  useBillingAccount: () => ({
    account: create(BillingAccountSchema, {
      status: BillingAccountStatus.billing_account_active,
    }),
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));

vi.mock("../useCreateBillingPortalSession.js", () => ({
  useCreateBillingPortalSession: () => ({
    openPortal: async (org: string) => {
      portals.push(org);
    },
    isLoading: false,
    error: null,
    clearError: () => {},
  }),
}));

vi.mock("../useCreatePaymentMethodSetupSession.js", () => ({
  useCreatePaymentMethodSetupSession: () => ({ addPaymentMethod: async () => {}, isLoading: false, error: null, clearError: () => {} }),
}));

vi.mock("../PlanSection.js", () => ({
  PlanSection: ({ billedToParent }: { billedToParent: string | undefined }) => (
    <p data-testid="plan-billed-to">
      {billedToParent === undefined ? "own plan" : `billed to "${billedToParent}"`}
    </p>
  ),
}));
vi.mock("../PaymentMethodCard.js", () => ({
  PaymentMethodCard: ({ onManage }: { onManage: () => void }) => (
    <button type="button" onClick={onManage}>
      Manage card
    </button>
  ),
}));

import { BillingSection } from "../BillingSection";

afterEach(() => {
  cleanup();
  portals.length = 0;
  orgState.activeOrg = undefined;
  orgState.orgs = [];
});

describe("BillingSection", () => {
  it("shows the plan and the card for the active organization, and nothing about credits", () => {
    const { container } = render(<BillingSection redirect={{ returnUrl: "https://console.test/settings/billing" }} />);
    expect(screen.getByTestId("plan-billed-to").textContent).toBe("own plan");
    fireEvent.click(screen.getByRole("button", { name: "Manage card" }));
    expect(portals).toEqual(["acme"]);
    expect(container.textContent).not.toMatch(/credit|balance|recharge/i);
  });

  it("tells a child organization's plan card it is billed to its parent, by name when the person belongs to the parent", () => {
    const child: OrgStub = { metadata: { id: "org_child" }, spec: { parentOrg: "org_parent" } };
    orgState.activeOrg = child;
    orgState.orgs = [child, { metadata: { id: "org_parent", name: "Planton" }, spec: {} }];
    render(<BillingSection />);
    expect(screen.getByTestId("plan-billed-to").textContent).toBe('billed to "Planton"');
    cleanup();

    orgState.orgs = [child];
    render(<BillingSection />);
    expect(screen.getByTestId("plan-billed-to").textContent).toBe('billed to ""');
    cleanup();

    orgState.activeOrg = ACME;
    render(<BillingSection />);
    expect(screen.getByTestId("plan-billed-to").textContent).toBe("own plan");
  });
});
