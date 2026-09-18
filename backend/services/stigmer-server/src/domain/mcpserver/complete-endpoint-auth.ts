/**
 * CompleteEndpointAuth — the McpServer create and update chains' step that
 * makes a URL enough: a server saved with only an `http.url` is asked once
 * whether it wants OAuth, and when it does, the spec is completed so Sign
 * in exists from the moment the row does.
 *
 * Why the domain and not the plugin. A plugin is one producer of servers
 * among three (a plugin install, `stigmer apply` of a YAML, the console's
 * form), and every producer's server runs these two chains. A step here
 * reaches all three; a behaviour in the plugin's materialisation would
 * make the same YAML come alive from a plugin and stay dead by hand.
 *
 * What the step reads: the author's shape only. An `http` server whose
 * `auth` is unset, whose `env` is empty, and whose headers carry neither a
 * `${VAR}` placeholder nor an `Authorization` header. Anything else is the
 * author speaking about authentication (a declared token variable, a
 * pasted literal token, an `auth` block, an `oauth_app_ref`) and the step
 * leaves the state exactly as sent.
 *
 * What the step writes, and only on an OAuth challenge: the least that
 * makes Sign in possible and the page honest. `auth.target_env_var`
 * (`<SLUG>_ACCESS_TOKEN`), the secret `env` declaration for it, the
 * `Authorization: Bearer ${VAR}` header, `auth.oauth_only` (the reading the
 * runner's "requires OAuth" sentence and the console's credential hook
 * already apply to a 401 challenge: manual token entry is a dead end), and
 * the provenance label `stigmer.ai/mcp-auth: endpoint`, vouched through
 * the server-stamped mechanism so GuardReservedLabels admits it for an
 * ordinary caller. Not written: `discovery_url` (the author's override;
 * Sign in resolves the login server from `http.url` every time through
 * the RFC 9728 walk) and `scope_hints` (initiate reads the login server's
 * `scopes_supported` when hints are empty). A cached fact drifts; the
 * endpoint restates these on every Sign in.
 *
 * Every other outcome (a 2xx, a non-OAuth 401, any other status, no
 * answer) leaves the spec as sent and writes no status: `ConnectStatus`
 * records connect operations, and a probe is not one. The best-effort
 * connect that follows an apply then runs for these servers as before.
 *
 * Carry-over on update, three questions in order:
 *
 *   1. Is the author speaking about auth? An incoming `auth`, `env`,
 *      placeholder or `Authorization` header that is NOT exactly the trio
 *      this step derived on the existing row means yes: the state is left
 *      as sent and the label is dropped (a removal passes the guard by
 *      design). An exact echo of the derived trio (the console's per-field
 *      save re-sends the whole spec) is not the author speaking: the label
 *      is kept and nothing is probed.
 *   2. Is it the same endpoint? A changed URL with the author's shape is
 *      probed again.
 *   3. Has it already answered? The author's shape at the same URL on a
 *      row carrying the label reuses the existing completion with no
 *      network: a plugin re-push and a `stigmer apply` re-run cost nothing
 *      and change nothing.
 *
 * The Bearer default applies to every producer: whenever
 * `auth.target_env_var` is set (by hand, by a plugin overlay, or by this
 * step) and no header references that variable, the `Authorization` header
 * is added, so an `auth` block never sits silently dead for want of the
 * header that sends its token.
 *
 * The probe: one complete `initialize` to `http.url` with the author's
 * literal headers, through the slice's egress-guarded `outboundFetch`,
 * under a 3 s deadline that covers DNS (the save waits on it; a hosted
 * endpoint answers in well under a second, an unreachable host fails at
 * once, and only a host that accepts and stalls reaches the ceiling). No
 * tool is called, no metadata document is fetched, no redirect is
 * followed. A thrown probe is logged and read as unreachable; the save
 * never fails on it.
 *
 * Placement: after BuildNewState (create) or BuildUpdateState (update),
 * immediately before GuardReservedLabels, the lineage step's law: the
 * labels the guard diffs are the ones this step stamped.
 *
 * Proven by __tests__/complete-endpoint-auth.test.ts and the McpServer
 * conformance suite's URL-only arms (CONFORMANCE_TARGET=local).
 */
