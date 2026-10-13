// ---------------------------------------------------------------------------
// AccessMoveFinishPage — the access move's second half
//
// It redeems the ticket the first half kept in this tab, once, and drops it
// whatever the answer; with no ticket in the tab it says there is no move
// to finish and redeems nothing.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  redeemed: [] as string[],
  refuse: false,
}));

vi.mock("@stigmer/react", () => ({
  useRedeemAccessMove: () => ({
    redeem: (ticket: string) => {
      mocks.redeemed.push(ticket);
      if (mocks.refuse) {
        return Promise.reject(new Error("refused"));
      }
      return Promise.resolve({
        org: "org_acme",
        invitationIds: [],
        moved: { movedPolicies: 2, myVaultEntries: [], automations: [] },
      });
    },
    isRedeeming: false,
    error: mocks.refuse
      ? new Error("Finish moving your access while signed in through Acme Okta")
      : null,
  }),
  AccessMoveSummary: () => <div data-testid="summary" />,
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import { AccessMoveFinishPage } from "../AccessMoveFinishPage";
import { readPendingMove, savePendingMove } from "../move-ticket";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  mocks.redeemed = [];
  mocks.refuse = false;
});

describe("AccessMoveFinishPage", () => {
  it("redeems the tab's ticket once, shows what moved, and drops the ticket", async () => {
    savePendingMove({ ticket: "tkt_secret", org: "org_acme" });
    render(<AccessMoveFinishPage />);
    expect(await screen.findByTestId("summary")).toBeTruthy();
    expect(mocks.redeemed).toEqual(["tkt_secret"]);
    expect(readPendingMove()).toBeNull();
  });

  it("shows a refused redeem and drops the ticket", async () => {
    mocks.refuse = true;
    savePendingMove({ ticket: "tkt_secret", org: "org_acme" });
    render(<AccessMoveFinishPage />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Finish moving your access while signed in through Acme Okta",
    );
    await vi.waitFor(() => expect(readPendingMove()).toBeNull());
  });

  it("says there is no move to finish when the tab holds no ticket", async () => {
    render(<AccessMoveFinishPage />);
    expect(
      await screen.findByText(/There is no move to finish in this tab/),
    ).toBeTruthy();
    expect(mocks.redeemed).toEqual([]);
  });
});
