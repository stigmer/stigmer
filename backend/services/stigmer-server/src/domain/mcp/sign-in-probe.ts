/**
 * One question, asked of an MCP server wherever it is written: does the
 * server at this address want a sign-in? A plugin's install asks it of the
 * plugin's servers (domain/plugin/probe-sign-in.ts) and an agent's save of
 * the agent's own (domain/agent/server-sign-ins.ts), so a server signs in
 * the same way whichever home holds it.
 *
 * What is asked: an `http` entry that says nothing about authentication,
 * meaning no variables, no `Authorization` header and no `${VAR}` in any
 * header (`authorShapeUrl`). Anything else is the author speaking about
 * authentication, and is left as written.
 *
 * The question: one `initialize` to the URL with the author's literal
 * headers, through the server's egress-guarded fetch, under a 3 s deadline
 * that covers DNS. No tool is called, no metadata document is fetched, no
 * redirect is followed. The answer is `oauth` (an OAuth challenge), `none`
 * (any other HTTP answer: a 2xx, a non-OAuth 401, another status) or
 * `unreachable` (no answer). A thrown probe is logged and read as
 * unreachable; the save that asked never fails on it.
 *
 * What an OAuth answer means for the entry (`completeSignIn`): the least
 * that makes Sign in work. The entry gets `sign_in.oauth_only` (a pasted key
 * is a dead end for such a server), an
 * `Authorization: Bearer ${<SERVER>_ACCESS_TOKEN}` header and the variable
 * in its `env`. The run's resolver then finds the server's login key from
 * that header and requires a login at the server's address.
 *
 * Tests: __tests__/sign-in-probe.test.ts.
 */
import { clone, create } from "@bufbuild/protobuf";

import type { OutboundFetch } from "@stigmer/outbound/egress";
import { probeEndpointAuth } from "@stigmer/outbound/mcp-oauth";
import { McpServerEntrySchema, McpServerSignInSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import type { McpServerEntry } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";

import type { Logger } from "../../boot/logger.js";

/** The save waits on the probe; a real endpoint answers well within this, DNS included. */
export const ENDPOINT_PROBE_TIMEOUT_MS = 3_000;

/** How the control plane names itself in the handshake's `clientInfo`. */
const PROBE_CLIENT_NAME = "stigmer-server";

const AUTHORIZATION_HEADER = "authorization";

/** What the probe dials with and where it logs. */
export interface SignInProbeDeps {
  readonly outboundFetch: OutboundFetch;
  readonly logger: Logger;
}

/** What a server answered: an OAuth challenge, any other HTTP answer, or none. */
export type SignInAnswer = "oauth" | "none" | "unreachable";

/**
 * The URL when the entry is the author's shape (an `http` server that says
 * nothing about authentication); undefined otherwise.
 */
export function authorShapeUrl(entry: McpServerEntry): string | undefined {
  if (entry.transport.case !== "http") return undefined;
  if (entry.env.length > 0) return undefined;
  for (const [name, value] of Object.entries(entry.transport.value.headers)) {
    if (name.toLowerCase() === AUTHORIZATION_HEADER) return undefined;
    if (value.includes("${")) return undefined;
  }
  return entry.transport.value.url;
}

/** A copy of the entry with its sign-in, the header that sends the login and the variable it reads. */
export function completeSignIn(entry: McpServerEntry, variable: string): McpServerEntry {
  const copy = clone(McpServerEntrySchema, entry);
  copy.env.push(variable);
  copy.signIn = create(McpServerSignInSchema, { oauthOnly: true });
  if (copy.transport.case === "http") {
    copy.transport.value.headers["Authorization"] = `Bearer \${${variable}}`;
  }
  return copy;
}

/** Ask the server at `url`, once, with the author's headers, whether it wants a sign-in. */
export async function askSignIn(
  url: string,
  headers: Readonly<Record<string, string>>,
  deps: SignInProbeDeps,
): Promise<SignInAnswer> {
  try {
    const outcome = await probeEndpointAuth(url, { ...headers }, {
      fetchImpl: deps.outboundFetch,
      timeoutMs: ENDPOINT_PROBE_TIMEOUT_MS,
      clientName: PROBE_CLIENT_NAME,
    });
    switch (outcome.kind) {
      case "oauth":
        return "oauth";
      case "unreachable":
        deps.logger.debug("MCP endpoint probe got no answer; the server is kept as written", { url, error: outcome.error });
        return "unreachable";
      default:
        return "none";
    }
  } catch (error) {
    // probeEndpointAuth never throws by contract; a throw here is a defect
    // in the fetch it was handed, and a save must not fail on it.
    deps.logger.warn("MCP endpoint probe threw; the server is kept as written", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return "unreachable";
  }
}
