// The provider keys section over a mock client: an admin on any plan saves a
// key (never shown back), optionally on an own endpoint shown by its host,
// and removes one after confirming, or cancels and keeps it; a refused save
// shows the server's copy; a viewer sees the list with no actions; a
// managed organization's inherited key is read-only; local mode says the
// setting is Stigmer Cloud's. Nothing reads the plan.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ProviderKeySchema, type ProviderKey } from "@stigmer/protos/ai/stigmer/billing/providerkey/v1/api_pb";

vi.mock("../../organization/OrgProvider.js", () => ({
  useOrg: () => ({ activeOrg: { metadata: { id: "acme", slug: "acme", name: "Acme" } } }),
}));

import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { ProviderKeysSection } from "../ProviderKeysSection";
import { refusal } from "./fixtures";

afterEach(cleanup);

const SAVED = new Date("2027-03-01T00:00:00Z");

function key(
  provider: string,
  fields: { readonly keyHint?: string; readonly baseUrl?: string; readonly inheritedFromOrg?: string } = {},
): ProviderKey {
  return create(ProviderKeySchema, {
    org: "acme",
    provider,
    keyHint: provider === "anthropic" ? "a111" : "o222",
    createdBy: "ida_admin",
    createdAt: timestampFromDate(SAVED),
    updatedAt: timestampFromDate(SAVED),
    inUse: true,
    ...fields,
  });
}

function mockClient(options: { admin?: boolean; keys?: ProviderKey[]; setError?: Error } = {}) {
  const keys = [...(options.keys ?? [])];
  return {
    providerkey: {
      list: vi.fn().mockImplementation(() => Promise.resolve({ keys: [...keys] })),
      set: options.setError
        ? vi.fn().mockRejectedValue(options.setError)
        : vi.fn().mockImplementation((input: { provider: string; apiKey: string; baseUrl: string }) => {
            const saved = key(input.provider, { keyHint: input.apiKey.slice(-4), baseUrl: input.baseUrl });
            const at = keys.findIndex((k) => k.provider === input.provider);
            if (at >= 0) keys.splice(at, 1);
            keys.push(saved);
            return Promise.resolve(saved);
          }),
      delete: vi.fn().mockImplementation((input: { provider: string }) => {
        const at = keys.findIndex((k) => k.provider === input.provider);
        return Promise.resolve(keys.splice(at, 1)[0]);
      }),
    },
    subscription: { getEntitlements: vi.fn() },
    plan: { list: vi.fn() },
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
  it("lets an admin on any plan save a key, shown back only by its last four characters, reading no plan", async () => {
    const client = mockClient();
    renderSection(client);
    const anthropic = await row("Anthropic");
    expect(within(anthropic).getByText("Not set: runs that need Anthropic are refused until a key is added.")).toBeTruthy();
    await userEvent.click(within(anthropic).getByRole("button", { name: "Add key" }));
    await userEvent.type(within(await row("Anthropic")).getByLabelText("Anthropic API key"), "sk-ant-secret-9876");
    await userEvent.click(within(await row("Anthropic")).getByRole("button", { name: "Save key" }));
    await waitFor(() =>
      expect(client.providerkey.set).toHaveBeenCalledWith(
        expect.objectContaining({ org: "acme", provider: "anthropic", apiKey: "sk-ant-secret-9876", baseUrl: "" }),
      ),
    );
    expect(await within(await row("Anthropic")).findByText(/Key ending in 9876/)).toBeTruthy();
    expect(screen.queryByDisplayValue("sk-ant-secret-9876")).toBeNull();
    expect(document.body.textContent).not.toContain("secret-9876");
    expect(client.subscription.getEntitlements).not.toHaveBeenCalled();
    expect(client.plan.list).not.toHaveBeenCalled();
  });

  it("saves a key on the organization's own endpoint, shown by its host, and offers that endpoint on a replace", async () => {
    const client = mockClient();
    renderSection(client);
    await userEvent.click(within(await row("OpenAI")).getByRole("button", { name: "Add key" }));
    await userEvent.type(within(await row("OpenAI")).getByLabelText("OpenAI API key"), "sk-proj-5555");
    await userEvent.type(
      within(await row("OpenAI")).getByLabelText("Base URL (optional)"),
      "https://llm.acme.example/openai/v1",
    );
    await userEvent.click(within(await row("OpenAI")).getByRole("button", { name: "Save key" }));
    await waitFor(() =>
      expect(client.providerkey.set).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "openai", apiKey: "sk-proj-5555", baseUrl: "https://llm.acme.example/openai/v1" }),
      ),
    );
    expect(await within(await row("OpenAI")).findByText(/Key ending in 5555 · on llm\.acme\.example/)).toBeTruthy();
    await userEvent.click(within(await row("OpenAI")).getByRole("button", { name: "Replace" }));
    expect(
      (within(await row("OpenAI")).getByLabelText("Base URL (optional)") as HTMLInputElement).value,
    ).toBe("https://llm.acme.example/openai/v1");
  });

  it("shows a refused save's copy", async () => {
    const copy = "base_url: the endpoint resolves to a private address";
    renderSection(mockClient({ setError: refusal(copy, "", {}) }));
    await userEvent.click(within(await row("OpenAI")).getByRole("button", { name: "Add key" }));
    await userEvent.type(within(await row("OpenAI")).getByLabelText("OpenAI API key"), "sk-proj-1234");
    await userEvent.click(within(await row("OpenAI")).getByRole("button", { name: "Save key" }));
    expect(await screen.findByText(copy)).toBeTruthy();
  });

  it("lets an admin remove the organization's own key, once confirmed", async () => {
    const client = mockClient({ keys: [key("openai")] });
    renderSection(client);
    const openai = await row("OpenAI");
    expect(within(openai).getByText(/Key ending in o222/)).toBeTruthy();
    await userEvent.click(within(openai).getByRole("button", { name: "Remove" }));
    expect(
      within(await row("OpenAI")).getByText(
        "Remove your OpenAI key? Runs that need OpenAI are refused until a key serves this organization again.",
      ),
    ).toBeTruthy();
    expect(client.providerkey.delete).not.toHaveBeenCalled();
    await userEvent.click(within(await row("OpenAI")).getByRole("button", { name: "Remove key" }));
    await waitFor(() => expect(client.providerkey.delete).toHaveBeenCalledWith(expect.objectContaining({ org: "acme", provider: "openai" })));
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

  it("shows an own endpoint by its host, and a stored value that is no URL as it is", async () => {
    renderSection(
      mockClient({
        keys: [key("openai", { baseUrl: "https://llm.acme.example/openai/v1" }), key("anthropic", { baseUrl: "gateway" })],
      }),
    );
    expect(within(await row("OpenAI")).getByText(/on llm\.acme\.example ·/)).toBeTruthy();
    expect(within(await row("Anthropic")).getByText(/on gateway ·/)).toBeTruthy();
  });

  it("shows an inherited key read-only, named by the organization that provides it", async () => {
    renderSection(mockClient({ keys: [key("anthropic", { inheritedFromOrg: "integrator" })] }));
    const anthropic = await row("Anthropic");
    expect(within(anthropic).getByText(/provided by integrator/)).toBeTruthy();
    await waitFor(() => expect(within(anthropic).queryByRole("button")).toBeNull());
  });

  it("says the feature is Stigmer Cloud's in local mode, and reads nothing", () => {
    const client = mockClient();
    renderSection(client, "local");
    expect(screen.getByText(/Stigmer Cloud setting/)).toBeTruthy();
    expect(client.providerkey.list).not.toHaveBeenCalled();
  });
});