import { create } from "@bufbuild/protobuf";

import type { OutboundFetch } from "@stigmer/outbound/egress";
import { probeEndpointAuth } from "@stigmer/outbound/mcp-oauth";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { McpServer, McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerAuthSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { McpServerSpec } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";

import type { Logger } from "../../boot/logger.js";
import { MCP_AUTH_ENDPOINT, MCP_AUTH_LABEL } from "../../pipeline/apiresource-labels.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { recordServerStampedReservedLabels } from "../../pipeline/steps/server-stamped-reserved-labels.js";

/** The save waits on the probe; a real endpoint answers well within this, DNS included. */
export const ENDPOINT_PROBE_TIMEOUT_MS = 3_000;

/** How the control plane names itself in the handshake's `clientInfo`. */
const PROBE_CLIENT_NAME = "stigmer-server";

/** The suffix of the token variable the step declares for a completed server. */
export const ACCESS_TOKEN_VAR_SUFFIX = "_ACCESS_TOKEN";

const AUTHORIZATION_HEADER = "authorization";

export interface CompleteEndpointAuthDeps {
  readonly outboundFetch: OutboundFetch;
  readonly logger: Logger;
}

export function newCompleteEndpointAuthStep(deps: CompleteEndpointAuthDeps): PipelineStep<typeof McpServerSchema> {
  return {
    name: "CompleteEndpointAuth",
    async execute(ctx: RequestContext<typeof McpServerSchema>): Promise<void> {
      const server = ctx.newState;
      const spec = server.spec;
      if (spec === undefined) return;

      applyBearerDefault(spec);

      const existing = ctx.get(EXISTING_RESOURCE_KEY) as McpServer | undefined;
      const derived = existing !== undefined ? derivedCompletionOf(existing) : undefined;

      const url = authorShapeUrl(spec);
      if (url === undefined) {
        // The author speaks about auth. An exact echo of what this step
        // derived is the console re-sending what it loaded: keep the label.
        // Anything else is the author's own; the label goes.
        if (derived !== undefined && echoesDerived(spec, derived)) {
          stamp(ctx, server);
        } else {
          dropLabel(server);
        }
        return;
      }

      if (derived !== undefined && derived.url === url) {
        applyCompletion(spec, derived.variable, derived.description);
        stamp(ctx, server);
        return;
      }

      const outcome = await probe(url, spec, deps);
      if (outcome !== "oauth") {
        dropLabel(server);
        return;
      }
      const variable = accessTokenVariable(server.metadata?.slug ?? "");
      applyCompletion(spec, variable, tokenDescription(server.metadata?.slug ?? ""));
      stamp(ctx, server);
    },
  };
}

/**
 * The URL when the spec is the author's shape (an `http` server that says
 * nothing about authentication); undefined otherwise.
 */
function authorShapeUrl(spec: McpServerSpec): string | undefined {
  if (spec.serverType.case !== "http") return undefined;
  if (spec.auth !== undefined) return undefined;
  if (Object.keys(spec.env).length > 0) return undefined;
  for (const [name, value] of Object.entries(spec.serverType.value.headers)) {
    if (name.toLowerCase() === AUTHORIZATION_HEADER) return undefined;
    if (value.includes("${")) return undefined;
  }
  return spec.serverType.value.url;
}

/** The completion an earlier save derived, read from a row that carries the label. */
interface DerivedCompletion {
  readonly url: string;
  readonly variable: string;
  readonly description: string;
}

function derivedCompletionOf(existing: McpServer): DerivedCompletion | undefined {
  if (existing.metadata?.labels[MCP_AUTH_LABEL] !== MCP_AUTH_ENDPOINT) return undefined;
  const spec = existing.spec;
  if (spec === undefined || spec.serverType.case !== "http") return undefined;
  const variable = spec.auth?.targetEnvVar ?? "";
  if (variable === "") return undefined;
  return { url: spec.serverType.value.url, variable, description: spec.env[variable]?.description ?? "" };
}

/** Whether the incoming spec carries exactly the trio the step derived, and nothing more about auth. */
function echoesDerived(spec: McpServerSpec, derived: DerivedCompletion): boolean {
  if (spec.serverType.case !== "http" || spec.serverType.value.url !== derived.url) return false;
  const auth = spec.auth;
  if (auth === undefined) return false;
  if (auth.targetEnvVar !== derived.variable || !auth.oauthOnly) return false;
  if ((auth.oauthAppRef?.slug ?? "") !== "" || auth.discoveryUrl !== "" || auth.scopeHints.length > 0 || auth.tokenLifetimeHint !== "") return false;
  const envKeys = Object.keys(spec.env);
  if (envKeys.length !== 1 || envKeys[0] !== derived.variable) return false;
  const declaration = spec.env[derived.variable];
  if (declaration === undefined || !declaration.isSecret || declaration.optional) return false;
  const headers = Object.entries(spec.serverType.value.headers);
  const authorization = headers.filter(([name]) => name.toLowerCase() === AUTHORIZATION_HEADER);
  if (authorization.length !== 1 || authorization[0]?.[1] !== bearerHeader(derived.variable)) return false;
  return headers.every(([name, value]) => name.toLowerCase() === AUTHORIZATION_HEADER || !value.includes("${"));
}

function applyCompletion(spec: McpServerSpec, variable: string, description: string): void {
  spec.auth = create(McpServerAuthSchema, { targetEnvVar: variable, oauthOnly: true });
  spec.env[variable] = create(EnvVarDeclarationSchema, { isSecret: true, optional: false, description });
  applyBearerDefault(spec);
}

/**
 * Whenever a token variable is declared and no header references it, the
 * header that sends it is added; a header that references it is left as
 * the author wrote it.
 */
function applyBearerDefault(spec: McpServerSpec): void {
  const variable = spec.auth?.targetEnvVar ?? "";
  if (variable === "" || spec.serverType.case !== "http") return;
  const headers = spec.serverType.value.headers;
  const reference = `\${${variable}}`;
  if (Object.values(headers).some((value) => value.includes(reference))) return;
  headers["Authorization"] = bearerHeader(variable);
}

function bearerHeader(variable: string): string {
  return `Bearer \${${variable}}`;
}

/** `<SLUG>_ACCESS_TOKEN`, the slug upper-cased with every non-alphanumeric run as one underscore. */
export function accessTokenVariable(slug: string): string {
  const stem = slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${stem === "" ? "MCP" : stem}${ACCESS_TOKEN_VAR_SUFFIX}`;
}

function tokenDescription(slug: string): string {
  return `OAuth access token for the '${slug}' MCP server; Sign in fills it`;
}

function stamp(ctx: RequestContext<typeof McpServerSchema>, server: McpServer): void {
  if (server.metadata === undefined) return;
  server.metadata.labels[MCP_AUTH_LABEL] = MCP_AUTH_ENDPOINT;
  recordServerStampedReservedLabels(ctx, MCP_AUTH_LABEL);
}

function dropLabel(server: McpServer): void {
  if (server.metadata === undefined) return;
  delete server.metadata.labels[MCP_AUTH_LABEL];
}

async function probe(url: string, spec: McpServerSpec, deps: CompleteEndpointAuthDeps): Promise<"oauth" | "other"> {
  const headers = spec.serverType.case === "http" ? spec.serverType.value.headers : {};
  try {
    const outcome = await probeEndpointAuth(url, headers, {
      fetchImpl: deps.outboundFetch,
      timeoutMs: ENDPOINT_PROBE_TIMEOUT_MS,
      clientName: PROBE_CLIENT_NAME,
    });
    if (outcome.kind === "unreachable") {
      deps.logger.debug("MCP endpoint probe got no answer; saving the spec as sent", { url, error: outcome.error });
    }
    return outcome.kind === "oauth" ? "oauth" : "other";
  } catch (error) {
    // probeEndpointAuth never throws by contract; a throw here is a defect
    // in the fetch it was handed, and a save must not fail on it.
    deps.logger.warn("MCP endpoint probe threw; saving the spec as sent", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return "other";
  }
}
