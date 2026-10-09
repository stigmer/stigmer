/**
 * The local proxy's lanes: for each path the agent host may call, where the
 * call goes and with which of the runner's credentials. One rule for every
 * lane — swap the credential, forward the bytes (`relay.ts`) — in two modes
 * decided by the runner's own configuration:
 *
 *  - Forward, when the runner talks to the Stigmer platform's proxy
 *    (`config.proxyEndpoint` set): the call goes to the same path there,
 *    with the host's token replaced by the runner's control-plane token,
 *    read per request so rotation stays the runner's. The execution id the
 *    host's clients stamp (`X-Stigmer-Execution-Id`) passes through, because
 *    the platform's proxy authorizes and meters by it and `server.ts` has
 *    checked it names a live turn; no other scope header does.
 *  - Terminate, when the runner calls its providers itself: the call goes
 *    to the provider with the operator's key, or signed with the runner's
 *    ambient cloud identity — exactly the credential the runner's own model
 *    clients use (`shared/model-client.ts`), from the same settings. The
 *    host's clients are direct-mode clients bound to these lanes
 *    (`shared/model-lanes.ts`), so the wire each lane receives is already
 *    the provider's.
 *
 * Lanes, and the mode each serves in:
 *
 * | Lane                         | Forward | Terminate |
 * | ---------------------------- | ------- | --------- |
 * | `llm/anthropic`, `llm/openai`| yes     | yes       |
 * | `llm/bedrock`, `llm/vertex`, `llm/foundry` | no | yes |
 * | `model-registry`             | yes     | yes (to the runner's own control plane) |
 * | `checkpoints`                | yes     | no: a runner without the platform proxy checkpoints locally |
 *
 * What each lane may be asked, and by whom, is `server.ts`'s; this module
 * only answers where and how.
 */

import type { IncomingMessage } from "node:http";

import type { Config } from "../config.js";
import { parseAnthropicBaseUrl } from "../shared/llm-backend.js";
import { buildRegistryHeaders, resolveModelRegistryUrl } from "../shared/registry-endpoint.js";
import { getRunnerSecret } from "../shared/runner-credential-store.js";
import { forwardableHeaders, type Upstream } from "./relay.js";

/** A lane that cannot serve the call: the status and the message the host's SDK reads. */
export class LaneRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The providers a model lane names, after `/v1/proxy/llm/`. */
export type ModelProviderLane = "anthropic" | "openai" | "bedrock" | "vertex" | "foundry";

const MODEL_PROVIDER_LANES: ReadonlySet<string> = new Set<ModelProviderLane>(["anthropic", "openai", "bedrock", "vertex", "foundry"]);

export function isModelProviderLane(name: string): name is ModelProviderLane {
  return MODEL_PROVIDER_LANES.has(name);
}

/**
 * The paths each model lane serves: the model calls the host's clients
 * make (`shared/model-lanes.ts`), and nothing else under the provider's
 * root. The operator's key reaches the provider's files, batches and
 * fine-tuning too, and the runner's cloud identity every API of its
 * project; none of that is the engine's to ask for.
 */
const MODEL_CALL_PATHS: Readonly<Record<ModelProviderLane, RegExp>> = {
  anthropic: /^\/v1\/messages(\/count_tokens)?$/,
  openai: /^\/v1\/(chat\/completions|responses)$/,
  bedrock: /^\/model\/[^/]+\/(invoke|invoke-with-response-stream|count-tokens)$/,
  vertex: /^\/projects\/[^/]+\/locations\/[^/]+\/publishers\/anthropic\/models\/[^/:]+:(rawPredict|streamRawPredict)$/,
  foundry: /^\/v1\/messages(\/count_tokens)?$/,
};

/**
 * Where one model call goes. `rest` is the path after the lane's prefix,
 * with its query (`/v1/messages`, `/model/<id>/invoke-with-response-stream`).
 */
