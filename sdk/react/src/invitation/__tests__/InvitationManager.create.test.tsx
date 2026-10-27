/**
 * Pins InvitationManager's create form: it offers the two usage limits, each
 * with the line that says who the link admits, and when the server refuses
 * the new link the form stays open and shows the refusal in an alert, with
 * the list left as it was. The data hooks run for real against a hand-built
 * client.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StigmerContext } from "../../context";
import { InvitationManager } from "../InvitationManager";

afterEach(cleanup);

function renderManager(createInvitation: () => Promise<never>) {
  const client = {
    invitation: {
      list: async () => ({ entries: [], nextPageToken: "" }),
      create: createInvitation,
    },
    grant: { checkMyPermission: async () => ({ isAuthorized: false }) },
  };
  render(
    <StigmerContext.Provider value={client as never}>
      <InvitationManager org="org_acme" />
    </StigmerContext.Provider>,
  );
}

describe("InvitationManager create form", () => {
  it("describes each usage limit by who the link admits", async () => {
    renderManager(async () => {
      throw new Error("unused");
    });

    fireEvent.click(await screen.findByRole("button", { name: "+ Create invite link" }));

    const unlimited = screen.getByRole("radio", { name: /Unlimited/ });
    const single = screen.getByRole("radio", { name: /Single use/ });
    expect(unlimited.closest("label")?.textContent).toContain("Anyone with the link can join");
    expect(single.closest("label")?.textContent).toContain("One person only");
    expect((unlimited as HTMLInputElement).checked).toBe(true);
  });

  it("shows the server's refusal in an alert and keeps the form open", async () => {
    const createInvitation = vi.fn(async (): Promise<never> => {
      throw new Error("the organization has reached its invitation limit");
    });
    renderManager(createInvitation);

    fireEvent.click(await screen.findByRole("button", { name: "+ Create invite link" }));
    fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/reached its invitation limit/);
    expect(createInvitation).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy());
    expect(screen.getByText(/No invite links yet/)).toBeTruthy();
  });
});
