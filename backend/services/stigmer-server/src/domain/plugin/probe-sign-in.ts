/**
 * Makes a URL enough: a plugin's server at an address that says nothing
 * about authentication is asked once, at install, whether it wants a
 * sign-in, and when it does its entry is completed so Sign in exists from
 * the moment the plugin does. Most catalog servers are a URL alone
 * (`plugins/linear/.mcp.json`), and the run's resolver finds a server's
 * login key from its `Authorization: Bearer ${VAR}` header, so without
 * this a URL-only server could never receive its sign-in.
 *
 * What is probed: an `http` entry with no variables, no `Authorization`
 * header and no `${VAR}` in any header. Anything else is the author
 * speaking about authentication, and is left as written.
 *
 * What is written, and only on an OAuth challenge: the least that makes
 * Sign in work. The entry gets `sign_in.oauth_only` (a pasted key is a dead
 * end for such a server), an `Authorization: Bearer ${<SERVER>_ACCESS_TOKEN}`
 * header and the variable in its `env`; the plugin's `env` declares the
 * variable as a required secret. These live on the plugin's status only;
 * the archive is never rewritten. Every other outcome (a 2xx, a non-OAuth
 * 401, any other status, no answer) leaves the entry as read.
 *
 * A re-push of the archive already installed (the same digest) reuses the
 * stored entries and asks nothing: the install is a pure function of the
 * archive and the answers it already recorded.
 *
 * The probe: one `initialize` to the URL with the author's literal headers,
 * through the server's egress-guarded fetch, under a 3 s deadline that
 * covers DNS; servers are probed in parallel. No tool is called, no
 * metadata document is fetched, no redirect is followed. A thrown probe is
 * logged and read as unreachable; the install never fails on it.
 *
 * Tests: __tests__/probe-sign-in.test.ts.
 */
import { clone, create } from "@bufbuild/protobuf";

import type { OutboundFetch } from "@stigmer/outbound/egress";
import { probeEndpointAuth } from "@stigmer/outbound/mcp-oauth";
import { McpServerEntrySchema, McpServerSignInSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { McpServerEntry, PluginStatus } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";

import type { Logger } from "../../boot/logger.js";

/** The install waits on the probe; a real endpoint answers well within this, DNS included. */
export const ENDPOINT_PROBE_TIMEOUT_MS = 3_000;

/** How the control plane names itself in the handshake's `clientInfo`. */
const PROBE_CLIENT_NAME = "stigmer-server";

/** The suffix of the token variable a completed server reads. */
export const ACCESS_TOKEN_VAR_SUFFIX = "_ACCESS_TOKEN";

const AUTHORIZATION_HEADER = "authorization";

export interface ProbeSignInDeps {
  readonly outboundFetch: OutboundFetch;
  readonly logger: Logger;
}

/** The entries and variables after the probe. */
export interface ProbedServers {
  readonly mcpServers: McpServerEntry[];
  readonly env: Record<string, EnvVarDeclaration>;
}

/**
 * Completes each URL-only entry that answers with an OAuth challenge. With
 * `installed` holding the same archive (equal digest), its stored entries
 * and variables are returned as they are, and nothing is probed.
 */
export async function probeSignIns(
  deps: ProbeSignInDeps,
  planned: { readonly mcpServers: readonly McpServerEntry[]; readonly env: Readonly<Record<string, EnvVarDeclaration>> },
  digest: string,
  installed: PluginStatus | undefined,
): Promise<ProbedServers> {
  if (installed !== undefined && installed.digest === digest && installed.digest !== "") {
    return { mcpServers: [...installed.mcpServers], env: { ...installed.env } };
  }
  const env = { ...planned.env };
  const mcpServers = await Promise.all(
    planned.mcpServers.map(async (entry) => {
      const url = authorShapeUrl(entry);
      if (url === undefined) {
        return entry;
      }
      if ((await probe(url, entry, deps)) !== "oauth") {
        return entry;
      }
      const variable = accessTokenVariable(entry.name);
      env[variable] ??= create(EnvVarDeclarationSchema, {
        isSecret: true,
        optional: false,
        description: `OAuth access token for the '${entry.name}' MCP server; Sign in fills it`,
      });
      return completed(entry, variable);
    }),
  );
  return { mcpServers, env };
}

/**
 * The URL when the entry is the author's shape (an `http` server that says
 * nothing about authentication); undefined otherwise.
 */
function authorShapeUrl(entry: McpServerEntry): string | undefined {
  if (entry.transport.case !== "http") return undefined;
  if (entry.env.length > 0) return undefined;
  for (const [name, value] of Object.entries(entry.transport.value.headers)) {
    if (name.toLowerCase() === AUTHORIZATION_HEADER) return undefined;
    if (value.includes("${")) return undefined;
  }
  return entry.transport.value.url;
}

/** The entry with its sign-in, the header that sends the login and the variable it reads. */
function completed(entry: McpServerEntry, variable: string): McpServerEntry {
  const copy = clone(McpServerEntrySchema, entry);
  copy.env.push(variable);
  copy.signIn = create(McpServerSignInSchema, { oauthOnly: true });
  if (copy.transport.case === "http") {
    copy.transport.value.headers["Authorization"] = `Bearer \${${variable}}`;
  }
  return copy;
}

/** `<SERVER>_ACCESS_TOKEN`, the server's name upper-cased with every non-alphanumeric run as one underscore. */
export function accessTokenVariable(serverName: string): string {
  const stem = serverName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${stem === "" ? "MCP" : stem}${ACCESS_TOKEN_VAR_SUFFIX}`;
}

async function probe(url: string, entry: McpServerEntry, deps: ProbeSignInDeps): Promise<"oauth" | "other"> {
  const headers = entry.transport.case === "http" ? entry.transport.value.headers : {};
  try {
    const outcome = await probeEndpointAuth(url, headers, {
      fetchImpl: deps.outboundFetch,
      timeoutMs: ENDPOINT_PROBE_TIMEOUT_MS,
      clientName: PROBE_CLIENT_NAME,
    });
    if (outcome.kind === "unreachable") {
      deps.logger.debug("MCP endpoint probe got no answer; the server is installed as written", { url, error: outcome.error });
    }
    return outcome.kind === "oauth" ? "oauth" : "other";
  } catch (error) {
    // probeEndpointAuth never throws by contract; a throw here is a defect
    // in the fetch it was handed, and an install must not fail on it.
    deps.logger.warn("MCP endpoint probe threw; the server is installed as written", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return "other";
  }
}