export async function modelUpstream(
  config: Config,
  lane: ModelProviderLane,
  rest: string,
  req: IncomingMessage,
  body: Buffer,
): Promise<Upstream> {
  const method = req.method ?? "POST";
  const path = rest.split("?")[0] ?? "";
  if (!MODEL_CALL_PATHS[lane].test(path)) throw new LaneRefusal(404, `the ${lane} lane serves model calls only, not ${path}`);
  if (config.proxyEndpoint !== null) {
    if (lane !== "anthropic" && lane !== "openai") {
      throw new LaneRefusal(404, `the ${lane} lane is not served: this runner's model calls go through the Stigmer platform`);
    }
    return {
      url: laneUrl(config.proxyEndpoint, `/v1/proxy/llm/${lane}${rest}`),
      method,
      headers: { ...forwardableHeaders(req.headers, true), authorization: `Bearer ${runnerToken(config)}` },
      body,
    };
  }
  const headers = forwardableHeaders(req.headers, false);
  switch (lane) {
    case "anthropic":
      return { url: laneUrl(anthropicBase(), rest), method, headers: { ...headers, "x-api-key": getRunnerSecret("ANTHROPIC_API_KEY") ?? "" }, body };
    case "openai":
      return { url: laneUrl(openAiBase(), stripV1(rest)), method, headers: { ...headers, authorization: `Bearer ${getRunnerSecret("OPENAI_API_KEY") ?? ""}` }, body };
    case "bedrock":
      return bedrockUpstream(rest, method, headers, body);
    case "vertex":
      return vertexUpstream(rest, method, headers, body);
    case "foundry":
      return foundryUpstream(rest, method, headers, body);
    /* v8 ignore start -- @preserve: the never arm; the compiler proves no lane reaches it */
    default: {
      const exhaustive: never = lane;
      throw new LaneRefusal(404, `unknown lane ${String(exhaustive)}`);
    }
    /* v8 ignore stop */
  }
}

/** The model registry: the runner's own read of it, with the runner's credential. */
export function registryUpstream(req: IncomingMessage): Upstream {
  return {
    url: new URL(resolveModelRegistryUrl()),
    method: "GET",
    headers: { ...forwardableHeaders(req.headers, false), ...buildRegistryHeaders() },
    body: Buffer.alloc(0),
  };
}

/** A checkpoint call, forwarded to the platform's checkpoint lane. `rest` keeps its query. */
export function checkpointUpstream(config: Config, rest: string, req: IncomingMessage, body: Buffer): Upstream {
  if (config.checkpointerType !== "http" || config.checkpointerProxyEndpoint === null) {
    throw new LaneRefusal(404, "the checkpoint lane is not served: this runner checkpoints locally");
  }
  return {
    url: laneUrl(config.checkpointerProxyEndpoint, `/v1/proxy/checkpoints${rest}`),
    method: req.method ?? "GET",
    headers: { ...forwardableHeaders(req.headers, false), authorization: `Bearer ${runnerToken(config)}` },
    body,
  };
}

// ─── Terminate-mode providers ─────────────────────────────────────────────

/** The public Anthropic API root: the operator's gateway (`ANTHROPIC_BASE_URL`) or Anthropic's own. */
function anthropicBase(): string {
  const parsed = parseAnthropicBaseUrl();
  if (!parsed.ok) throw new LaneRefusal(500, parsed.message);
  return parsed.baseUrl ?? "https://api.anthropic.com";
}

