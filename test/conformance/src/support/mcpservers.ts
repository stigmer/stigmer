// Canonical valid McpServer fixtures for the conformance suite.
// Domain: conformance support.
//
// McpServer is a flat (non-versioned) blueprint whose spec carries a required
// `server_type` oneof. These builders give the suite one canonical *valid* MCP
// server — a stdio subprocess server, the most common kind — so CRUD and
// cross-resource tests share a single source of truth and vary it deliberately.
//
// Negative cases (missing server_type, empty command, malformed URL) are written
// inline in the suite, not here: this module represents validity by construction,
// matching the convention established by support/workflows.ts.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

export const MCPSERVER_API_VERSION = "agentic.stigmer.ai/v1";
export const MCPSERVER_KIND = "McpServer";

export interface McpServerSpecOptions {
  // Human-readable description; defaults to a stable placeholder.
  description?: string;
  // stdio command to launch; defaults to a real reference MCP server invocation.
  command?: string;
  // Arguments passed to the command.
  args?: string[];
}

// A valid McpServerSpec: a stdio server configuration satisfying the
// `server_type` oneof (required) and `stdio.command` (required, min_len=1).
export function makeMcpServerSpec(
  opts: McpServerSpecOptions = {},
): MessageInitShape<typeof McpServerSpecSchema> {
  return {
    description: opts.description ?? "conformance fixture",
    serverType: {
      case: "stdio",
      value: {
        command: opts.command ?? "npx",
        args: opts.args ?? ["-y", "@modelcontextprotocol/server-everything"],
      },
    },
  };
}

export interface McpServerOptions extends McpServerSpecOptions {
  org: string;
  name: string;
}

// A complete, valid McpServer resource ready to hand to create/apply/update.
export function makeMcpServer(opts: McpServerOptions): MessageInitShape<typeof McpServerSchema> {
  const { org, name, description, command, args } = opts;
  return {
    apiVersion: MCPSERVER_API_VERSION,
    kind: MCPSERVER_KIND,
    metadata: { name, org },
    spec: makeMcpServerSpec({ description, command, args }),
  };
}

export interface HttpMcpServerOptions {
  org: string;
  name: string;
  // Base URL of an HTTP (Streamable) MCP server, e.g. the execution target's
  // McpToolFixture.url(). Satisfies the `server_type` oneof via http config.
  url: string;
  description?: string;
  // HTTP headers sent with every request (spec.http.headers). Values may
  // template declared env vars — including the reserved caller-identity keys
  // — with `${VAR}` placeholders; every templated key MUST be declared in
  // `env` or resolution fails (the docs guide's rule 1).
  headers?: Record<string, string>;
  // Env declarations (spec.env). The reserved caller-identity keys must be
  // declared `optional: true` — their values come from the runner at
  // execution time, not from an Environment (the docs guide's rule 2).
  env?: Record<string, { optional?: boolean; isSecret?: boolean; description?: string }>;
}

export interface OAuthMcpServerOptions {
  org: string;
  name: string;
  // The env var the acquired access token is stored under (auth.target_env_var).
  targetEnvVar: string;
  // Base URL of an HTTP MCP server. When omitted the server is a stdio shape
  // whose command never runs — the right isolation for handshake-only tests.
  url?: string;
  // auth.discovery_url — point at a mock authorization server's origin for
  // the DCR arm (priority: discovery_url > http.url, so this also works on
  // http servers whose URL serves no metadata).
  discoveryUrl?: string;
  // auth.oauth_app_ref slug — selects the vendor arm.
  oauthAppSlug?: string;
  // auth.oauth_only — flips the vendor refusal's alternative sentence.
  oauthOnly?: boolean;
  // auth.scope_hints — DCR scope selection (fallback: discovered metadata).
  scopeHints?: string[];
}

// A complete, valid McpServer with an OAuth auth block — the fixture shape for
// the connect/OAuth conformance suites (CW-1). Defaults to a stdio server with
// a command that never executes: the OAuth handshake RPCs never touch the
// server process itself, so a no-op command isolates them completely. Pass
// `url` for the connect-time tests that need the runner to reach a real
// (fixture) MCP endpoint after the handshake.
export function makeOAuthMcpServer(opts: OAuthMcpServerOptions): MessageInitShape<typeof McpServerSchema> {
  return {
    apiVersion: MCPSERVER_API_VERSION,
    kind: MCPSERVER_KIND,
    metadata: { name: opts.name, org: opts.org },
    spec: {
      description: "OAuth conformance fixture",
      serverType:
        opts.url !== undefined
          ? { case: "http", value: { url: opts.url } }
          : { case: "stdio", value: { command: "conformance-oauth-noop" } },
      auth: {
        targetEnvVar: opts.targetEnvVar,
        ...(opts.discoveryUrl !== undefined ? { discoveryUrl: opts.discoveryUrl } : {}),
        ...(opts.oauthAppSlug !== undefined
          ? { oauthAppRef: { kind: ApiResourceKind.oauth_app, org: opts.org, slug: opts.oauthAppSlug } }
          : {}),
        ...(opts.oauthOnly !== undefined ? { oauthOnly: opts.oauthOnly } : {}),
        ...(opts.scopeHints !== undefined ? { scopeHints: opts.scopeHints } : {}),
      },
    },
  };
}

// A complete, valid HTTP McpServer resource. Used by the execution suites to
// register the in-process MCP tool fixture so a tool-using agent run can dispatch
// a real tool. The resource only needs to be *created*: the runner connects to
// the URL live at execution time (no `connect`/discovery step required).
export function makeHttpMcpServer(opts: HttpMcpServerOptions): MessageInitShape<typeof McpServerSchema> {
  return {
    apiVersion: MCPSERVER_API_VERSION,
    kind: MCPSERVER_KIND,
    metadata: { name: opts.name, org: opts.org },
    spec: {
      description: opts.description ?? "conformance HTTP MCP fixture",
      serverType: {
        case: "http",
        value: { url: opts.url, ...(opts.headers !== undefined ? { headers: opts.headers } : {}) },
      },
      ...(opts.env !== undefined ? { env: opts.env } : {}),
    },
  };
}
