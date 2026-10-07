/**
 * "Accounts and keys". Pinned: a person's own credentials are listed under
 * Yours, and a secret field of one can be revealed (only the owner reads
 * a value back); an organization's credential is never offered a reveal,
 * since it is write-only. A member sees the organization's credentials they
 * may use read-only (names of values, no editor, no grant control); an
 * admin manages them, with "Who can use it" on each. A member who may use
 * none of the organization's sees no organization section at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { CredentialsPanel } from "../CredentialsPanel";
import { storedCredential } from "./credential-world";

afterEach(cleanup);

const ORG = "org_acme";
const MINE = storedCredential({ id: "mine", org: ORG, owner: "person", name: "My OpenAI", fields: ["OPENAI_API_KEY"] });
const TEAM = storedCredential({ id: "team", org: ORG, owner: "org", name: "Deploy bot", fields: ["AWS_KEY"] });

/** A client whose unnamed calls never settle, so only the calls a test names answer. */
function clientFor(admin: boolean, credentials: readonly Credential[]) {
  const revealField = vi.fn(async () => ({ value: "sk-revealed" }));
  const named: Record<string, Record<string, unknown>> = {
    credential: {
      list: vi.fn(async () => ({ items: credentials, totalCount: credentials.length })),
      get: vi.fn(async (id: string) => credentials.find((c) => c.metadata?.id === id)),
      revealField,
    },
    iamPolicy: {
      checkMyPermission: vi.fn(async (input: { relation: string }) => ({
        isAuthorized: admin || input.relation !== "can_create_org_credential",
      })),
      // "Who can use it" reads the access list; it never answers here.
      listResourceAccessByPrincipal: () => new Promise(() => {}),
    },
  };
  const client = new Proxy(named, {
    get: (target, namespace: string) =>
      target[namespace] ??
      new Proxy({}, { get: () => () => new Promise(() => {}) }),
  }) as unknown as Stigmer;
  return { client, revealField };
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

describe("CredentialsPanel", () => {
  it("reveals a field of the person's own credential", async () => {
    const { client, revealField } = clientFor(false, [MINE]);
    render(<CredentialsPanel org={ORG} />, { wrapper: wrap(client) });

    fireEvent.click(await screen.findByRole("button", { name: /My OpenAI/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Reveal OPENAI_API_KEY" }));

    await waitFor(() => expect(revealField).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("sk-revealed")).toBeTruthy();
  });

  it("never offers a reveal on the organization's credential, even to an admin", async () => {
    const { client, revealField } = clientFor(true, [MINE, TEAM]);
    render(<CredentialsPanel org={ORG} />, { wrapper: wrap(client) });

    fireEvent.click(await screen.findByRole("button", { name: /Deploy bot/ }));
    expect(await screen.findByRole("button", { name: "Edit AWS_KEY", hidden: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reveal AWS_KEY", hidden: true })).toBeNull();
    expect(screen.getByText("Who can use it")).toBeTruthy();
    expect(revealField).not.toHaveBeenCalled();
  });

  it("shows a member the organization's keys they may use read-only, with no grant control", async () => {
    const { client } = clientFor(false, [TEAM]);
    render(<CredentialsPanel org={ORG} />, { wrapper: wrap(client) });

    const section = await screen.findByRole("list", { name: "The organization's" });
    fireEvent.click(within(section).getByRole("button", { name: /Deploy bot/ }));
    expect(await screen.findByText(/An admin manages this key/)).toBeTruthy();
    expect(within(section).getByRole("list", { name: "Values of Deploy bot" }).textContent).toContain("AWS_KEY");
    expect(screen.queryByText("Who can use it")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add an organization key/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit name and use" })).toBeNull();
  });

  it("shows a member who may use none of the organization's keys no organization section", async () => {
    const { client } = clientFor(false, [MINE]);
    render(<CredentialsPanel org={ORG} />, { wrapper: wrap(client) });

    await screen.findByRole("button", { name: /My OpenAI/ });
    expect(screen.queryByRole("heading", { name: "The organization's" })).toBeNull();
  });

  it("offers an admin the organization's section and its add action", async () => {
    const { client } = clientFor(true, [MINE]);
    render(<CredentialsPanel org={ORG} />, { wrapper: wrap(client) });

    expect(await screen.findByRole("button", { name: /Add an organization key/ })).toBeTruthy();
  });
});
