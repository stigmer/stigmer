/**
 * InvitationRedemption names the organization from the preview's org_name,
 * before and after the invitation is accepted, and falls back to a plain
 * phrase when the preview carries none. A preview that fails to load
 * shows why, and Try again reads it again. Its acts read in sentence case:
 * a signed-in visitor accepts; a signed-out one is sent to sign in by the
 * same words, or, when the host can open its sign-up screen (`onSignUp`),
 * is offered a new account first and sign-in second (stigmer#3204). The
 * preview and redeem hooks are stubbed.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InvitationSchema } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import { getUserMessage } from "@stigmer/client";

const state = vi.hoisted(() => ({
  orgName: "Acme Robotics",
  error: null as Error | null,
  refetch: (() => {}) as () => void,
}));

vi.mock("../useInvitationPreview.js", () => ({
  useInvitationPreview: () => ({
    preview: { isValid: true, orgName: state.orgName, orgLogoUrl: "", role: 0 },
    isLoading: false,
    error: state.error,
    refetch: state.refetch,
  }),
}));

vi.mock("../useRedeemInvitation.js", () => ({
  useRedeemInvitation: () => ({
    redeem: async () => create(InvitationSchema, {}),
    isRedeeming: false,
    error: null,
    clearError: () => {},
  }),
}));

import { InvitationRedemption } from "../InvitationRedemption";

afterEach(() => {
  cleanup();
  state.orgName = "Acme Robotics";
  state.error = null;
  state.refetch = () => {};
});

describe("InvitationRedemption names the organization from org_name", () => {
  it("before and after accepting", async () => {
    render(<InvitationRedemption token="tok_1" isAuthenticated />);
    expect(screen.getAllByText(/Acme Robotics/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));
    expect(await screen.findByText(/joined Acme Robotics/)).toBeTruthy();
  });

  it("falls back to a plain phrase when the preview names no organization", async () => {
    state.orgName = "";
    render(<InvitationRedemption token="tok_1" isAuthenticated />);
    expect(screen.getAllByText(/Unknown organization/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));
    expect(await screen.findByText(/joined the organization/)).toBeTruthy();
  });
});

describe("InvitationRedemption when the preview fails to load", () => {
  it("says why, and Try again reads the preview again", () => {
    const refetch = vi.fn();
    state.error = new Error("network down");
    state.refetch = refetch;
    render(<InvitationRedemption token="tok_1" isAuthenticated />);

    expect(screen.getByText(getUserMessage(state.error))).toBeTruthy();
    expect(screen.queryByRole("button", { name: /accept invitation/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe("InvitationRedemption's acts", () => {
  it("offers a signed-in visitor one act, in sentence case", () => {
    render(<InvitationRedemption token="tok_1" isAuthenticated onSignUp={() => {}} />);

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Accept invitation"]);
  });

  it("sends a signed-out visitor to sign in by one act when the host offers no sign-up", () => {
    const onAuthRequired = vi.fn();
    render(<InvitationRedemption token="tok_1" isAuthenticated={false} onAuthRequired={onAuthRequired} />);

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Accept invitation"]);
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });

  it("offers a signed-out visitor a new account first and sign-in second when the host can sign them up", () => {
    const onAuthRequired = vi.fn();
    const onSignUp = vi.fn();
    render(
      <InvitationRedemption token="tok_1" isAuthenticated={false} onAuthRequired={onAuthRequired} onSignUp={onSignUp} />,
    );

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Create your account and join",
      "I already have an account",
    ]);
    expect(screen.queryByRole("button", { name: "Accept invitation" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Create your account and join" }));
    expect(onSignUp).toHaveBeenCalledTimes(1);
    expect(onAuthRequired).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "I already have an account" }));
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(onSignUp).toHaveBeenCalledTimes(1);
  });
});
