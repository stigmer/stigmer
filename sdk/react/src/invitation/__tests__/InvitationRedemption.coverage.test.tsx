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
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

interface PreviewStub {
  isValid: boolean;
  invalidReason: string;
  orgName: string;
  orgLogoUrl: string;
  role: number;
}

const state = vi.hoisted(() => ({
  preview: null as PreviewStub | null,
  isLoading: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock("../useInvitationPreview.js", () => ({
  useInvitationPreview: () => ({
    preview: state.preview,
    isLoading: state.isLoading,
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
  state.isLoading = false;
  state.error = null;
  state.refetch.mockReset();
});

describe("InvitationRedemption", () => {
  it("says it is opening the invitation while the preview loads", () => {
    state.isLoading = true;
    render(<InvitationRedemption token="tok_1" isAuthenticated />);

    expect(screen.getByRole("status").textContent).toBe("Opening your invitation…");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a failed preview fetch and fetches again on Try again", () => {
    state.error = new Error("invitation service unreachable");
    render(<InvitationRedemption token="tok_1" isAuthenticated />);

    expect(screen.getByRole("alert").textContent).toContain("invitation service unreachable");
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it("says the invitation could not be found when no preview comes back", () => {
    render(<InvitationRedemption token="tok_missing" isAuthenticated />);

    expect(screen.getByRole("heading", { name: "This invitation isn't here" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /accept invitation/i })).toBeNull();
  });

  it("states the server's reason for an invalid invitation in place of the accept button", () => {
    state.preview = invalidPreview("This invitation has expired.");
    render(<InvitationRedemption token="tok_1" isAuthenticated />);

    expect(screen.getByRole("heading", { name: "This invitation has expired" })).toBeTruthy();
    expect(screen.getByText("Ask whoever sent it for a new link.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /accept invitation/i })).toBeNull();
  });

  it("falls back to a plain reason when the server gives none", () => {
    state.preview = invalidPreview("");
    render(<InvitationRedemption token="tok_1" isAuthenticated />);

    expect(screen.getByRole("heading", { name: "This invitation is no longer valid" })).toBeTruthy();
    expect(screen.getByText("Ask whoever sent it for a new link.")).toBeTruthy();
  });

  it.each([
    ["owner", IamRole.owner, "As an owner you can do everything, including deleting the organization and choosing its owners."],
    ["admin", IamRole.admin, "As an admin you can manage the organization's people, settings, billing, agents and tools."],
    ["member", IamRole.member, "As a member you can use the organization's agents and start your own conversations."],
    ["viewer", IamRole.viewer, "As a viewer you can see what's shared with the organization, but not start conversations."],
  ])("tells an invited %s what the role lets them do, in their words", (_name, role, line) => {
    state.preview = { isValid: true, invalidReason: "", orgName: "Acme Robotics", orgLogoUrl: "", role };
    render(<InvitationRedemption token="tok_1" isAuthenticated />);

    expect(screen.getByText(line)).toBeTruthy();
  });
});
