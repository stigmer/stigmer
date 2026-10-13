// ---------------------------------------------------------------------------
// AccessMoveFinishPage — the access move's second half
//
// It redeems the ticket the first half kept in this tab and drops it once
// the move finished or was refused; a redeem the server failed partway
// keeps the ticket and offers to try again, which finishes the move. With
// no ticket in the tab it says there is no move to finish and redeems
// nothing.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Code, ConnectError } from "@connectrpc/connect";

const mocks = vi.hoisted(() => ({
  redeemed: [] as string[],
  refuse: false,
  fault: false,
}));

vi.mock("@stigmer/react", () => ({
  useRedeemAccessMove: () => ({
    redeem: (ticket: string) => {
      mocks.redeemed.push(ticket);
      if (mocks.refuse) {
        return Promise.reject(new Error("refused"));
      }
      if (mocks.fault) {
        return Promise.reject(faultError());
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
      : mocks.fault
        ? faultError()
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

function faultError(): ConnectError {
  return new ConnectError("the server failed partway", Code.Internal);
}

import { AccessMoveFinishPage } from "../AccessMoveFinishPage";
import { readPendingMove, savePendingMove } from "../move-ticket";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  mocks.redeemed = [];
  mocks.refuse = false;
  mocks.fault = false;
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

  it("keeps the ticket when the server failed partway, and finishes the move on another try", async () => {
    mocks.fault = true;
    savePendingMove({ ticket: "tkt_secret", org: "org_acme" });
    const view = render(<AccessMoveFinishPage />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(readPendingMove()?.ticket).toBe("tkt_secret");

    mocks.fault = false;
    fireEvent.click(retry);
    view.rerender(<AccessMoveFinishPage />);
    expect(await screen.findByTestId("summary")).toBeTruthy();
    expect(mocks.redeemed).toEqual(["tkt_secret", "tkt_secret"]);
    expect(readPendingMove()).toBeNull();
  });

  it("says there is no move to finish when the tab holds no ticket", async () => {
    render(<AccessMoveFinishPage />);
    expect(
      await screen.findByText(/There is no move to finish in this tab/),
    ).toBeTruthy();
    expect(mocks.redeemed).toEqual([]);
  });
});
