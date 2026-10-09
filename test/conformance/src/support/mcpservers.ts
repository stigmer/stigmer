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
// matching the convention established by support/agents.ts.
import type { InitShape } from "./init-shape";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { type EnvVarDeclarationInit, makeEnvDeclarations } from "./vaults";

export const MCPSERVER_API_VERSION = "agentic.stigmer.ai/v1";
export const MCPSERVER_KIND = "McpServer";

export interface McpServerSpecOptions {
  // Human-readable description; defaults to a stable placeholder.
  description?: string;
  // stdio command to launch; defaults to a real reference MCP server invocation.
  command?: string;
  // Arguments passed to the command.
  args?: string[];
  // Env-var declarations projected into spec.env — the key whitelist the runner
  // filters the merged execution environment to before handing it to the stdio
  // child (mcp-resolver.ts filterEnvToDeclaredKeys). A stdio server that needs
  // configuration declares the key here and the run supplies the value (a
  // vault the conversation uses, or the declaration's plain value);
  // the runner's own process env is never inherited by design.
  env?: Record<string, EnvVarDeclarationInit>;
}

// A valid McpServerSpec: a stdio server configuration satisfying the
// `server_type` oneof (required) and `stdio.command` (required, min_len=1).
export function makeMcpServerSpec(
  opts: McpServerSpecOptions = {},
): InitShape<typeof McpServerSpecSchema> {
  return {
    description: opts.description ?? "conformance fixture",
    serverType: {
      case: "stdio",
      value: {
        command: opts.command ?? "npx",
        args: opts.args ?? ["-y", "@modelcontextprotocol/server-everything"],
      },
    },
    ...(opts.env !== undefined ? { env: makeEnvDeclarations(opts.env) } : {}),
  };
}

export interface McpServerOptions extends McpServerSpecOptions {
  org: string;
  name: string;
}

// A complete, valid McpServer resource ready to hand to create/apply/update.
export function makeMcpServer(opts: McpServerOptions): InitShape<typeof McpServerSchema> {
  const { org, name, description, command, args, env } = opts;
  return {
    apiVersion: MCPSERVER_API_VERSION,
    kind: MCPSERVER_KIND,
    metadata: { name, org },
    spec: makeMcpServerSpec({ description, command, args, env }),
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
  // execution time, not from a vault (the docs guide's rule 2).
  env?: Record<string, { optional?: boolean; isSecret?: boolean; description?: string }>;
}

export interface OAuthMcpServerOptions {
  org: string;
  name: string;
  // The env var a login at the server's address fills (auth.target_env_var).
  targetEnvVar: string;
  // The server's URL: its address. A sign-in at this address fills it.
  url: string;
  // auth.oauth_only — the endpoint takes no pasted token.
  oauthOnly?: boolean;
  // auth.scope_hints — shown before a sign-in; a sign-in never sends them.
  scopeHints?: string[];
}

// A complete, valid McpServer with an auth block — the fixture shape for the
// sign-in conformance suites. Only an HTTP server may carry one (a local
// program takes its keys as secrets), so the server is always an HTTP
// server: its URL is the address a sign-in saves its login at, and the
// runner reaches it there when a test connects.
export function makeOAuthMcpServer(opts: OAuthMcpServerOptions): InitShape<typeof McpServerSchema> {
  return {
    apiVersion: MCPSERVER_API_VERSION,
    kind: MCPSERVER_KIND,
    metadata: { name: opts.name, org: opts.org },
    spec: {
      description: "OAuth conformance fixture",
      serverType: { case: "http", value: { url: opts.url } },
      auth: {
        targetEnvVar: opts.targetEnvVar,
        ...(opts.oauthOnly !== undefined ? { oauthOnly: opts.oauthOnly } : {}),
        ...(opts.scopeHints !== undefined ? { scopeHints: opts.scopeHints } : {}),
      },
    },
  };
}

// A complete, valid HTTP McpServer resource. Used by the execution suites to
// register the in-process MCP tool fixture so a tool-using run can dispatch
// a real tool. To CALL a tool the resource only needs to be *created*: the
// runner connects to the URL live at execution time. The approval default's
// destructive mark is the exception; it comes from a stored discovery, so a
// gate arm creates its server through createConnectedMcpServer
// (support/agentexecutions.ts).
export function makeHttpMcpServer(opts: HttpMcpServerOptions): InitShape<typeof McpServerSchema> {
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
