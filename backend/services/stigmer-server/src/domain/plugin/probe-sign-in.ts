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
 * The question and the completion are the shared probe's
 * (domain/mcp/sign-in-probe.ts), which an agent's save asks of the agent's
 * own servers too; servers are probed in parallel, and the install never
 * fails on an answer.
 *
 * Tests: __tests__/probe-sign-in.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { McpServerEntry, PluginStatus } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { EnvVarDeclarationSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/declaration_pb";
import type { EnvVarDeclaration } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/declaration_pb";
import { accessTokenVariable } from "@stigmer/tool-vocabulary";

import { askSignIn, authorShapeUrl, completeSignIn } from "../mcp/sign-in-probe.js";
import type { SignInProbeDeps } from "../mcp/sign-in-probe.js";

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
  deps: SignInProbeDeps,
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
      const headers = entry.transport.case === "http" ? entry.transport.value.headers : {};
      if ((await askSignIn(url, headers, deps)) !== "oauth") {
        return entry;
      }
      const variable = accessTokenVariable(entry.name);
      env[variable] ??= create(EnvVarDeclarationSchema, {
        isSecret: true,
        optional: false,
        description: `OAuth access token for the '${entry.name}' MCP server; Sign in fills it`,
      });
      return completeSignIn(entry, variable);
    }),
  );
  return { mcpServers, env };
}
