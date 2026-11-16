/**
 * The gate on uploading a skill asks the server's own bar,
 * `can_create_skill` on the organization (its admins), and fails closed, so
 * a member is never offered an upload the server refuses:
 *
 *   - nothing is asked, and nothing is allowed, while the organization is
 *     still loading;
 *   - nothing is allowed while the answer is in flight, or when the check
 *     fails;
 *   - the answer is the server's for that organization.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { useCanCreateSkill } from "../useCanCreateSkill";

type PermissionInput = {
  resource?: { kind: string; id: string };
  relation: string;
};

function createMockStigmer(answer: () => Promise<{ isAuthorized: boolean }>) {
  return {
    grant: {
      checkMyPermission: vi.fn(async (_input: PermissionInput) => answer()),
    },
  };
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

afterEach(() => {
  cleanup();
});

describe("useCanCreateSkill", () => {
  it("allows nothing and asks nothing while the organization is loading", () => {
    const client = createMockStigmer(async () => ({ isAuthorized: true }));
    const { result } = renderHook(() => useCanCreateSkill(null), { wrapper: wrapper(client) });

    expect(result.current).toEqual({ allowed: false, isLoading: false });
    expect(client.grant.checkMyPermission).not.toHaveBeenCalled();
  });

  it("allows nothing while the answer is in flight", () => {
    const client = createMockStigmer(() => new Promise(() => {}));
    const { result } = renderHook(() => useCanCreateSkill("org_acme"), { wrapper: wrapper(client) });

    expect(result.current).toEqual({ allowed: false, isLoading: true });
  });

  it("allows nothing when the check fails", async () => {
    const client = createMockStigmer(async () => {
      throw new Error("unavailable");
    });
    const { result } = renderHook(() => useCanCreateSkill("org_acme"), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allowed).toBe(false);
  });

  it("asks can_create_skill on the organization and follows the answer", async () => {
    const client = createMockStigmer(async () => ({ isAuthorized: true }));
    const { result } = renderHook(() => useCanCreateSkill("org_acme"), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.allowed).toBe(true));
    const asked = client.grant.checkMyPermission.mock.calls[0]![0];
    expect(asked.relation).toBe("can_create_skill");
    expect(asked.resource).toMatchObject({ kind: "organization", id: "org_acme" });
  });
});
