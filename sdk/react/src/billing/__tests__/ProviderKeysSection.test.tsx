// The provider keys section over a mock client: an admin on Business saves a
// key (never shown back) and removes one after confirming, or cancels and
// keeps it; a viewer sees the list with no
// actions; an organization whose plan lacks the feature sees the upgrade
// notice, and its kept keys marked not in use with only Remove; a refused
// save shows the upgrade notice from the refusal's reason; a managed
// organization's inherited key is read-only; local mode says the feature is
// Stigmer Cloud's.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ProviderKeySchema, type ProviderKey } from "@stigmer/protos/ai/stigmer/billing/providerkey/v1/api_pb";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";

vi.mock("../../organization/OrgProvider.js", () => ({
  useOrg: () => ({ activeOrg: { metadata: { id: "acme", slug: "acme", name: "Acme" } } }),
}));

import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { ProviderKeysSection } from "../ProviderKeysSection";
import { BUSINESS, TEAM, refusal } from "./fixtures";

afterEach(cleanup);

const SAVED = new Date("2027-03-01T00:00:00Z");

function key(
  provider: string,
  fields: { readonly keyHint?: string; readonly inUse?: boolean; readonly inheritedFromOrgId?: string } = {},
): ProviderKey {
  return create(ProviderKeySchema, {
    orgId: "acme",
    provider,
    keyHint: provider === "anthropic" ? "a111" : "o222",
    createdBy: "ida_admin",
    createdAt: timestampFromDate(SAVED),
    updatedAt: timestampFromDate(SAVED),
    inUse: true,
    ...fields,
  });
}

function mockClient(options: { admin?: boolean; allowed?: boolean; keys?: ProviderKey[]; setError?: Error } = {}) {
  const keys = [...(options.keys ?? [])];
  const features = options.allowed === false ? [Feature.channels, Feature.sharing] : [Feature.byo_provider_keys];
  return {
    providerkey: {
      list: vi.fn().mockImplementation(() => Promise.resolve({ keys: [...keys] })),
      set: options.setError
        ? vi.fn().mockRejectedValue(options.setError)
        : vi.fn().mockImplementation((input: { provider: string; apiKey: string }) => {
            const saved = key(input.provider, { keyHint: input.apiKey.slice(-4) });
            keys.push(saved);
            return Promise.resolve(saved);
          }),
      delete: vi.fn().mockImplementation((input: { provider: string }) => {
        const at = keys.findIndex((k) => k.provider === input.provider);
        return Promise.resolve(keys.splice(at, 1)[0]);
      }),
    },
    subscription: { getEntitlements: vi.fn().mockResolvedValue({ entitlements: { features }, planId: "" }) },
    plan: { list: vi.fn().mockResolvedValue({ entries: [TEAM, BUSINESS] }) },
    iamPolicy: { checkMyPermission: vi.fn().mockResolvedValue({ isAuthorized: options.admin ?? true }) },
  };
}

function renderSection(client: unknown, mode: "local" | "cloud" = "cloud") {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <DeploymentModeContext.Provider value={mode}>
          <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
        </DeploymentModeContext.Provider>
      </FetchCacheContext.Provider>
    );
  }
  return render(<ProviderKeysSection />, { wrapper: Wrapper });
}

async function row(name: string): Promise<HTMLElement> {
  const list = await screen.findByRole("list", { name: "Provider keys" });
  const item = within(list)
    .getAllByRole("listitem")
    .find((li) => li.querySelector("p")?.textContent === name);
  if (item === undefined) throw new Error(`no row for ${name}`);
  return item;
}

