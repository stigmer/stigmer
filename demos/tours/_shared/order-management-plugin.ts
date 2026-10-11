/**
 * The Order Management API, as the Getting Started tours tell its story:
 * one MCP server at an address, added with "Add MCP server", so it lives in
 * a plugin of its own named after it. `mcp-server-creation-tour` adds it,
 * `mcp-server-connect-tour` signs in to it and checks its tools, and the
 * `connect-tools-tour` overview starts a chat with it: up to three embeds
 * on the same docs page, so the plugin, its server, its tools and the two
 * states of the person's My vault live here once and cannot drift apart.
 *
 * A plugin is installed whole and does not change between beats; what does
 * change is whether My vault holds a login at the server's address, which
 * is what turns the plugin page's "Sign in" into "Signed in". Both vault
 * states are built here; which one a beat sees is the tour's business (its
 * `.scenar/providers.tsx` answers `getMine`).
 *
 * Narrate-safe by construction: `steps.ts` files import the identity
 * constants from here, and `scenar narrate` loads `steps.ts` in plain Node
 * (tsx). Everything this module touches is in that loader's safe tier:
 * protos and `@stigmer/react/test` samples. Keep it that way: no component
 * imports, no CSS, no live clock (`verify-scenar-tours` enforces the last
 * one).
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { samples, sampleDate } from "@stigmer/react/test";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginToolSchema, type PluginTool } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { McpServerSignInSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import {
  VaultConnectionSchema,
  VaultConnectionSource,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { DEMO_ORG } from "./fixtures";

/**
 * The plugin's identity, referenced by narration, code beats and chrome.
 * "Add MCP server" names the plugin and its one server after the name the
 * person typed, so `name` is both.
 */
export const ORDER_MGMT = {
  name: "order-management-api",
  description: "REST API for order lookup, inventory, and return processing.",
  url: "https://orders.example.com/mcp",
  /** Who the server's sign-in page belongs to, as the login page shows it. */
  provider: "Order Management",
} as const;

/** The plugin's id; the tours never show it, `PluginServerRow` lists tools by it. */
const ORDER_MGMT_PLUGIN_ID = "plg-00000000-0000-0000-0000-0000000000a1";

/**
 * The server as a turn names it, `plugin_<plugin>_<server>` (Claude Code's
 * naming for a plugin's server; here plugin and server share one name). A
 * run's tool calls and approvals carry it as their `mcpServerSlug`, and a
 * tool's full name is `mcp__<this>__<tool>`.
 */
export const ORDER_MGMT_SERVER_SLUG = `plugin_${ORDER_MGMT.name}_${ORDER_MGMT.name}`;

/**
 * The server's tools as "Check tools" lists them: two lookups, and one the
 * server marks destructive because it moves money, so a person is asked
 * before a turn calls it.
 */
export const ORDER_MGMT_TOOLS: readonly PluginTool[] = [
  create(PluginToolSchema, {
    name: "get_order",
    description:
      "Retrieve details of a specific order by ID, including status, items, and tracking.",
  }),
  create(PluginToolSchema, {
    name: "list_orders",
    description: "List recent orders for a customer, filtered by status or date range.",
  }),
  create(PluginToolSchema, {
    name: "process_return",
    description:
      "Initiate a return and refund for an order. Requires order ID, reason, and amount.",
    destructive: true,
  }),
];

/**
 * The installed plugin: one HTTP server that signs in and accepts only a
 * sign-in (its address answered the install's probe with an OAuth
 * challenge). Built fresh per call, so a router handler never hands two
 * readers one mutable message.
 */
export function buildOrderMgmtPlugin(): Plugin {
  const plugin = samples.plugin({
    id: ORDER_MGMT_PLUGIN_ID,
    name: ORDER_MGMT.name,
    org: DEMO_ORG,
    description: ORDER_MGMT.description,
    serverUrl: ORDER_MGMT.url,
  });
  const server = plugin.status?.mcpServers[0];
  if (server) server.signIn = create(McpServerSignInSchema, { oauthOnly: true });
  return plugin;
}

/**
 * The person's My vault in the demo organization, before and after the
 * sign-in. A login is saved at the server's address (the URL as
 * `normalizeAddress` writes it, which this URL already is), which is what
 * the plugin page reads to say "Signed in". Its saved-at instant is the
 * tour world's anchor, derived rather than authored.
 */
export function buildMyVault(signedIn: boolean): Vault {
  const vault = samples.vault({
    id: "vlt-00000000-0000-0000-0000-0000000000a1",
    name: "my-vault",
    org: DEMO_ORG,
  });
  if (signedIn && vault.spec) {
    vault.spec.connections = {
      [ORDER_MGMT.url]: create(VaultConnectionSchema, {
        source: VaultConnectionSource.sign_in,
        description: `Signed in to ${ORDER_MGMT.name}`,
        savedAt: timestampFromDate(sampleDate()),
      }),
    };
  }
  return vault;
}
