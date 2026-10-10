/**
 * Pins what an admin does to one service account (`ServiceAccountDetailPanel`)
 * and that each act is the ordinary RPC:
 *
 *   - a rename is the identity account's update, carrying the account's own
 *     id and spec with the new name;
 *   - a role change grants the new organization role before it revokes the
 *     old one, never offers Owner, and a refused grant revokes nothing;
 *   - the keys listed are the account's own (`findByAccount`), a new key is
 *     created for the account and shown once, and a revoke is the key's
 *     delete;
 *   - a delete asks first, says the keys stop working at once, and is the
 *     account's delete.
 *
 * The generated client is a fake behind the one provider seam; the
 * organization's access list is that fake's answer too.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import {
  ApiKeysSchema,
  type CreateServiceAccountKeyInput,
} from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";
import {
  IdentityAccountSchema,
  type IdentityAccount,
} from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { ResourceAccessByPrincipalListSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { StigmerContext } from "../../context";
import { ServiceAccountDetailPanel } from "../ServiceAccountDetailPanel";

const calls = vi.hoisted(() => ({
  log: [] as string[],
  updates: [] as { id?: string; name: string; idpId: string }[],
  keys: [] as CreateServiceAccountKeyInput[],
  refuseGrant: false,
}));

const ACCOUNT: IdentityAccount = create(IdentityAccountSchema, {
  metadata: { id: "ida_sa_ci", name: "ci-deploy", org: "org_acme", slug: "ci-deploy" },
  spec: {
    idpId: "stgm_sa|org_acme|r4nd0m",
    provisioningMode: IdentityAccountProvisioningMode.service_account,
  },
});

function wrapper({ children }: { children: ReactNode }) {
  const client = {
    identityAccount: {
      update: async (input: { id?: string; name: string; idpId: string }) => {
        calls.updates.push(input);
        return create(IdentityAccountSchema, { metadata: { id: input.id, name: input.name } });
      },
      delete: async (id: string) => {
        calls.log.push(`delete account ${id}`);
        return ACCOUNT;
      },
    },
    iamPolicy: {
      listResourceAccessByPrincipal: async () =>
        create(ResourceAccessByPrincipalListSchema, {
          entries: [
            {
              principal: { kind: "identity_account", id: "ida_sa_ci", name: "ci-deploy" },
              roles: [{ role: { code: "member", name: "Member" } }],
            },
          ],
        }),
      create: async (spec: IamPolicySpec) => {
        calls.log.push(`grant ${spec.relation} to ${spec.principal?.id} on ${spec.resource?.id}`);
        if (calls.refuseGrant) throw new Error("refused");
        return {};
      },
      delete: async (spec: IamPolicySpec) => {
        calls.log.push(`revoke ${spec.relation} from ${spec.principal?.id}`);
        return {};
      },
    },
    apiKey: {
      findByAccount: async (id: string) => {
        calls.log.push(`list keys of ${id}`);
        return create(ApiKeysSchema, {
          entries: [{ metadata: { id: "key_old", name: "github-actions" }, spec: { fingerprint: "zz9" } }],
        });
      },
      createForServiceAccount: async (input: CreateServiceAccountKeyInput) => {
        calls.keys.push(input);
        return create(ApiKeySchema, {
          metadata: { id: "key_new", name: input.name },
          spec: { keyHash: "stk_new_raw" },
        });
      },
      delete: async (id: string) => {
        calls.log.push(`revoke key ${id}`);
        return create(ApiKeySchema, {});
      },
    },
  } as unknown as Stigmer;
  return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
}

afterEach(() => {
  cleanup();
  calls.log = [];
  calls.updates = [];
  calls.keys = [];
  calls.refuseGrant = false;
});

function renderPanel(props: Partial<Parameters<typeof ServiceAccountDetailPanel>[0]> = {}) {
  return render(
    <ServiceAccountDetailPanel serviceAccount={ACCOUNT} org="org_acme" {...props} />,
    { wrapper },
  );
}

describe("ServiceAccountDetailPanel", () => {
  it("renames through the account's own update, keeping its id and spec", async () => {
    const onUpdated = vi.fn();
    renderPanel({ onUpdated });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "ci-release" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(calls.updates).toEqual([
      expect.objectContaining({ id: "ida_sa_ci", name: "ci-release", idpId: "stgm_sa|org_acme|r4nd0m" }),
    ]);
  });

  it("changes the role by granting the new one before revoking the old, and never offers Owner", async () => {
    renderPanel();
    await screen.findByText(/acts with the Member role/);
    expect(screen.queryByRole("radio", { name: /^Owner/ })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /^Viewer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save role" }));
    await waitFor(() =>
      expect(calls.log.filter((l) => l.startsWith("grant") || l.startsWith("revoke m"))).toEqual([
        "grant viewer to ida_sa_ci on org_acme",
        "revoke member from ida_sa_ci",
      ]),
    );
  });

  it("revokes nothing when the new role is refused", async () => {
    calls.refuseGrant = true;
    renderPanel();
    await screen.findByText(/acts with the Member role/);
    fireEvent.click(screen.getByRole("radio", { name: /^Admin/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save role" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/refused/));
    expect(calls.log.some((l) => l.startsWith("revoke member"))).toBe(false);
  });

  it("lists the account's own keys, creates one for the account and shows it once, and revokes by the key's delete", async () => {
    renderPanel();
    const keys = await screen.findByRole("list", { name: "API keys" });
    expect(within(keys).getByText("github-actions")).toBeTruthy();
    expect(calls.log).toContain("list keys of ida_sa_ci");

    fireEvent.click(screen.getByRole("button", { name: "+ New key" }));
    fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "nightly" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    expect(await screen.findByText("stk_new_raw")).toBeTruthy();
    expect(calls.keys.map((k) => [k.serviceAccountId, k.name])).toEqual([["ida_sa_ci", "nightly"]]);

    fireEvent.click(screen.getByRole("button", { name: "Delete github-actions" }));
    fireEvent.click(within(screen.getByRole("list", { name: "API keys" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.log).toContain("revoke key key_old"));
  });

  it("asks before deleting, says its keys stop working at once, and deletes the account", async () => {
    const onDeleted = vi.fn();
    renderPanel({ onDeleted });
    fireEvent.click(screen.getByRole("button", { name: "Delete service account" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete ci-deploy" });
    expect(confirm.textContent).toMatch(/Its API keys stop working at once/);
    expect(calls.log.some((l) => l.startsWith("delete account"))).toBe(false);

    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(calls.log).toContain("delete account ida_sa_ci");
  });
});
