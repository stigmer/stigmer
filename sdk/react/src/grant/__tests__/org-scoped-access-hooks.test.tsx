/**
 * The organization-access hooks name the organization as `org` on the wire:
 * counting its people, and removing a person from it. A stub client behind
 * StigmerContext records each request.
 */
import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Stigmer } from "@stigmer/client";

import { StigmerContext } from "../../context";
import { usePrincipalsCount } from "../usePrincipalsCount";
import { useRevokeOrgAccess } from "../useRevokeOrgAccess";

function stubGrant() {
  const grant = {
    getPrincipalsCount: vi.fn(async (_input: unknown) => ({ count: 7 })),
    revokeOrgAccess: vi.fn(async (_input: unknown) => ({})),
  };
  const client = { grant } as unknown as Stigmer;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(StigmerContext.Provider, { value: client }, children);
  return { grant, wrapper };
}

describe("the organization-access hooks send org", () => {
  it("usePrincipalsCount counts the organization's people, and asks nothing without one", async () => {
    const { grant, wrapper } = stubGrant();
    const { result } = renderHook(() => usePrincipalsCount("acme"), { wrapper });
    await waitFor(() => expect(result.current.count).toBe(7));
    expect(grant.getPrincipalsCount.mock.calls[0]?.[0]).toMatchObject({ org: "acme", principalKind: "identity_account" });

    const none = stubGrant();
    renderHook(() => usePrincipalsCount(null), { wrapper: none.wrapper });
    expect(none.grant.getPrincipalsCount).not.toHaveBeenCalled();
  });

  it("useRevokeOrgAccess removes the person from the named organization", async () => {
    const { grant, wrapper } = stubGrant();
    const { result } = renderHook(() => useRevokeOrgAccess(), { wrapper });
    await act(() => result.current.revoke("ia_alice", "acme"));
    expect(grant.revokeOrgAccess.mock.calls[0]?.[0]).toMatchObject({ identityAccountId: "ia_alice", org: "acme" });
  });
});
