// Registration helpers for MCP resource templates.
// Go parity: mcp-server/internal/domains/resourcehandler.go.
//
// Every Stigmer resource template resolves the per-request credential the same
// way tools do (resolveToken over extra.authInfo), parses org/slug[/version]
// from the request URI, delegates to the domain fetch, and returns a single
// application/json content entry. These helpers keep each domain's resources.ts
// a one-liner and ensure the auth + result shape stay identical across domains.

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

import { resolveToken, type BackendTarget } from "./client";
import { parseResourceURI, parseVersionedResourceURI } from "./resourceuri";

/** Domain read used by a non-versioned resource template. */
export type ResourceFetch = (
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
) => Promise<string>;

/** Domain read used by a versioned resource template ("" version means latest). */
export type VersionedResourceFetch = (
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
  version: string,
) => Promise<string>;

/** Options shared by both registration helpers. */
interface ResourceOptions {
  /** Stable resource name surfaced in resources/templates/list (e.g. stigmer_agent). */
  readonly name: string;
  /** Human title surfaced to clients (e.g. "Stigmer Agent"). */
  readonly title: string;
  /** Human description surfaced to clients. */
  readonly description: string;
  /** RFC-6570 URI template, e.g. stigmer://agents/{org}/{slug}. */
  readonly template: string;
}

/** Register a stigmer://{authority}/{org}/{slug} resource template. */
export function registerResource(
  server: McpServer,
  target: BackendTarget,
  opts: ResourceOptions & { readonly fetch: ResourceFetch },
): void {
  server.registerResource(
    opts.name,
    new ResourceTemplate(opts.template, { list: undefined }),
    { title: opts.title, description: opts.description, mimeType: "application/json" },
    async (uri, _vars, extra) => {
      const { org, slug } = parseResourceURI(uri.href);
      const text = await opts.fetch(target.serverAddress, resolveToken(extra, target.apiKey), org, slug);
      return jsonResource(uri.href, text);
    },
  );
}

/** Register a stigmer://{authority}/{org}/{slug}[/{version}] resource template. */
export function registerVersionedResource(
  server: McpServer,
  target: BackendTarget,
  opts: ResourceOptions & { readonly fetch: VersionedResourceFetch },
): void {
  server.registerResource(
    opts.name,
    new ResourceTemplate(opts.template, { list: undefined }),
    { title: opts.title, description: opts.description, mimeType: "application/json" },
    async (uri, _vars, extra) => {
      const { org, slug, version } = parseVersionedResourceURI(uri.href);
      const text = await opts.fetch(
        target.serverAddress,
        resolveToken(extra, target.apiKey),
        org,
        slug,
        version,
      );
      return jsonResource(uri.href, text);
    },
  );
}

/** Wrap fetched JSON text into the single-entry ReadResourceResult tools expect. */
function jsonResource(uri: string, text: string): ReadResourceResult {
  return { contents: [{ uri, mimeType: "application/json", text }] };
}
