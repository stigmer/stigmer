/**
 * The sign-ins a conversation's plugins need, one row per server that signs
 * in, each plugin read through the real `usePlugin` against a client fake;
 * the row's own cell is stubbed (its rule is pinned in
 * `PluginServerSignIn.test.tsx`). Pins: no plugins renders nothing; only a
 * plugin's HTTP servers marked to sign in get a row, named by the plugin and
 * the server unless the two are the same; a reference without an org is
 * read in the conversation's organization, and every cell reads the
 * conversation's My vault; a plugin that cannot be read and one that is not
 * installed each say so in their row; a cell's landed sign-in reaches the
 * host.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { type ResourceRef, StigmerError } from "@stigmer/client";
import { type Plugin, PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import type { McpServerEntry } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";

vi.mock("../PluginServerSignIn.js", () => ({
  PluginServerSignIn: ({
    org,
    server,
    onSignedIn,
  }: {
    readonly org: string;
    readonly server: McpServerEntry;
    readonly onSignedIn?: (address: string) => void;
  }) => (
    <button type="button" onClick={() => onSignedIn?.(`https://${server.name}.example/mcp`)}>
      Sign in to {server.name} in {org}
    </button>
  ),
}));

import { StigmerContext } from "../../context.js";
import { PluginServerSignIns } from "../PluginServerSignIns.js";

afterEach(cleanup);

const ORG = "acme";

function plugin(org: string, slug: string, name: string): Plugin {
  return create(PluginSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: `plg_${slug}`, org, slug, name }),
    status: {
      mcpServers: [
        { name: slug, transport: { case: "http", value: { url: `https://${slug}.example/mcp` } }, signIn: {} },
        { name: "tickets", transport: { case: "http", value: { url: `https://${slug}.example/tickets` } }, signIn: {} },
        { name: "open", transport: { case: "http", value: { url: `https://${slug}.example/open` } } },
        { name: "local", transport: { case: "stdio", value: { command: "npx", args: [] } }, env: ["KEY"] },
      ],
    },
  });
}

/** The installed plugins by `org/slug`; `broken` fails to read, anything else is not installed. */
const INSTALLED: Record<string, Plugin> = {
  "acme/linear": plugin(ORG, "linear", "linear"),
  "globex/notion": plugin("globex", "notion", ""),
};

function renderSignIns(plugins: readonly ResourceRef[]) {
  const getByReference = vi.fn(async (ref: ResourceRef) => {
    if (ref.slug === "broken") throw new StigmerError("unavailable", "the plugin store is down", Code.Unavailable);
    const found = INSTALLED[`${ref.org}/${ref.slug}`];
    if (!found) throw new StigmerError("not-found", "no plugin", Code.NotFound);
    return found;
  });
  const client = { plugin: { getByReference } };
  const wrapper = ({ children }: { children: ReactNode }) => <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>;
  const onSignedIn = vi.fn();
  const view = render(<PluginServerSignIns org={ORG} plugins={plugins} onSignedIn={onSignedIn} className="host-class" />, { wrapper });
  return { getByReference, onSignedIn, view };
}

describe("PluginServerSignIns", () => {
  it("renders nothing when the conversation lists no plugin", () => {
    const { view } = renderSignIns([]);
    expect(view.container.innerHTML).toBe("");
  });

  it("lists a row per server that signs in, named by the plugin and the server", async () => {
    const { getByReference } = renderSignIns([
      { org: "", slug: "linear" },
      { org: "globex", slug: "notion" },
    ]);

    const list = screen.getByRole("list", { name: "Plugin sign-ins" });
    expect(await within(list).findByText("linear")).toBeTruthy();
    expect(within(list).getByText("linear · tickets")).toBeTruthy();
    // A plugin without a display name is named by its slug.
    expect(await within(list).findByText("notion")).toBeTruthy();
    expect(within(list).getByText("notion · tickets")).toBeTruthy();
    expect(within(list).queryByText(/open|local/)).toBeNull();
    expect(within(list).getAllByRole("button")).toHaveLength(4);
    // Every cell reads the conversation's My vault.
    expect(within(list).getByRole("button", { name: "Sign in to notion in acme" })).toBeTruthy();
    // A reference without an org is read in the conversation's organization.
    expect(getByReference).toHaveBeenCalledWith({ org: ORG, slug: "linear" });
  });

  it("says when a plugin cannot be read, and when it is not installed", async () => {
    renderSignIns([
      { org: ORG, slug: "broken" },
      { org: ORG, slug: "gone" },
    ]);

    expect(await screen.findByText("The plugin broken could not be read.")).toBeTruthy();
    expect(await screen.findByText("The plugin gone is not installed; a conversation that lists it is refused.")).toBeTruthy();
  });

  it("hands the host a sign-in that lands in a row", async () => {
    const { onSignedIn } = renderSignIns([{ org: ORG, slug: "linear" }]);

    fireEvent.click(await screen.findByRole("button", { name: "Sign in to linear in acme" }));
    expect(onSignedIn).toHaveBeenCalledWith("https://linear.example/mcp");
  });
});
