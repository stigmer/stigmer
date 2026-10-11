/**
 * Pins the service-account list (`ServiceAccountListPanel` over
 * `useServiceAccountList`):
 *
 *   - every page the server reports is read and shown as one list, in the
 *     server's order, and reading stops at the reported total;
 *   - each row names the account's organization role from the
 *     organization's access list, and an account whose role was removed is
 *     still listed, as "No role";
 *   - opening a row hands the host that account;
 *   - a row says when the account was created;
 *   - the refetch handed to the host re-reads the accounts and their roles;
 *   - a refused list says why, and an organization with none says so.
 *
 * The generated client is a fake behind the one provider seam.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import {
  IdentityAccountsListSchema,
  type ListWithIdentityOrg,
} from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/io_pb";
import { ResourceAccessByPrincipalListSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { StigmerContext } from "../../context";
import { ServiceAccountListPanel } from "../ServiceAccountListPanel";

const asked = vi.hoisted(() => ({
  pages: [] as [string, number][],
  accessReads: 0,
  answer: "pages" as "pages" | "none" | "refused",
}));

const PAGES = [
  [
    {
      metadata: { id: "ida_sa_new", name: "nightly-evals" },
      status: { audit: { specAudit: { createdAt: { seconds: 1767225600n } } } },
    },
  ],
  [{ metadata: { id: "ida_sa_old", name: "ci-deploy" } }],
];

function wrapper({ children }: { children: ReactNode }) {
  const client = {
    identityAccount: {
      listServiceAccounts: async (input: ListWithIdentityOrg) => {
        const num = input.page?.num ?? 0;
        asked.pages.push([input.org, num]);
        if (asked.answer === "refused") throw new Error("unauthorized to list service accounts in this organization");
        if (asked.answer === "none") return create(IdentityAccountsListSchema, { totalPages: 0, entries: [] });
        return create(IdentityAccountsListSchema, {
          totalPages: PAGES.length,
          entries: PAGES[num - 1] ?? [],
        });
      },
    },
    iamPolicy: {
      listResourceAccessByPrincipal: async () => {
        asked.accessReads++;
        return create(ResourceAccessByPrincipalListSchema, {
          entries: [
            {
              principal: { kind: "identity_account", id: "ida_sa_old", name: "ci-deploy" },
              roles: [{ role: { code: "admin", name: "Admin" } }],
            },
          ],
        });
      },
    },
  } as unknown as Stigmer;
  return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
}

afterEach(() => {
  cleanup();
  asked.pages = [];
  asked.accessReads = 0;
  asked.answer = "pages";
});

describe("ServiceAccountListPanel", () => {
  it("reads every page, in order, and stops at the reported total", async () => {
    render(<ServiceAccountListPanel org="org_acme" />, { wrapper });
    const list = await screen.findByRole("list", { name: "Service accounts" });
    expect(within(list).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      expect.stringContaining("nightly-evals"),
      expect.stringContaining("ci-deploy"),
    ]);
    expect(asked.pages).toEqual([
      ["org_acme", 1],
      ["org_acme", 2],
    ]);
  });

  it("names each account's organization role, and lists one with none", async () => {
    render(<ServiceAccountListPanel org="org_acme" />, { wrapper });
    const deploy = await screen.findByRole("button", { name: "Open ci-deploy" });
    expect(await within(deploy).findByText("Admin")).toBeTruthy();
    expect(
      within(screen.getByRole("button", { name: "Open nightly-evals" })).getByText("No role"),
    ).toBeTruthy();
  });

  it("hands the host the account a row opens", async () => {
    const onOpen = vi.fn();
    render(<ServiceAccountListPanel org="org_acme" onOpen={onOpen} />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: "Open ci-deploy" }));
    expect(onOpen.mock.calls.map(([account]) => account.metadata?.id)).toEqual(["ida_sa_old"]);
  });

  it("says when each account was created", async () => {
    render(<ServiceAccountListPanel org="org_acme" />, { wrapper });
    const row = await screen.findByRole("button", { name: "Open nightly-evals" });
    expect(row.textContent).toMatch(/Created .*2026/);
  });

  it("hands the host a refetch that re-reads the accounts and their roles", async () => {
    let refetch: (() => void) | null = null;
    render(
      <ServiceAccountListPanel org="org_acme" onRefetchRef={(fn) => (refetch = fn)} />,
      { wrapper },
    );
    await screen.findByRole("button", { name: "Open ci-deploy" });
    await waitFor(() => expect(asked.accessReads).toBe(1));
    asked.pages = [];
    act(() => refetch?.());
    await waitFor(() => expect(asked.pages.length).toBe(2));
    await waitFor(() => expect(asked.accessReads).toBe(2));
  });

  it("says why the list was refused", async () => {
    asked.answer = "refused";
    render(<ServiceAccountListPanel org="org_acme" />, { wrapper });
    expect((await screen.findByRole("alert")).textContent).toMatch(/unauthorized to list/);
  });

  it("says so when the organization has none", async () => {
    asked.answer = "none";
    render(<ServiceAccountListPanel org="org_acme" />, { wrapper });
    expect(await screen.findByText("No service accounts yet.")).toBeTruthy();
  });
});
