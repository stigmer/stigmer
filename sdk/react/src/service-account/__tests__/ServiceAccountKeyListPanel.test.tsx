/**
 * Pins the service-account key list (`ServiceAccountKeyListPanel`): it
 * reads the keys of the account it is given (`findByAccount`), says so when
 * the account has none, and hands the host a refetch that reads them again,
 * as the detail panel does after creating a key.
 *
 * The generated client is a fake behind the one provider seam.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { ApiKeysSchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";
import { StigmerContext } from "../../context";
import { ServiceAccountKeyListPanel } from "../ServiceAccountKeyListPanel";

const asked = vi.hoisted(() => ({ accounts: [] as string[] }));

function wrapper({ children }: { children: ReactNode }) {
  const client = {
    apiKey: {
      findByAccount: async (id: string) => {
        asked.accounts.push(id);
        return create(ApiKeysSchema, { entries: [] });
      },
    },
  } as unknown as Stigmer;
  return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
}

afterEach(() => {
  cleanup();
  asked.accounts = [];
});

describe("ServiceAccountKeyListPanel", () => {
  it("reads the account's keys and says so when it has none", async () => {
    render(<ServiceAccountKeyListPanel serviceAccountId="ida_sa_ci" />, { wrapper });
    expect(
      await screen.findByText("No keys yet. Create one for each place this service account runs."),
    ).toBeTruthy();
    expect(asked.accounts).toEqual(["ida_sa_ci"]);
  });

  it("hands the host a refetch that reads the keys again", async () => {
    let refetch: (() => void) | null = null;
    render(
      <ServiceAccountKeyListPanel serviceAccountId="ida_sa_ci" onRefetchRef={(fn) => (refetch = fn)} />,
      { wrapper },
    );
    await screen.findByText(/No keys yet/);
    act(() => refetch?.());
    await waitFor(() => expect(asked.accounts).toEqual(["ida_sa_ci", "ida_sa_ci"]));
  });
});
