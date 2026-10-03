/**
 * BillingSection buys credits for the active organization: choosing a pack
 * starts a checkout whose input names the organization as `org`. The
 * organization context, the billing hooks and the child cards are stubbed;
 * the pack grid is a single button that buys the "growth" pack.
 */
import { create } from "@bufbuild/protobuf";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BillingAccountSchema, CreditBalanceSchema } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { BillingAccountStatus } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";

const checkouts = vi.hoisted(() => [] as unknown[]);

vi.mock("../../organization/OrgProvider.js", () => ({
  useOrg: () => ({ activeOrg: { metadata: { id: "acme" }, spec: {} } }),
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

vi.mock("../PlanSection.js", () => ({ PlanSection: () => null }));
vi.mock("../CreditBalanceCard.js", () => ({ CreditBalanceCard: () => null }));
vi.mock("../PaymentMethodCard.js", () => ({ PaymentMethodCard: () => null }));
vi.mock("../AutoRechargeCard.js", () => ({ AutoRechargeCard: () => null }));
vi.mock("../CreditLedgerTable.js", () => ({ CreditLedgerTable: () => null }));
vi.mock("../LowBalanceBanner.js", () => ({ LowBalanceBanner: () => null }));

import { BillingSection } from "../BillingSection";

afterEach(() => {
  cleanup();
  checkouts.length = 0;
});

describe("BillingSection", () => {
  it("checks out a credit pack for the active organization", async () => {
    render(<BillingSection redirect={{ returnUrl: "https://console.test/settings/billing" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Buy growth" }));
    await waitFor(() => expect(checkouts).toHaveLength(1));
    expect(checkouts[0]).toMatchObject({ org: "acme", packId: "growth" });
  });
});
