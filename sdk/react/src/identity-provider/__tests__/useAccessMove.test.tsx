/**
 * Pins the access move's hooks: each asks the identity-provider client with
 * the request it names, answers the server's answer, and holds the error
 * (and rethrows it) when the server refuses; the owners' preview hook reads
 * only when given an organization.
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { create } from "@bufbuild/protobuf";
import {
  AccessMoveResultSchema,
  AccessMoveTicketSchema,
  SsoRequirementPreviewSchema,
} from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { StigmerContext } from "../../context";
import { useCreateAccessMove, useRedeemAccessMove } from "../useAccessMove";
import { usePreviewSsoRequirement } from "../usePreviewSsoRequirement";

function wrapper(identityProvider: Record<string, unknown>) {
  const client = { identityProvider } as unknown as Stigmer;
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
}

describe("useCreateAccessMove", () => {
  it("asks for a ticket for the organization and answers it", async () => {
    const createAccessMove = vi.fn().mockResolvedValue(create(AccessMoveTicketSchema, { ticket: "tkt", org: "org_acme" }));
    const { result } = renderHook(() => useCreateAccessMove(), { wrapper: wrapper({ createAccessMove }) });
    let ticket = "";
    await act(async () => {
      ticket = (await result.current.createMove("org_acme")).ticket;
    });
    expect(ticket).toBe("tkt");
    expect(createAccessMove.mock.calls[0]?.[0]).toMatchObject({ org: "org_acme" });
    expect(result.current.error).toBeNull();
  });

  it("holds and rethrows a refusal, and clears it on request", async () => {
    const refusal = new Error("You hold no access in this organization to move");
    const { result } = renderHook(() => useCreateAccessMove(), {
      wrapper: wrapper({ createAccessMove: vi.fn().mockRejectedValue(refusal) }),
    });
    await act(async () => {
      await expect(result.current.createMove("org_acme")).rejects.toBe(refusal);
    });
    expect(result.current.error?.message).toBe(refusal.message);
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

describe("useRedeemAccessMove", () => {
  it("redeems the ticket and answers what moved", async () => {
    const redeemAccessMove = vi.fn().mockResolvedValue(create(AccessMoveResultSchema, { org: "org_acme" }));
    const { result } = renderHook(() => useRedeemAccessMove(), { wrapper: wrapper({ redeemAccessMove }) });
    let org = "";
    await act(async () => {
      org = (await result.current.redeem("tkt")).org;
    });
    expect(org).toBe("org_acme");
    expect(redeemAccessMove.mock.calls[0]?.[0]).toMatchObject({ ticket: "tkt" });
  });

  it("holds and rethrows a refusal, and clears it on request", async () => {
    const refusal = new Error("This access move is no longer valid; start it again");
    const { result } = renderHook(() => useRedeemAccessMove(), {
      wrapper: wrapper({ redeemAccessMove: vi.fn().mockRejectedValue(refusal) }),
    });
    await act(async () => {
      await expect(result.current.redeem("tkt")).rejects.toBe(refusal);
    });
    expect(result.current.error?.message).toBe(refusal.message);
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

describe("usePreviewSsoRequirement", () => {
  it("reads the organization's preview, and nothing without one", async () => {
    const previewSsoRequirement = vi.fn().mockResolvedValue(create(SsoRequirementPreviewSchema, {}));
    const { result } = renderHook(() => usePreviewSsoRequirement("org_acme"), {
      wrapper: wrapper({ previewSsoRequirement }),
    });
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    expect(previewSsoRequirement.mock.calls[0]?.[0]).toMatchObject({ org: "org_acme" });
    const idle = vi.fn();
    renderHook(() => usePreviewSsoRequirement(null), { wrapper: wrapper({ previewSsoRequirement: idle }) });
    expect(idle).not.toHaveBeenCalled();
  });
});
