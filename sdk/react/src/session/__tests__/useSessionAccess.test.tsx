/**
 * useSessionAccess asks the server what the reader may do in a
 * conversation, one self-check per power:
 *
 *   - a viewer may neither send nor decide;
 *   - a participant sends but leaves stopping and approving to the owners;
 *   - an owner does both;
 *   - asked about no conversation, it asks the server nothing and hides
 *     nothing (a guest's or an observer's presentation is decided already).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { useSessionAccess } from "../useSessionAccess";

type PermissionInput = {
  resource?: { kind: string; id: string };
  relation: string;
};

/** A server whose answers are the relations the reader holds on the session. */
function serverGranting(held: readonly string[]) {
  return {
    iamPolicy: {
      checkMyPermission: vi.fn(async (input: PermissionInput) => ({
        isAuthorized: held.includes(input.relation),
      })),
    },
  };
}

function accessOf(client: unknown, sessionId: string | null) {
  return renderHook(() => useSessionAccess(sessionId), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
    ),
  });
}

afterEach(() => {
  cleanup();
});

describe("useSessionAccess", () => {
  it("lets a viewer neither send nor decide", async () => {
    const client = serverGranting([]);
    const { result } = accessOf(client, "ses_1");
    await waitFor(() => expect(client.iamPolicy.checkMyPermission).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current).toEqual({ canSend: false, canDecide: false }));
  });

  it("lets a participant send, and leaves decisions to the owners", async () => {
    const { result } = accessOf(serverGranting(["can_create_run_in"]), "ses_1");
    await waitFor(() => expect(result.current).toEqual({ canSend: true, canDecide: false }));
  });

  it("lets an owner send and decide, asking about that conversation", async () => {
    const client = serverGranting(["can_create_run_in", "can_edit"]);
    const { result } = accessOf(client, "ses_1");
    await waitFor(() => expect(client.iamPolicy.checkMyPermission).toHaveBeenCalledTimes(2));
    expect(result.current).toEqual({ canSend: true, canDecide: true });
    const asked = client.iamPolicy.checkMyPermission.mock.calls.map((call) => call[0]);
    expect(asked.map((input) => input.relation).sort()).toEqual(["can_create_run_in", "can_edit"]);
    for (const input of asked) {
      expect(input.resource).toMatchObject({ kind: "session", id: "ses_1" });
    }
  });

  it("asks nothing about no conversation and hides nothing", () => {
    const client = serverGranting([]);
    const { result } = accessOf(client, null);
    expect(result.current).toEqual({ canSend: true, canDecide: true });
    expect(client.iamPolicy.checkMyPermission).not.toHaveBeenCalled();
  });
});
