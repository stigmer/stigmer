/**
 * BillingSection buys credits for the active organization: choosing a pack
 * starts a checkout whose input names the organization as `org`. A child
 * organization's plan card is told it is billed to its parent, named when
 * the person belongs to the parent too. The organization context, the
 * billing hooks and the child cards are stubbed; the pack grid is a single
 * button that buys the "growth" pack, and the plan card prints what it is
 * told about the parent.
 */
import { create } from "@bufbuild/protobuf";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BillingAccountSchema, CreditBalanceSchema } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { BillingAccountStatus } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";

const checkouts = vi.hoisted(() => [] as unknown[]);

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
      balance: create(CreditBalanceSchema, {}),
    }),
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));

vi.mock("../useCreateCheckoutSession.js", () => ({
  useCreateCheckoutSession: () => ({
    createSession: async (input: unknown) => {
      checkouts.push(input);
      return {};
    },
    isSubmitting: false,
    error: null,
    clearError: () => {},
  }),
}));

vi.mock("../useCreateBillingPortalSession.js", () => ({
  useCreateBillingPortalSession: () => ({ openPortal: async () => {}, isLoading: false, error: null, clearError: () => {} }),
}));

vi.mock("../useCreatePaymentMethodSetupSession.js", () => ({
  useCreatePaymentMethodSetupSession: () => ({ addPaymentMethod: async () => {}, isLoading: false, error: null, clearError: () => {} }),
}));

vi.mock("../CreditPackGrid.js", () => ({
  CreditPackGrid: ({ onPurchase }: { onPurchase: (packId: string) => void }) => (
    <button type="button" onClick={() => onPurchase("growth")}>
      Buy growth
    </button>
  ),
}));

vi.mock("../PlanSection.js", () => ({
  PlanSection: ({ billedToParent }: { billedToParent: string | undefined }) => (
    <p data-testid="plan-billed-to">
      {billedToParent === undefined ? "own plan" : `billed to "${billedToParent}"`}
    </p>
  ),
}));
vi.mock("../CreditBalanceCard.js", () => ({ CreditBalanceCard: () => null }));
vi.mock("../PaymentMethodCard.js", () => ({ PaymentMethodCard: () => null }));
vi.mock("../AutoRechargeCard.js", () => ({ AutoRechargeCard: () => null }));
vi.mock("../CreditLedgerTable.js", () => ({ CreditLedgerTable: () => null }));
vi.mock("../LowBalanceBanner.js", () => ({ LowBalanceBanner: () => null }));

import { BillingSection } from "../BillingSection";

afterEach(() => {
  cleanup();
  checkouts.length = 0;
  orgState.activeOrg = undefined;
  orgState.orgs = [];
});

describe("BillingSection", () => {
  it("checks out a credit pack for the active organization", async () => {
    render(<BillingSection redirect={{ returnUrl: "https://console.test/settings/billing" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Buy growth" }));
    await waitFor(() => expect(checkouts).toHaveLength(1));
    expect(checkouts[0]).toMatchObject({ org: "acme", packId: "growth" });
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
