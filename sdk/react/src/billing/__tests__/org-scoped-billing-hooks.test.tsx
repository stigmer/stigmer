/**
 * The billing hooks name the organization they act for as `org` on the
 * wire. A stub client behind StigmerContext records each request; no
 * Stripe redirect happens, because the stub answers with no URL to leave
 * for.
 */
import { createElement, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Stigmer } from "@stigmer/sdk";

import { StigmerContext } from "../../context";
import { useCreateBillingPortalSession } from "../useCreateBillingPortalSession";

/** A billing client whose every call records its input and answers empty. */
function stubBilling() {
  const billing = {
    createBillingPortalSession: vi.fn(async (_input: unknown) => ({ portalUrl: "" })),
  };
  const client = { billing } as unknown as Stigmer;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(StigmerContext.Provider, { value: client }, children);
  return { billing, wrapper };
}

describe("the billing hooks send org", () => {
  it("useCreateBillingPortalSession opens the organization's portal", async () => {
    const { billing, wrapper } = stubBilling();
    const { result } = renderHook(() => useCreateBillingPortalSession({ returnUrl: "https://console.test/billing" }), { wrapper });
    await act(() => result.current.openPortal("acme"));
    expect(billing.createBillingPortalSession.mock.calls[0]?.[0]).toMatchObject({ org: "acme" });
  });
});
