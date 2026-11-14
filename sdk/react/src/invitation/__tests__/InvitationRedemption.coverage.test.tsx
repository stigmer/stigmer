/**
 * InvitationRedemption's three non-joinable faces: a preview that failed to
 * load (with a "Try again" act that fetches it again), a token the server
 * does not know, and an invitation that is no longer valid, which states
 * the server's reason (or a plain one) in place of the accept button. The
 * preview and redeem hooks are stubbed.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InvitationSchema } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";

interface PreviewStub {
  isValid: boolean;
  invalidReason: string;
  orgName: string;
  orgLogoUrl: string;
  role: number;
}

const state = vi.hoisted(() => ({
  preview: null as PreviewStub | null,
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock("../useInvitationPreview.js", () => ({
  useInvitationPreview: () => ({
    preview: state.preview,
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

function invalidPreview(invalidReason: string): PreviewStub {
  return { isValid: false, invalidReason, orgName: "Acme Robotics", orgLogoUrl: "", role: 0 };
}

afterEach(() => {
  cleanup();
  state.preview = null;
  state.error = null;
  state.refetch.mockReset();
});

describe("InvitationRedemption", () => {
  it("shows a failed preview fetch and fetches again on Try again", () => {
    state.error = new Error("invitation service unreachable");
    render(<InvitationRedemption token="tok_1" isAuthenticated />);

    expect(screen.getByRole("alert").textContent).toContain("invitation service unreachable");
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it("says the invitation could not be found when no preview comes back", () => {
    render(<InvitationRedemption token="tok_missing" isAuthenticated />);

    expect(screen.getByText("This invitation could not be found.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /accept invitation/i })).toBeNull();
  });

  it("states the server's reason for an invalid invitation in place of the accept button", () => {
    state.preview = invalidPreview("This invitation has expired.");
    render(<InvitationRedemption token="tok_1" isAuthenticated />);

    expect(screen.getByText("Join Acme Robotics")).toBeTruthy();
    expect(screen.getByText("This invitation has expired.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /accept invitation/i })).toBeNull();
  });

  it("falls back to a plain reason when the server gives none", () => {
    state.preview = invalidPreview("");
    render(<InvitationRedemption token="tok_1" isAuthenticated />);

    expect(screen.getByText("This invitation is no longer valid.")).toBeTruthy();
    expect(screen.getByText("Ask whoever sent it for a new link.")).toBeTruthy();
  });
});
