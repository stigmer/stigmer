// The official plugin catalogue as the console reads it, for the
// marketplace's scenes: the files of `@stigmer/plugins` at the server's
// release, served through the npm CDN's listing and content URLs, which is
// where the console fetches them (sdk/react/src/plugin/sources/official.ts).
//
// The plugins are a frozen excerpt of the repository's own catalogue
// (plugins/, 2026-11-01): eight of its hosted MCP integrations, as their
// manifests and server declarations stand there. An excerpt, not the
// folder, so a picture of the marketplace changes when the marketplace
// changes, not every time a plugin is added.
import type { MarketplaceCatalogProps } from "@stigmer/react-sdk";

/** The release the gallery's server reports, so the official catalogue is published for it. */
export const SERVER_RELEASE = "0.1.0";

/** One integration: its name, its display name, what it does, and its hosted server. */
const INTEGRATIONS: readonly (readonly [name: string, displayName: string, description: string, url: string])[] = [
  ["atlassian", "Atlassian", "Atlassian's Rovo MCP server: Jira issues and Confluence pages across your Atlassian site. Sign in with your Atlassian account.", "https://mcp.atlassian.com/v1/mcp/authv2"],
  ["cloudflare", "Cloudflare", "Cloudflare's hosted MCP server: the zones, Workers, DNS and settings of your Cloudflare account. Sign in with your Cloudflare account.", "https://mcp.cloudflare.com/mcp"],
  ["figma", "Figma", "Figma's hosted MCP server: read design files, components, variables and comments. Sign in with your Figma account.", "https://mcp.figma.com/mcp"],
  ["linear", "Linear", "Linear's hosted MCP server: issues, projects, cycles and comments in your Linear workspace. Sign in with your Linear account.", "https://mcp.linear.app/mcp"],
  ["notion", "Notion", "Notion's hosted MCP server: search, read and write the pages and databases your account can reach. Sign in with your Notion account.", "https://mcp.notion.com/mcp"],
  ["sentry", "Sentry", "Sentry's hosted MCP server: issues, events and projects in your Sentry organization. Sign in with your Sentry account.", "https://mcp.sentry.dev/mcp"],
  ["stripe", "Stripe", "Stripe's hosted MCP server: customers, payments, subscriptions and the Stripe documentation. Sign in with your Stripe account.", "https://mcp.stripe.com"],
  ["vercel", "Vercel", "Vercel's hosted MCP server: projects, deployments and logs in your Vercel team. Sign in with your Vercel account.", "https://mcp.vercel.com"],
];

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The catalogue's files, path to content, laid out as the package publishes them. */
function catalogueFiles(): Map<string, string> {
  const files = new Map<string, string>([
    [
      "marketplace.json",
      json({
        name: "stigmer",
        description: "Stigmer's official plugin catalogue: the plugins you add by name.",
        owner: { name: "Stigmer", url: "https://stigmer.ai" },
        plugins: INTEGRATIONS.map(([name]) => ({ name, source: `./${name}` })),
      }),
    ],
  ]);
  for (const [name, displayName, description, url] of INTEGRATIONS) {
    files.set(
      `${name}/plugin.json`,
      json({
        name,
        version: "1.0.0",
        description,
        author: { name: "Stigmer", url: "https://stigmer.ai" },
        license: "Apache-2.0",
        extensions: { "ai.stigmer": { displayName, category: "integrations" } },
      }),
    );
    files.set(`${name}/mcp.json`, json({ mcpServers: { [name]: { type: "streamable-http", url } } }));
  }
  return files;
}

const encoder = new TextEncoder();
const PACKAGE_AT = `@stigmer/plugins@${SERVER_RELEASE}`;

/** A `fetch` that serves the catalogue at `SERVER_RELEASE` through the CDN's listing and content URLs, and refuses everything else. */
export function catalogueFetch(): NonNullable<MarketplaceCatalogProps["fetchImpl"]> {
  const files = catalogueFiles();
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === `https://data.jsdelivr.com/v1/package/npm/${PACKAGE_AT}/flat`) {
      const listing = [...files.entries()].map(([path, content]) => ({ name: `/${path}`, size: encoder.encode(content).length }));
      return new Response(JSON.stringify({ files: listing }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const prefix = `https://cdn.jsdelivr.net/npm/${PACKAGE_AT}/`;
    const content = url.startsWith(prefix) ? files.get(decodeURIComponent(url.slice(prefix.length))) : undefined;
    if (content !== undefined) return new Response(encoder.encode(content), { status: 200 });
    return new Response("the gallery serves only the official catalogue", { status: 404 });
  };
}
