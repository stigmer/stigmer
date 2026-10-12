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

/** A billing client whose every call records its input and answers empty. */
function stubBilling() {
  const billing = {
    getBillingUsageReport: vi.fn(async (_input: unknown) => ({})),
    createBillingPortalSession: vi.fn(async (_input: unknown) => ({ portalUrl: "" })),
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
});
