/**
 * useAgentSetupFailure under a mounted OrgProvider: a pinned chat's setup
 * failure is classified once, after the provider's organization list has
 * settled, and a provider that later reloads never re-classifies it (the
 * host's onError hears each failure once). A list that failed to load says
 * nothing about which organizations are the caller's, so a NotFound is the
 * agent's, never "none of your organizations is named that".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { StigmerContext } from "@stigmer/react-core";
import { OrgProvider, useOrg } from "../../organization/OrgProvider";
import { useAgentSetupFailure } from "../useAgentSetupFailure";

afterEach(cleanup);

const ACME = { metadata: { id: "org_01jaaaaaaaaaaaaaaaaaaaaaaa", slug: "acme", name: "Acme" } } as Organization;

/** A client whose organization list answers when `answer` is called. */
function deferredClient() {
  let answer: (orgs: Organization[] | Error) => void = () => {};
  const listMine = vi.fn(
    () =>
      new Promise((resolve, reject) => {
        answer = (orgs) => (orgs instanceof Error ? reject(orgs) : resolve({ entries: orgs, nextPageToken: "" }));
      }),
  );
  const client = {
    organization: { listMine, get: vi.fn().mockRejectedValue(new Error("not read")), listMineAll: vi.fn() },
    identityAccount: { whoAmI: vi.fn().mockRejectedValue(new Error("not an app user")) },
  };
  return { client, listMine, answer: (orgs: Organization[] | Error) => answer(orgs) };
}

function wrapperFor(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        <OrgProvider>{children}</OrgProvider>
      </StigmerContext.Provider>
    );
  };
}

const NOT_FOUND = new ConnectError("not found", Code.NotFound);

describe("useAgentSetupFailure under an OrgProvider", () => {
  it("waits for the provider's list, classifies once, and keeps that answer when the provider reloads", async () => {
    const { client, listMine, answer } = deferredClient();
    const { result } = renderHook(
      () => ({ classified: useAgentSetupFailure(NOT_FOUND, "globex", "reporter"), refresh: useOrg().refresh }),
      { wrapper: wrapperFor(client) },
    );

    // The list is still loading: no answer yet, not a guess from an empty list.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.classified).toBeNull();

    await act(async () => {
      answer([ACME]);
    });
    await waitFor(() => expect(result.current.classified?.reason).toBe("organization-not-found"));
    const first = result.current.classified;

    // The provider reloads (its list's identity changes): the same failure keeps its classification.
    await act(async () => {
      result.current.refresh();
    });
    await act(async () => {
      answer([ACME]);
    });
    await waitFor(() => expect(listMine).toHaveBeenCalledTimes(2));
    expect(result.current.classified).toBe(first);
  });

  it("reads a list that failed to load as unread: a NotFound is the agent's", async () => {
    const { client, answer } = deferredClient();
    const { result } = renderHook(() => useAgentSetupFailure(NOT_FOUND, "acme", "reporter"), { wrapper: wrapperFor(client) });

    await act(async () => {
      answer(new Error("unavailable"));
    });
    await waitFor(() => expect(result.current?.reason).toBe("agent-not-found"));
  });
});