describe("ProviderKeysSection", () => {
  it("lets an admin on Business save a key, shown back only by its last four characters", async () => {
    const client = mockClient();
    renderSection(client);
    const anthropic = await row("Anthropic");
    expect(within(anthropic).getByText(/Not set/)).toBeTruthy();
    await userEvent.click(within(anthropic).getByRole("button", { name: "Add key" }));
    await userEvent.type(within(await row("Anthropic")).getByLabelText("Anthropic API key"), "sk-ant-secret-9876");
    await userEvent.click(within(await row("Anthropic")).getByRole("button", { name: "Save key" }));
    await waitFor(() =>
      expect(client.providerkey.set).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: "acme", provider: "anthropic", apiKey: "sk-ant-secret-9876" }),
      ),
    );
    expect(await within(await row("Anthropic")).findByText(/Key ending in 9876/)).toBeTruthy();
    expect(screen.queryByDisplayValue("sk-ant-secret-9876")).toBeNull();
    expect(document.body.textContent).not.toContain("secret-9876");
  });

  it("lets an admin remove the organization's own key, once confirmed", async () => {
    const client = mockClient({ keys: [key("openai")] });
    renderSection(client);
    const openai = await row("OpenAI");
    expect(within(openai).getByText(/Key ending in o222/)).toBeTruthy();
    await userEvent.click(within(openai).getByRole("button", { name: "Remove" }));
    expect(
      within(await row("OpenAI")).getByText("Remove your OpenAI key? Your agents' OpenAI calls go back to Stigmer's keys, billed as usage."),
    ).toBeTruthy();
    expect(client.providerkey.delete).not.toHaveBeenCalled();
    await userEvent.click(within(await row("OpenAI")).getByRole("button", { name: "Remove key" }));
    await waitFor(() => expect(client.providerkey.delete).toHaveBeenCalledWith(expect.objectContaining({ orgId: "acme", provider: "openai" })));
    expect(await within(await row("OpenAI")).findByText(/Not set/)).toBeTruthy();
  });

  it("keeps the key when the admin cancels the removal", async () => {
    const client = mockClient({ keys: [key("openai")] });
    renderSection(client);
    await userEvent.click(within(await row("OpenAI")).getByRole("button", { name: "Remove" }));
    await userEvent.click(within(await row("OpenAI")).getByRole("button", { name: "Cancel" }));
    expect(within(await row("OpenAI")).getByText(/Key ending in o222/)).toBeTruthy();
    expect(within(await row("OpenAI")).getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(client.providerkey.delete).not.toHaveBeenCalled();
  });

  it("shows a viewer the keys with no actions", async () => {
    renderSection(mockClient({ admin: false, keys: [key("anthropic")] }));
    const anthropic = await row("Anthropic");
    await waitFor(() => expect(within(anthropic).queryByRole("button")).toBeNull());
    expect(within(await row("OpenAI")).queryByRole("button")).toBeNull();
  });

  it("names the plan that unlocks the feature, and keeps a lapsed key removable but not replaceable", async () => {
    renderSection(mockClient({ allowed: false, keys: [key("anthropic", { inUse: false })] }));
    expect(await screen.findByText("Bring your own provider keys need the Business plan or above.")).toBeTruthy();
    const anthropic = await row("Anthropic");
    expect(within(anthropic).getByText(/not in use on this plan/)).toBeTruthy();
    await waitFor(() => expect(within(anthropic).getByRole("button", { name: "Remove" })).toBeTruthy());
    expect(within(anthropic).queryByRole("button", { name: "Replace" })).toBeNull();
    expect(within(await row("OpenAI")).queryByRole("button", { name: "Add key" })).toBeNull();
    await userEvent.click(within(anthropic).getByRole("button", { name: "Remove" }));
    expect(within(await row("Anthropic")).getByText("Remove your Anthropic key? It is not in use on this plan.")).toBeTruthy();
  });

  it("shows the upgrade notice from a refused save's reason", async () => {
    const copy = "Your own provider keys need the Business plan. Upgrade organization 'acme' to save one.";
    renderSection(
      mockClient({ setError: refusal(copy, "PLAN_UPGRADE_REQUIRED", { feature: "byo_provider_keys", org_id: "acme" }) }),
    );
    await userEvent.click(within(await row("OpenAI")).getByRole("button", { name: "Add key" }));
    await userEvent.type(within(await row("OpenAI")).getByLabelText("OpenAI API key"), "sk-proj-1234");
    await userEvent.click(within(await row("OpenAI")).getByRole("button", { name: "Save key" }));
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View plans" })).toBeTruthy();
  });

  it("shows an inherited key read-only, named by the organization that provides it", async () => {
    renderSection(mockClient({ keys: [key("anthropic", { inheritedFromOrgId: "integrator" })] }));
    const anthropic = await row("Anthropic");
    expect(within(anthropic).getByText(/provided by integrator/)).toBeTruthy();
    await waitFor(() => expect(within(anthropic).queryByRole("button")).toBeNull());
  });

  it("says the feature is Stigmer Cloud's in local mode, and reads nothing", () => {
    const client = mockClient();
    renderSection(client, "local");
    expect(screen.getByText(/Stigmer Cloud plan feature/)).toBeTruthy();
    expect(client.providerkey.list).not.toHaveBeenCalled();
  });
});
