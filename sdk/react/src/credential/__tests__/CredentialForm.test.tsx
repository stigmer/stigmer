/**
 * The form that saves a credential. Pinned: the choice of owner is offered
 * only once the server confirms the caller may save the organization's
 * credentials (an admin); a member's form has no choice and saves a
 * credential of their own, named by their id; an admin who picks the
 * organization saves one naming no person; values are secret unless
 * marked plain; an edit changes the name and targets without touching the
 * owner or any field.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CredentialInput, Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { CredentialForm } from "../CredentialForm";
import { ME, storedCredential } from "./credential-world";

afterEach(cleanup);

const ORG = "org_acme";

function clientFor(admin: boolean) {
  const create = vi.fn(async (input: CredentialInput) => storedCredential({ id: "new", org: input.org, owner: input.person ? "person" : "org" }));
  const update = vi.fn(async (input: CredentialInput) => storedCredential({ id: "c1", org: input.org, owner: "person" }));
  const checkMyPermission = vi.fn(async (input: { relation: string }) => ({
    isAuthorized: admin && input.relation === "can_create_org_credential",
  }));
  const client = {
    credential: { create, update },
    identityAccount: { whoAmI: vi.fn(async () => ({ metadata: { id: ME } })) },
    iamPolicy: { checkMyPermission },
  } as unknown as Stigmer;
  return { client, create, update, checkMyPermission };
}

function wrap(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

function fillNewCredential() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "OpenAI" } });
  fireEvent.change(screen.getByLabelText("Value 1 name"), { target: { value: "OPENAI_API_KEY" } });
  fireEvent.change(screen.getByLabelText("Value 1"), { target: { value: "sk-1" } });
}

describe("CredentialForm", () => {
  it("offers no owner choice to a member, and saves a credential of their own", async () => {
    const { client, create, checkMyPermission } = clientFor(false);
    render(<CredentialForm org={ORG} />, { wrapper: wrap(client) });

    await waitFor(() => expect(checkMyPermission).toHaveBeenCalled());
    expect(screen.queryByText("Whose is it?")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();

    fillNewCredential();
    fireEvent.click(screen.getByRole("button", { name: "Save credential" }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const input = create.mock.calls[0]![0];
    expect(input.person).toBe(ME);
    expect(input.fields).toEqual({ OPENAI_API_KEY: { value: "sk-1" } });
  });

  it("offers the organization as owner to an admin, and saves the organization's naming no person", async () => {
    const { client, create } = clientFor(true);
    render(<CredentialForm org={ORG} />, { wrapper: wrap(client) });

    const organization = await screen.findByRole("radio", { name: /The organization's/ });
    expect(screen.getByRole("radio", { name: /Yours/ })).toBeTruthy();
    fireEvent.click(organization);
    fillNewCredential();
    fireEvent.click(screen.getByLabelText("Plain"));
    fireEvent.click(screen.getByRole("button", { name: "Save credential" }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const input = create.mock.calls[0]![0];
    expect(input.person).toBeUndefined();
    expect(input.org).toBe(ORG);
    expect(input.fields).toEqual({ OPENAI_API_KEY: { value: "sk-1", plain: true } });
  });

  it("edits name and targets of a stored credential without touching its owner or fields", async () => {
    const { client, update } = clientFor(true);
    const credential = storedCredential({
      id: "c1",
      org: ORG,
      owner: "person",
      name: "Old",
      fields: ["KEY"],
      serves: [{ kind: "git_host", host: "github.com" }],
    });
    render(<CredentialForm org={ORG} credential={credential} />, { wrapper: wrap(client) });

    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("Belongs to you.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "GitHub" } });
    fireEvent.click(screen.getByRole("button", { name: "Stop using for github.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0]![0];
    expect(input.name).toBe("GitHub");
    expect(input.person).toBe(ME);
    expect(input.serves).toEqual([]);
    expect(input.fields).toEqual({ KEY: { value: "***REDACTED***" } });
  });
});
