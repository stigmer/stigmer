/**
 * The plugin page as the place an install ends, against an in-memory
 * Connect backend. Pins: each MCP-server member row carries a readiness
 * cell that says one of four things (Signed in; a Sign in button; the
 * declared variables and where they are asked; nothing for an open
 * server) from the server's persisted spec and its grant, never from the
 * member list; the cell sits beside the row's link, not inside it; a
 * plugin that installed servers and no agent gets "Use these tools" and
 * "Add to an agent" opens the dialog, while a plugin with an agent gets
 * neither and its variables sentence says the agent asks.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ListPluginMembersResponseSchema, PluginMemberSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { PluginState, PluginStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { GetOAuthGrantStatusOutputSchema, OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { HttpServerConfigSchema, McpServerAuthSchema, McpServerSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "../../context.js";
import { PluginDetailView } from "../PluginDetailView.js";

afterEach(cleanup);

const ORG = "acme";

type ServerShape = "oauth-no-grant" | "oauth-granted" | "api-key" | "open";

function server(slug: string, shape: ServerShape) {
  const spec = create(McpServerSpecSchema, {
    serverType: { case: "http", value: create(HttpServerConfigSchema, { url: `https://${slug}.example/mcp` }) },
  });
  if (shape === "oauth-no-grant" || shape === "oauth-granted") {
    const variable = `${slug.toUpperCase()}_ACCESS_TOKEN`;
    spec.auth = create(McpServerAuthSchema, { targetEnvVar: variable, oauthOnly: true });
    spec.env = { [variable]: create(EnvVarDeclarationSchema, { isSecret: true }) };
  }
  if (shape === "api-key") spec.env = { API_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true }) };
  return create(McpServerSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: `mcp_${slug}`, org: ORG, slug, name: slug }),
    spec,
  });
}

function transport(servers: Record<string, ServerShape>, members: readonly { kind: ApiResourceKind; slug: string }[]) {
  return createRouterTransport(({ service }) => {
    service(PluginQueryController, {
      getByReference: () =>
        create(PluginSchema, {
          metadata: create(ApiResourceMetadataSchema, { id: "plg_1", org: ORG, slug: "toolbox", name: "Toolbox" }),
          status: create(PluginStatusSchema, { state: PluginState.READY }),
        }),
      listMembers: () =>
        create(ListPluginMembersResponseSchema, {
          members: members.map((m) => create(PluginMemberSchema, { kind: m.kind, id: `${m.kind}_${m.slug}`, slug: m.slug, name: m.slug })),
        }),
    });
    service(McpServerQueryController, {
      getByReference: (ref) => {
        const shape = servers[ref.slug];
        if (shape === undefined) throw new Error(`no server '${ref.slug}'`);
        return server(ref.slug, shape);
      },
      getOAuthGrantStatus: (input) => {
        const slug = input.resourceId.replace(/^mcp_/, "");
        const granted = servers[slug] === "oauth-granted";
        return create(GetOAuthGrantStatusOutputSchema, {
          connected: granted,
          connectionHealth: granted ? OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY : OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
        });
      },
    });
  });
}

function renderView(servers: Record<string, ServerShape>, members: readonly { kind: ApiResourceKind; slug: string }[], onCreateAgent?: () => void) {
  const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport(servers, members) });
  const wrapper = ({ children }: { children: ReactNode }) => <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
  return render(<PluginDetailView org={ORG} slug="toolbox" onMcpServerClick={() => {}} onCreateAgent={onCreateAgent} />, { wrapper });
}

function memberRow(slug: string): HTMLElement {
  const link = screen.getByRole("button", { name: new RegExp(`MCP server\\s*${slug}`) });
  // The readiness cell is the link's sibling inside the row, never a child of the link.
  return link.parentElement as HTMLElement;
}

describe("PluginDetailView: where an install ends", () => {
  it("says, per MCP server, what stands before its first tool call, and offers the tools to an agent", async () => {
    const onCreateAgent = () => {};
    renderView(
      { linear: "oauth-no-grant", notion: "oauth-granted", warmth: "api-key", weather: "open" },
      [
        { kind: ApiResourceKind.mcp_server, slug: "linear" },
        { kind: ApiResourceKind.mcp_server, slug: "notion" },
        { kind: ApiResourceKind.mcp_server, slug: "warmth" },
        { kind: ApiResourceKind.mcp_server, slug: "weather" },
      ],
      onCreateAgent,
    );

    const signIn = await screen.findByRole("button", { name: "Sign in to linear" });
    expect(within(memberRow("linear")).getByText("Sign-in required")).toBeTruthy();
    expect(signIn.closest("button[aria-label]")).toBe(signIn);
    expect(within(screen.getByRole("button", { name: /MCP server\s*linear/ })).queryByRole("button")).toBeNull();

    await waitFor(() => expect(within(memberRow("notion")).getByText("Signed in")).toBeTruthy());
    await waitFor(() => expect(within(memberRow("warmth")).getByText(/Needs/)).toBeTruthy());
    expect(within(memberRow("warmth")).getByText("API_TOKEN")).toBeTruthy();
    expect(within(memberRow("warmth")).getByText(/set when you connect it/)).toBeTruthy();
    await waitFor(() => expect(within(memberRow("weather")).queryByRole("status")).toBeNull());
    expect(within(memberRow("weather")).queryByText(/Needs|Sign/)).toBeNull();

    // Tools and no agent: the page offers them to one.
    expect(screen.getByText(/This plugin installed tools and no agent/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to an agent" }));
    const dialog = await screen.findByRole("dialog", { name: "Add to an agent" });
    expect(within(dialog).getByRole("list", { name: "Servers to add" }).textContent).toContain("linear");
    expect(within(dialog).getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
    expect(within(dialog).getByRole("button", { name: "Create a new agent with these tools" })).toBeTruthy();
  });

  it("with an agent installed, the variables sentence says the agent asks, and there is no Use these tools", async () => {
    renderView({ warmth: "api-key" }, [
      { kind: ApiResourceKind.mcp_server, slug: "warmth" },
      { kind: ApiResourceKind.agent, slug: "thermos" },
    ]);
    await waitFor(() => expect(within(memberRow("warmth")).getByText(/the agent asks at its first session/)).toBeTruthy());
    expect(screen.queryByText("Use these tools")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to an agent" })).toBeNull();
  });
});
