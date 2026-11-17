/**
 * FederationIssuerListPanel's inline delete: the trash button asks "Delete
 * <name>?" in place of the row, and when the server refuses the delete the
 * refusal is shown inside that confirmation, the row stays, and the list is
 * not re-read.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  FederationIssuerSchema,
  type FederationIssuer,
} from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { StigmerContext } from "@stigmer/react-core";
import { FederationIssuerListPanel } from "../FederationIssuerListPanel";

const ISSUER: FederationIssuer = create(FederationIssuerSchema, {
  metadata: { id: "issuer-1", name: "Acme Okta", slug: "acme-okta", org: "acme" },
  spec: { displayName: "Acme Okta" },
});

afterEach(cleanup);

describe("FederationIssuerListPanel delete dialog", () => {
  it("shows the server's refusal inside the dialog and keeps the row", async () => {
    const list = vi.fn(async () => ({ entries: [ISSUER], nextPageToken: "" }));
    const remove = vi.fn(async (): Promise<FederationIssuer> => {
      throw new Error("The issuer still signs people in to this organization.");
    });
    const client = {
      federationIssuer: { list, delete: remove },
      grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: true })) },
    } as never;

    render(
      <StigmerContext.Provider value={client}>
        <FederationIssuerListPanel org="acme" />
      </StigmerContext.Provider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Delete Acme Okta" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Delete Acme Okta?" })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete issuer" }));

    expect(await within(dialog).findByText("Couldn't delete Acme Okta.")).toBeTruthy();
    expect(dialog.textContent).toMatch(/still signs people in/);
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ resourceId: "issuer-1" }));
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("deletes from the dialog and reads the list again", async () => {
    const list = vi.fn(async () => ({ entries: [ISSUER], nextPageToken: "" }));
    const remove = vi.fn(async (): Promise<FederationIssuer> => ISSUER);
    const client = {
      federationIssuer: { list, delete: remove },
      grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: true })) },
    } as never;
    render(
      <StigmerContext.Provider value={client}>
        <FederationIssuerListPanel org="acme" />
      </StigmerContext.Provider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Delete Acme Okta" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete issuer" }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(remove).toHaveBeenCalledWith({ resourceId: "issuer-1" });
  });
});
