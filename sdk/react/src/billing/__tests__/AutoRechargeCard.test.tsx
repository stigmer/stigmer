/**
 * AutoRechargeCard saves the configuration for the organization it was
 * given, named as `org`. The save hook is stubbed and records its input.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BillingAccountStatus } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";

const saved = vi.hoisted(() => [] as unknown[]);

vi.mock("../useSetAutoRechargeConfig.js", () => ({
  useSetAutoRechargeConfig: () => ({
    setConfig: async (input: unknown) => {
      saved.push(input);
      return {};
    },
    isSubmitting: false,
    error: null,
    clearError: () => {},
  }),
}));

import { AutoRechargeCard } from "../AutoRechargeCard";

afterEach(() => {
  cleanup();
  saved.length = 0;
});

describe("AutoRechargeCard", () => {
  it("saves the recharge configuration for the organization it was given", async () => {
    render(
      <AutoRechargeCard
        org="acme"
        hasPaymentMethod
        accountStatus={BillingAccountStatus.billing_account_active}
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ org: "acme", enabled: true });
  });
});
