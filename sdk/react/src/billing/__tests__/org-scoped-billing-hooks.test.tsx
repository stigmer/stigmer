/**
 * The billing hooks name the organization they act for as `org` on the
 * wire, and send nothing when they are given no organization. A stub client
 * behind StigmerContext records each request; no Stripe redirect happens,
 * because the stub answers with no URL to leave for.
 */
import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Stigmer } from "@stigmer/sdk";

import { StigmerContext } from "../../context";
import { useBillingUsageReport } from "../useBillingUsageReport";
import { useCreateBillingPortalSession } from "../useCreateBillingPortalSession";
import { useCreateCheckoutSession } from "../useCreateCheckoutSession";
import { useCustomerModelPricing } from "../useCustomerModelPricing";
import { useSetAutoRechargeConfig } from "../useSetAutoRechargeConfig";

/** A billing client whose every call records its input and answers empty. */
function stubBilling() {
  const billing = {
    getBillingUsageReport: vi.fn(async (_input: unknown) => ({})),
    createBillingPortalSession: vi.fn(async (_input: unknown) => ({ portalUrl: "" })),
    createCreditCheckoutSession: vi.fn(async (_input: unknown) => ({ checkoutUrl: "" })),
    getCustomerModelPricing: vi.fn(async (_input?: unknown) => ({})),
    setAutoRechargeConfig: vi.fn(async (_input: unknown) => ({})),
  };
  const client = { billing } as unknown as Stigmer;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(StigmerContext.Provider, { value: client }, children);
  return { billing, wrapper };
}

describe("the billing hooks send org", () => {
  it("useBillingUsageReport asks for the organization's report, and nothing without one", async () => {
    const { billing, wrapper } = stubBilling();
    const start = new Date("2026-09-01T00:00:00Z");
    const end = new Date("2026-09-30T00:00:00Z");
    renderHook(() => useBillingUsageReport("acme", start, end), { wrapper });
    await waitFor(() => expect(billing.getBillingUsageReport).toHaveBeenCalledTimes(1));
    expect(billing.getBillingUsageReport.mock.calls[0]?.[0]).toEqual({ org: "acme", startTime: start, endTime: end });

    const none = stubBilling();
    renderHook(() => useBillingUsageReport(null, start, end), { wrapper: none.wrapper });
    expect(none.billing.getBillingUsageReport).not.toHaveBeenCalled();
  });

  it("useCreateBillingPortalSession opens the organization's portal", async () => {
    const { billing, wrapper } = stubBilling();
    const { result } = renderHook(() => useCreateBillingPortalSession({ returnUrl: "https://console.test/billing" }), { wrapper });
    await act(() => result.current.openPortal("acme"));
    expect(billing.createBillingPortalSession.mock.calls[0]?.[0]).toMatchObject({ org: "acme" });
  });

  it("useCreateCheckoutSession checks out for the organization", async () => {
    const { billing, wrapper } = stubBilling();
    const { result } = renderHook(() => useCreateCheckoutSession(), { wrapper });
    await act(() =>
      result.current.createSession({ org: "acme", packId: "starter", successUrl: "https://ok.test", cancelUrl: "https://no.test" }),
    );
    expect(billing.createCreditCheckoutSession.mock.calls[0]?.[0]).toEqual({
      org: "acme",
      packId: "starter",
      successUrl: "https://ok.test",
      cancelUrl: "https://no.test",
    });
  });

  it("useCustomerModelPricing asks for the organization's prices, the defaults without one, and nothing for null", async () => {
    const scoped = stubBilling();
    renderHook(() => useCustomerModelPricing("acme"), { wrapper: scoped.wrapper });
    await waitFor(() => expect(scoped.billing.getCustomerModelPricing).toHaveBeenCalledTimes(1));
    expect(scoped.billing.getCustomerModelPricing.mock.calls[0]?.[0]).toEqual({ org: "acme" });

    const defaults = stubBilling();
    renderHook(() => useCustomerModelPricing(undefined), { wrapper: defaults.wrapper });
    await waitFor(() => expect(defaults.billing.getCustomerModelPricing).toHaveBeenCalledTimes(1));
    expect(defaults.billing.getCustomerModelPricing.mock.calls[0]?.[0]).toBeUndefined();

    const skipped = stubBilling();
    renderHook(() => useCustomerModelPricing(null), { wrapper: skipped.wrapper });
    expect(skipped.billing.getCustomerModelPricing).not.toHaveBeenCalled();
  });

  it("useSetAutoRechargeConfig configures the organization's recharge", async () => {
    const { billing, wrapper } = stubBilling();
    const { result } = renderHook(() => useSetAutoRechargeConfig(), { wrapper });
    await act(() =>
      result.current.setConfig({
        org: "acme",
        enabled: true,
        thresholdMicros: 1n,
        rechargeAmountMicros: 2n,
        monthlyCapMicros: 3n,
      }),
    );
    expect(billing.setAutoRechargeConfig.mock.calls[0]?.[0]).toMatchObject({ org: "acme", enabled: true });
  });
});
