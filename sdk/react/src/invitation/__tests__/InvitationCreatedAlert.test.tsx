/**
 * InvitationCreatedAlert, the one-time banner after an invite link is made:
 * it names the invitation and shows its URL, and its Dismiss control hands
 * the close back to the host.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InvitationCreatedAlert } from "../InvitationCreatedAlert";

afterEach(cleanup);

describe("InvitationCreatedAlert", () => {
  it("shows the invitation and its link, and Dismiss tells the host", () => {
    const onDismiss = vi.fn();
    render(
      <InvitationCreatedAlert
        inviteUrl="https://console.example.com/invite/tok_1"
        label="Engineering team invite"
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText("Invite link created: Engineering team invite")).toBeTruthy();
    expect(screen.getByText("https://console.example.com/invite/tok_1")).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
