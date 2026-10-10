/**
 * What the plugin page says a plugin holds and how to use it, against an
 * in-memory Connect backend. Pins: "Use this plugin" names what the status
 * lists hold and offers "Start a chat" (the header's primary action too,
 * handing the host the plugin's reference) and "Add to an agent"; skills
 * and agents are listed by the names a turn uses (`<plugin>:<name>`); each
 * MCP server shows how it is reached; a server that signs in reads its
 * state from My vault at its address (Sign in without a login, Signed in
 * and Sign out with one), and Sign out removes the login at that address;
 * a key-taking server names its keys; "Check tools" lists the server's
 * tools now, as the caller, with a Destructive marker where the server sets
 * one, and shows the server's refusal when the listing fails.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ListPluginToolsOutputSchema, type ListPluginToolsInput } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { PluginStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "../../context.js";
import { PluginDetailView } from "../PluginDetailView.js";

afterEach(cleanup);

const ORG = "acme";
const LINEAR_URL = "https://mcp.linear.app/mcp";

const STATUS = create(PluginStatusSchema, {
  skills: [{ name: "triage", description: "Sort incoming issues." }],
  agents: [{ name: "planner", description: "Plans a sprint." }],
  mcpServers: [
    { name: "linear", transport: { case: "http", value: { url: LINEAR_URL } }, signIn: {} },
    { name: "search", transport: { case: "stdio", value: { command: "npx", args: ["search-mcp"] } }, env: ["SEARCH_KEY"] },
  ],
  env: { SEARCH_KEY: { isSecret: true } },
});

interface World {
  /** The addresses My vault holds a login at. */
  readonly logins: string[];
  /** When set, the tools listing refuses with this sentence. */
  readonly listRefusal?: string;
  readonly listed: ListPluginToolsInput[];
  readonly removed: string[][];
}

function renderView(world: World, onStartChat = vi.fn()) {
  const myVault = () =>
    create(VaultSchema, {
      metadata: { org: ORG, slug: "mine" },
      spec: {
        owner: { case: "person", value: "ida_1" },
        connections: Object.fromEntries(world.logins.map((address) => [address, { source: VaultConnectionSource.sign_in }])),
      },
    });
  const transport = createRouterTransport(({ service }) => {
    service(PluginQueryController, {
      getByReference: () =>
        create(PluginSchema, {
          metadata: create(ApiResourceMetadataSchema, { id: "plg_1", org: ORG, slug: "linear", name: "linear" }),
          status: STATUS,
        }),
    });
    service(PluginCommandController, {
      listTools: (input) => {
        world.listed.push(input);
        if (world.listRefusal !== undefined) throw new ConnectError(world.listRefusal, Code.FailedPrecondition);
        return create(ListPluginToolsOutputSchema, {
          tools: [
            { name: "create_issue", description: "Create an issue.", destructive: false },
            { name: "delete_issue", description: "Delete an issue.", destructive: true },
          ],
        });
      },
    });
    service(VaultQueryController, {
      getMine: () => {
        if (world.logins.length === 0) throw new ConnectError("no My vault yet", Code.NotFound);
        return myVault();
      },
    });
    service(VaultCommandController, {
      removeConnections: (input) => {
        world.removed.push([...input.addresses]);
        world.logins.splice(0, world.logins.length, ...world.logins.filter((address) => !input.addresses.includes(address)));
        return myVault();
      },
    });
  });
  const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport });
  const wrapper = ({ children }: { children: ReactNode }) => <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
  render(<PluginDetailView org={ORG} slug="linear" onStartChat={onStartChat} />, { wrapper });
  return { onStartChat };
}

function world(overrides: Partial<World> = {}): World {
  return { logins: [], listed: [], removed: [], ...overrides };
}

describe("PluginDetailView: what a plugin holds", () => {
  it("says what it holds and offers a chat with it, from the section and the header", async () => {
    const { onStartChat } = renderView(world());

    expect(await screen.findByText(/Holds 1 skill, 2 MCP servers, 1 agent\./)).toBeTruthy();
    const starts = screen.getAllByRole("button", { name: "Start a chat" });
    expect(starts.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(starts[0]!);
    expect(onStartChat).toHaveBeenCalledWith({ org: ORG, slug: "linear" });
    expect(screen.getByRole("button", { name: "Add to an agent" })).toBeTruthy();
  });

  it("lists skills and agents by the names a turn uses", async () => {
    renderView(world());

    const skills = await screen.findByRole("list", { name: "Skills" });
    expect(within(skills).getByText("linear:triage")).toBeTruthy();
    expect(within(skills).getByText("Sort incoming issues.")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Agents" })).getByText("linear:planner")).toBeTruthy();
  });

  it("shows how each server is reached, and the keys a key-taking server reads", async () => {
    renderView(world());

    const servers = await screen.findByRole("list", { name: "MCP servers" });
    expect(within(servers).getByText(LINEAR_URL)).toBeTruthy();
    expect(within(servers).getByText("npx search-mcp")).toBeTruthy();
    expect(within(servers).getByText("SEARCH_KEY")).toBeTruthy();
  });
});

describe("PluginDetailView: a server's sign-in", () => {
  it("offers Sign in when My vault holds no login at the server's address", async () => {
    renderView(world());

    expect(await screen.findByRole("button", { name: "Sign in to linear" })).toBeTruthy();
    expect(screen.getByText("Not signed in")).toBeTruthy();
  });

  it("reads Signed in from a login at the address, and Sign out removes that login", async () => {
    const state = world({ logins: [LINEAR_URL] });
    renderView(state);

    expect(await screen.findByText("Signed in")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out of linear" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(state.removed).toEqual([[LINEAR_URL]]));
    expect(await screen.findByRole("button", { name: "Sign in to linear" })).toBeTruthy();
  });
});

describe("PluginDetailView: Check tools", () => {
  it("lists the server's tools now, marking the destructive ones", async () => {
    const state = world();
    renderView(state);

    const servers = await screen.findByRole("list", { name: "MCP servers" });
    fireEvent.click(within(servers).getAllByRole("button", { name: "Check tools" })[0]!);

    const tools = await screen.findByRole("list", { name: "Tools of linear" });
    expect(within(tools).getByText("create_issue")).toBeTruthy();
    expect(within(tools).getByText("Delete an issue.")).toBeTruthy();
    expect(within(tools).getAllByText("Destructive")).toHaveLength(1);
    expect(state.listed[0]).toMatchObject({ pluginId: "plg_1", server: "linear", org: ORG });
  });

  it("shows the server's refusal when the listing fails", async () => {
    renderView(world({ listRefusal: "sign in to linear first" }));

    const servers = await screen.findByRole("list", { name: "MCP servers" });
    fireEvent.click(within(servers).getAllByRole("button", { name: "Check tools" })[0]!);

    expect(await screen.findByText(/sign in to linear first/)).toBeTruthy();
  });
});
