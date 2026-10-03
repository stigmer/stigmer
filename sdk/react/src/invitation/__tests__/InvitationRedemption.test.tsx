/**
 * InvitationRedemption names the organization from the preview's org_name,
 * before and after the invitation is accepted, and falls back to a plain
 * phrase when the preview carries none. The preview and redeem hooks are
 * stubbed.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InvitationSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";

const state = vi.hoisted(() => ({ orgName: "Acme Robotics" }));

vi.mock("../useInvitationPreview.js", () => ({
  useInvitationPreview: () => ({
    preview: { isValid: true, orgName: state.orgName, orgLogoUrl: "", role: 0 },
    isLoading: false,
    error: null,
    refetch: () => {},
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