/** The OpenAI API root the SDK would use in the runner: `OPENAI_BASE_URL`, or OpenAI's own. */
function openAiBase(): string {
  return trimSlash(process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1");
}

/** The OpenAI lane's path carries the SDK's `/v1` (`MODEL_CALL_PATHS`); the root above already ends in it. */
function stripV1(rest: string): string {
  return rest.slice("/v1".length);
}

async function bedrockUpstream(rest: string, method: string, headers: Record<string, string | string[]>, body: Buffer): Promise<Upstream> {
  const region = process.env.AWS_REGION?.trim();
  if (!region) throw new LaneRefusal(500, "the bedrock lane needs AWS_REGION on the runner");
  const url = laneUrl(process.env.ANTHROPIC_BEDROCK_BASE_URL?.trim() || `https://bedrock-runtime.${region}.amazonaws.com`, rest);
  const bearer = getRunnerSecret("AWS_BEARER_TOKEN_BEDROCK");
  if (bearer) return { url, method, headers: { ...headers, authorization: `Bearer ${bearer}` }, body };
  // No bearer token: sign with the runner's AWS identity, through the
  // Bedrock SDK's own signer, so the signature covers exactly what it would
  // have covered had the runner made the call.
  const { getAuthHeaders } = await import("@anthropic-ai/bedrock-sdk/core/auth");
  let signed: Record<string, string>;
  try {
    signed = await getAuthHeaders(
      { method, headers: flattenHeaders(headers), body: body.toString("utf8") },
      { url: url.toString(), regionName: region, awsAccessKey: null, awsSecretKey: null, awsSessionToken: null },
    );
  } catch (err) {
    throw new LaneRefusal(502, `${describe(err)}${causeOf(err)}`);
  }
  return { url, method, headers: { ...headers, ...signed }, body };
}

let googleAuth: Promise<import("google-auth-library").GoogleAuth> | undefined;

async function vertexUpstream(rest: string, method: string, headers: Record<string, string | string[]>, body: Buffer): Promise<Upstream> {
  const region = process.env.CLOUD_ML_REGION?.trim();
  if (!region) throw new LaneRefusal(500, "the vertex lane needs CLOUD_ML_REGION on the runner");
  googleAuth ??= import("google-auth-library").then(({ GoogleAuth }) => new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" }));
  const auth = await googleAuth;
  let authHeaders: Headers;
  let project: string;
  try {
    authHeaders = await auth.getRequestHeaders();
    project = process.env.ANTHROPIC_VERTEX_PROJECT_ID?.trim() || (await auth.getProjectId());
  } catch (err) {
    throw new LaneRefusal(502, `Failed to acquire Google OAuth credentials: ${describe(err)}`);
  }
  // The host's client names a placeholder project (`shared/model-lanes.ts`);
  // the project is the runner's identity's to say.
  const path = rest.replace(/^\/projects\/[^/]+\//, `/projects/${encodeURIComponent(project)}/`);
  const url = laneUrl(vertexBase(region), path);
  return { url, method, headers: { ...headers, ...Object.fromEntries(authHeaders.entries()) }, body };
}

/** The Vertex API root for a region, as the Vertex SDK builds it, or `ANTHROPIC_VERTEX_BASE_URL`. */
export function vertexBase(region: string): string {
  const explicit = process.env.ANTHROPIC_VERTEX_BASE_URL?.trim();
  if (explicit) return trimSlash(explicit);
  switch (region) {
    case "global":
      return "https://aiplatform.googleapis.com/v1";
    case "us":
    case "eu":
      return `https://aiplatform.${region}.rep.googleapis.com/v1`;
    default:
      return `https://${region}-aiplatform.googleapis.com/v1`;
  }
}

let azureToken: Promise<() => Promise<string>> | undefined;

async function foundryUpstream(rest: string, method: string, headers: Record<string, string | string[]>, body: Buffer): Promise<Upstream> {
  const explicit = process.env.ANTHROPIC_FOUNDRY_BASE_URL?.trim();
  const resource = process.env.ANTHROPIC_FOUNDRY_RESOURCE?.trim();
  if (!explicit && !resource) throw new LaneRefusal(500, "the foundry lane needs ANTHROPIC_FOUNDRY_RESOURCE or ANTHROPIC_FOUNDRY_BASE_URL on the runner");
  const base = explicit || `https://${resource}.services.ai.azure.com/anthropic/`;
  const url = laneUrl(base, rest);
  const key = getRunnerSecret("ANTHROPIC_FOUNDRY_API_KEY")?.trim();
  if (key) return { url, method, headers: { ...headers, "x-api-key": key }, body };
  azureToken ??= import("@azure/identity").then(({ DefaultAzureCredential, getBearerTokenProvider }) =>
    getBearerTokenProvider(new DefaultAzureCredential(), "https://ai.azure.com/.default"),
  );
  let token: string;
  try {
    token = await (await azureToken)();
  } catch (err) {
    throw new LaneRefusal(502, `Failed to acquire an Azure token for Microsoft Foundry: ${describe(err)}`);
  }
  return { url, method, headers: { ...headers, authorization: `Bearer ${token}` }, body };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function runnerToken(config: Config): string {
  const token = config.stigmerTokenRef.current;
  if (!token) throw new LaneRefusal(503, "the runner holds no Stigmer credential to forward this call with");
  return token;
}

/**
 * `base` with the host's `path` (which starts with `/`) appended, on
 * `base`'s own origin and under its own path. The path is the agent host's
 * to choose; the origin never is, so a path that would resolve elsewhere (a
 * scheme, `//`, `..`) is refused before any credential is attached.
 */
export function laneUrl(base: string, path: string): URL {
  const root = new URL(trimSlash(base));
  const url = new URL(`${trimSlash(base)}${path}`);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) {
    throw new LaneRefusal(400, "the lane's path must stay under the lane's own endpoint");
  }
  return url;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function flattenHeaders(headers: Record<string, string | string[]>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(", ") : value]));
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function causeOf(err: unknown): string {
  const cause = err instanceof Error ? err.cause : undefined;
  return cause instanceof Error ? ` (${cause.message})` : "";
}
