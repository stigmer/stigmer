/**
 * FederationIssuerListPanel's inline delete: the trash button asks "Delete
 * <name>?" in place of the row, and when the server refuses the delete the
 * refusal is shown inside that confirmation, the row stays, and the list is
 * not re-read.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  FederationIssuerSchema,
  type FederationIssuer,
} from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { StigmerContext } from "../../context";
import { FederationIssuerListPanel } from "../FederationIssuerListPanel";

const ISSUER: FederationIssuer = create(FederationIssuerSchema, {
  metadata: { id: "issuer-1", name: "Acme Okta", slug: "acme-okta", org: "acme" },
  spec: { displayName: "Acme Okta" },
});

afterEach(cleanup);

describe("FederationIssuerListPanel delete confirmation", () => {
  it("shows the server's refusal inside the confirmation and keeps the row", async () => {
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
    expect(
      screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Delete Acme Okta?"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByText("The issuer still signs people in to this organization."),
    ).toBeTruthy();
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ resourceId: "issuer-1" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(1);
  });
});
