/**
 * The agent wizard's Capabilities step, its plugins and its MCP servers.
 * Pins: the Plugins section starts open when the wizard already holds
 * plugins and closed when it holds none; a plugin picked there is written
 * to the wizard's `plugins`, after the ones it holds. The MCP servers
 * section shows only to someone the server says may add one
 * (`can_create_plugin` on the organization); a server added there is
 * checked first and written to the wizard's `mcpServers`, after the ones
 * it holds, and one removed leaves the others.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AgentMcpServerInput } from "@stigmer/client";
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { CapabilitiesStep } from "../CapabilitiesStep";
import { createInitialWizardData } from "../types";
import { ACME_ID, orgWrapper } from "../../../organization/__tests__/org-fixture";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(cleanup);

const NOTION = { id: "plg_2", org: ACME_ID, slug: "notion", name: "Notion", description: "" } as SearchResult;
const LINEAR_REF = { org: ACME_ID, slug: "linear", kind: ApiResourceKind.plugin };

function renderStep(
  plugins: (typeof LINEAR_REF)[],
  options: { readonly admin?: boolean; readonly mcpServers?: AgentMcpServerInput[] } = {},
) {
  const updateData = vi.fn();
  const checkMyPermission = vi.fn(async (input: { relation: string }) => ({
    isAuthorized: input.relation === "can_create_plugin" && options.admin === true,
  }));
  render(
    <CapabilitiesStep
      org={ACME_ID}
      data={{ ...createInitialWizardData(), plugins, mcpServers: options.mcpServers ?? [] }}
      updateData={updateData}
    />,
    {
    wrapper: orgWrapper(
      {
        grant: { checkMyPermission },
        plugin: {
          list: vi.fn(async () => ({
            entries: [{ metadata: { id: NOTION.id, org: NOTION.org, slug: NOTION.slug, name: NOTION.name, tags: [] } }],
            nextPageToken: "",
          })),
        },
      },
      undefined,
      true,
    ),
    },
  );
  return { updateData, checkMyPermission };
}

const ZENDESK = { name: "zendesk", url: "https://acme-co.zendesk.com/mcp", headers: { "X-Api-Key": "${ZENDESK_KEY}" } };

describe("CapabilitiesStep (agent) plugins", () => {
  it("opens Plugins on the plugins the wizard holds and appends a picked one", async () => {
    const { updateData } = renderStep([LINEAR_REF]);

    expect((await screen.findByRole("button", { name: /Plugins/ })).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Remove linear" })).toBeTruthy();

    fireEvent.click(await screen.findByRole("option", { name: /Notion/ }));
    expect(updateData).toHaveBeenCalledWith({
      plugins: [LINEAR_REF, { org: ACME_ID, slug: "notion", kind: ApiResourceKind.plugin }],
    });
  });

  it("keeps Plugins closed when the wizard holds none", async () => {
    renderStep([]);
    expect((await screen.findByRole("button", { name: /Plugins/ })).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("CapabilitiesStep (agent) MCP servers", () => {
  it("offers no MCP servers to someone the server would refuse", async () => {
    const { checkMyPermission } = renderStep([]);
    await waitFor(() => expect(checkMyPermission).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /MCP servers/ })).toBeNull();
  });

  it("lets an admin add a server, checked first, after the ones the wizard holds", async () => {
    const { updateData } = renderStep([], { admin: true });

    fireEvent.click(await screen.findByRole("button", { name: /MCP servers/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    const form = screen.getByRole("group", { name: "New MCP server" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Zendesk" } });
    fireEvent.change(within(form).getByLabelText("URL"), { target: { value: ZENDESK.url } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    expect(within(form).getByRole("alert").textContent).toMatch(/lowercase letters/);
    expect(updateData).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "zendesk" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add header" }));
    fireEvent.change(within(form).getByLabelText("Header name"), { target: { value: "X-Api-Key" } });
    fireEvent.change(within(form).getByLabelText("Header value"), { target: { value: "${ZENDESK_KEY}" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    expect(updateData).toHaveBeenCalledWith({ mcpServers: [ZENDESK] });
  });

  it("opens on the servers the wizard holds, and removes one leaving the others", async () => {
    const linear = { name: "linear", url: "https://mcp.linear.app/mcp", headers: {} };
    const { updateData } = renderStep([], { admin: true, mcpServers: [ZENDESK, linear] });

    expect((await screen.findByRole("button", { name: /MCP servers/ })).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Remove zendesk" }));
    expect(updateData).toHaveBeenCalledWith({ mcpServers: [linear] });
  });
});
