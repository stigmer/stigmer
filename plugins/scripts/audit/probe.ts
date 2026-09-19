/**
 * What a hosted MCP server says to an unauthenticated caller, and what that
 * means for a Stigmer user; pure over an injected `fetch`.
 *
 * The rubric asks whether every server a plugin brings is one Stigmer can
 * connect to. The rules the answer rests on have one home,
 * `@stigmer/outbound/mcp-oauth`, shared with the runner (which applies them
 * at the first failed tool call) and the control plane (which applies them
 * at save time): a 401 is an OAuth challenge only when `WWW-Authenticate`
 * carries `Bearer` and either `oauth` or `resource_metadata`, so a
 * static-token API's plain `Bearer` 401 is not misread as "requires OAuth";
 * the request is a complete `initialize` (protocol version, capabilities,
 * client info), because several hosted servers (Google's Gmail, Calendar,
 * Drive and BigQuery endpoints, GoDaddy's, Shopify's) validate the request
 * before they check authentication and answer a bare one with HTTP 200 and
 * "Missing protocol version for Initialize", so a bare request never
 * reached their 401 (measured 2026-09-19; the bare request called seven
 * OAuth servers open); and the login server is found by the RFC 9728,
 * RFC 8414 and OpenID walk whose document order the library states once.
 * This file imports all three and adds what a measurement needs on top.
 *
 * What is the audit's own. A 2xx to `initialize` is read as JSON-RPC, not as
 * a status line: a `result` is an open handshake, an `error` is a rejected
 * one (its message kept), because the report must say which. An open
 * handshake is followed by one anonymous `tools/list`, the product's next
 * move (`discover-mcp-server.ts` initialises, then lists tools); a 401 there
 * enters the same rule and the outcome says which request drew it. The
 * probe stops there: it never calls a tool, because a tool call on a
 * vendor's server is an act with effects, not a measurement, so a server
 * that lists its tools anonymously and asks for the credential only at
 * `tools/call` (Google's do, measured 2026-09-19) is `open` here, and the
 * report says what `open` covers. The metadata walk is followed to learn
 * two facts Sign in will need: whether the login server registers clients
 * dynamically (RFC 7591; without it Sign in cannot complete) and whether it
 * lives on another origin than the MCP URL. The transport arm: the runner's
 * MCP client falls back to SSE when the streamable-HTTP POST is answered
 * with a 4xx, so a 4xx other than 401 is followed by one GET asking for an
 * event stream, and a server that answers with one is `open`. Every request
 * made is kept as evidence, raw header included, so an inconsistent answer
 * is settled by what was seen rather than by a second guess. One retry
 * after a pause on a network failure, a 429 (honouring `Retry-After`,
 * capped) or a 5xx; the probe never sends a credential and never follows a
 * redirect.
 *
 * The outcome vocabulary is closed and says only what the wire said; what a
 * host or a vendor means (a Cursor-proxied endpoint, a personal-account
 * tool) is the rubric's reading in `classify.ts`.
 */
import {
  authorizationServerMetadataUrls,
  initializeRequest,
  isOAuthChallenge,
  MCP_PROTOCOL_VERSION,
  MCP_SESSION_HEADER,
  parseResourceMetadataUrl,
  protectedResourceMetadataUrls,
  toolsListRequest,
} from "@stigmer/outbound/mcp-oauth";

export { isOAuthChallenge, MCP_PROTOCOL_VERSION, parseResourceMetadataUrl };

/** The runner's probe timeout (`OAUTH_PROBE_TIMEOUT_MS` in `shared/mcp-oauth-detect.ts`); a measurement can afford the runner's patience. */
export const PROBE_TIMEOUT_MS = 10_000;
/** The pause before the one retry, and the most a `Retry-After` may ask for. */
export const RETRY_PAUSE_MS = 1_500;
export const RETRY_AFTER_CAP_MS = 30_000;
/** How much of a response body is kept as evidence. */
const BODY_SNIPPET_CHARS = 512;
/** Who is asking; some hosts refuse a request that does not say, and the handshake names it too. */
const CLIENT_NAME = "stigmer-catalogue-audit";
const USER_AGENT = `${CLIENT_NAME} (+https://github.com/stigmer/stigmer/tree/main/plugins)`;

/** The complete `initialize` this audit sends, named as the audit. */
export const INITIALIZE_REQUEST = initializeRequest(CLIENT_NAME);

/** One request the probe made and what came back; the report's raw evidence. */
export interface ProbeStep {
  readonly purpose: "initialize" | "tools-list" | "sse" | "resource-metadata" | "authorization-server-metadata";
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly status?: number;
  readonly wwwAuthenticate?: string;
  readonly contentType?: string;
  readonly bodySnippet?: string;
  readonly error?: string;
  /** Set on the request that was a retry of the one before it. */
  readonly retry?: true;
}

/** What the authorization server's metadata said, in the fields the rubric and Sign in read. */
export interface AuthorizationServerFacts {
  /** The document the facts were read from. */
  readonly metadataUrl: string;
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  /** Whether clients may register themselves (a `registration_endpoint`); without it Sign in needs a pre-registered app. */
  readonly dynamicRegistration: boolean;
  /** Whether the login server is on the MCP URL's origin; `other` needs RFC 9728 to be found. */
  readonly loginOrigin: "same" | "other";
  /** `true`/`false` when the server lists its PKCE methods; absent when it lists none. */
  readonly pkceS256?: boolean;
  readonly scopesSupported: readonly string[];
}

/** Which request drew a 401: the handshake itself, or the first look at tools after an open handshake. */
export type ChallengedAt = "initialize" | "tools/list";

/**
 * What the anonymous `tools/list` after an open handshake came to. `listed`
 * is the one case where a user could call a tool without signing in;
 * `refused` keeps the server's own JSON-RPC words (a session it does not
 * recognise, a protocol it does not speak); `not-asked` is the SSE arm,
 * which classifies from headers alone.
 */
export type ToolsListOutcome = { readonly kind: "listed"; readonly count: number } | { readonly kind: "refused"; readonly message: string } | { readonly kind: "not-asked" };

export type ProbeOutcome =
  /** The handshake completed without a credential, and `tools/list` did not ask for one either. */
  | { readonly kind: "open"; readonly status: number; readonly via: "post" | "sse"; readonly tools: ToolsListOutcome }
  /** The endpoint answered 2xx but refused the handshake with a JSON-RPC error; its own words are kept. */
  | { readonly kind: "handshake-rejected"; readonly status: number; readonly message: string }
  /** An OAuth challenge whose metadata resolved to a login server. */
  | {
      readonly kind: "oauth";
      readonly challengedAt: ChallengedAt;
      readonly challenge: string;
      readonly resourceMetadataUrl?: string;
      readonly authorizationServer: AuthorizationServerFacts;
    }
  /** An OAuth challenge (the user is told "requires OAuth") whose metadata could not be followed, so Sign in could not complete. */
  | { readonly kind: "oauth-unresolvable"; readonly challengedAt: ChallengedAt; readonly challenge: string; readonly resourceMetadataUrl?: string; readonly reason: string }
  /** A 401 the runner's rule does not call OAuth: a static-token API or a proxy asking for its own credential. */
  | { readonly kind: "challenge-not-oauth"; readonly challengedAt: ChallengedAt; readonly challenge: string }
  /** Every other HTTP answer, after the SSE arm and the retry. */
  | { readonly kind: "http-other"; readonly status: number; readonly via: "post" | "sse" }
  /** No HTTP answer after the retry. */
  | { readonly kind: "unreachable"; readonly error: string };

export interface ProbeResult {
  readonly url: string;
  readonly outcome: ProbeOutcome;
  readonly evidence: readonly ProbeStep[];
}

export interface ProbeDeps {
  readonly fetchImpl: typeof fetch;
  /** The wait before a retry; tests hand over one that returns at once. */
  readonly pause: (ms: number) => Promise<void>;
}

export const defaultProbeDeps: ProbeDeps = {
  fetchImpl: fetch,
  pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Probe one MCP endpoint. Never throws: a failure is an outcome. */
export async function probeEndpoint(url: string, deps: ProbeDeps = defaultProbeDeps): Promise<ProbeResult> {
  const evidence: ProbeStep[] = [];
  const request = new Requester(deps, evidence);

  const post = await request.withRetry("initialize", url, {
    method: INITIALIZE_REQUEST.method,
    headers: { ...INITIALIZE_REQUEST.headers },
    body: INITIALIZE_REQUEST.body,
  });
  if (post.kind === "error") return { url, outcome: { kind: "unreachable", error: post.error }, evidence };

  if (post.status >= 200 && post.status < 300) return { url, outcome: await classifyHandshake(url, post, request), evidence };
  if (post.status === 401) return { url, outcome: await classifyChallenge(url, "initialize", post.wwwAuthenticate, request), evidence };
  if (post.status >= 400 && post.status < 500) {
    const sse = await request.withRetry("sse", url, { method: "GET", headers: { Accept: "text/event-stream" } }, { headersOnly: true });
    if (sse.kind === "error") return { url, outcome: { kind: "http-other", status: post.status, via: "post" }, evidence };
    if (sse.status >= 200 && sse.status < 300 && sse.contentType.includes("text/event-stream")) {
      return { url, outcome: { kind: "open", status: sse.status, via: "sse", tools: { kind: "not-asked" } }, evidence };
    }
    if (sse.status === 401) return { url, outcome: await classifyChallenge(url, "initialize", sse.wwwAuthenticate, request), evidence };
    return { url, outcome: { kind: "http-other", status: sse.status, via: "sse" }, evidence };
  }
  return { url, outcome: { kind: "http-other", status: post.status, via: "post" }, evidence };
}

/**
 * A 2xx to `initialize` is read as JSON-RPC: the body itself, or the first
 * `data:` line when the server streams its answer. A `result` is an open
 * handshake, followed by the anonymous `tools/list` (with the session the
 * server handed back, when it did); an `error` is the server refusing the
 * handshake (its message kept); a body that is neither is not an MCP
 * answer at all.
 */
async function classifyHandshake(url: string, post: Extract<Answer, { kind: "response" }>, request: Requester): Promise<ProbeOutcome> {
  const answer = parseJsonRpc(post.body);
  if (answer === undefined) return { kind: "http-other", status: post.status, via: "post" };
  if ("error" in answer) return { kind: "handshake-rejected", status: post.status, message: errorMessage(answer["error"]) };

  const toolsRequest = toolsListRequest(undefined, post.sessionId);
  const tools = await request.withRetry("tools-list", url, { method: toolsRequest.method, headers: { ...toolsRequest.headers }, body: toolsRequest.body });
  if (tools.kind === "response" && tools.status === 401) return classifyChallenge(url, "tools/list", tools.wwwAuthenticate, request);
  return { kind: "open", status: post.status, via: "post", tools: toolsListOutcome(tools) };
}

function toolsListOutcome(answer: Answer): ToolsListOutcome {
  if (answer.kind === "error") return { kind: "refused", message: answer.error };
  const parsed = parseJsonRpc(answer.body);
  if (parsed === undefined) return { kind: "refused", message: `HTTP ${answer.status} with no JSON-RPC answer` };
  if ("error" in parsed) return { kind: "refused", message: errorMessage(parsed["error"]) };
  const result = parsed["result"];
  const list = isRecord(result) ? result["tools"] : undefined;
  return { kind: "listed", count: Array.isArray(list) ? list.length : 0 };
}

function errorMessage(error: unknown): string {
  return isRecord(error) && typeof error["message"] === "string" ? error["message"] : JSON.stringify(error);
}

/** The JSON-RPC object in a plain body or in the first `data:` line of an event stream. */
function parseJsonRpc(body: string): Record<string, unknown> | undefined {
  const text = body.trimStart().startsWith("{") ? body : (body.split(/\r?\n/).find((line) => line.startsWith("data:")) ?? "").slice("data:".length);
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && ("result" in parsed || "error" in parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function classifyChallenge(url: string, challengedAt: ChallengedAt, challenge: string, request: Requester): Promise<ProbeOutcome> {
  if (!isOAuthChallenge(challenge)) return { kind: "challenge-not-oauth", challengedAt, challenge };
  const resourceMetadataUrl = parseResourceMetadataUrl(challenge);
  const withPointer = resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl };

  const issuers = await resolveAuthorizationServers(url, resourceMetadataUrl, request);
  if (issuers.kind === "error") return { kind: "oauth-unresolvable", challengedAt, challenge, ...withPointer, reason: issuers.reason };

  for (const issuer of issuers.issuers) {
    const facts = await readAuthorizationServer(url, issuer, request);
    if (facts !== undefined) return { kind: "oauth", challengedAt, challenge, ...withPointer, authorizationServer: facts };
  }
  return {
    kind: "oauth-unresolvable",
    challengedAt,
    challenge,
    ...withPointer,
    reason: `no authorization server metadata at ${issuers.issuers.join(", ")}`,
  };
}

/**
 * The authorization servers protecting the MCP URL (RFC 9728), in the order
 * to try them: from the challenge's pointer, else the well-known document at
 * the MCP origin (path-suffixed, then bare), else the MCP origin itself,
 * which is what today's discovery assumes.
 */
async function resolveAuthorizationServers(
  mcpUrl: string,
  pointer: string | undefined,
  request: Requester,
): Promise<{ kind: "ok"; issuers: readonly string[] } | { kind: "error"; reason: string }> {
  const mcp = new URL(mcpUrl);
  const candidates = pointer !== undefined ? [pointer] : protectedResourceMetadataUrls(mcp);
  for (const candidate of candidates) {
    const response = await request.json("resource-metadata", candidate);
    if (response.kind !== "json") continue;
    const servers = readStringArray(response.value, "authorization_servers");
    if (servers.length > 0) return { kind: "ok", issuers: servers };
  }
  if (pointer !== undefined) return { kind: "error", reason: `resource metadata at ${pointer} names no authorization_servers` };
  return { kind: "ok", issuers: [mcp.origin] };
}


/**
 * RFC 8414 metadata for `issuer` (path-suffixed per its section 3, then at
 * the origin), then OpenID's document at either; the first with the two
 * endpoints Sign in needs.
 */
async function readAuthorizationServer(mcpUrl: string, issuer: string, request: Requester): Promise<AuthorizationServerFacts | undefined> {
  let parsed: URL;
  try {
    parsed = new URL(issuer);
  } catch {
    return undefined;
  }
  for (const metadataUrl of authorizationServerMetadataUrls(parsed)) {
    const response = await request.json("authorization-server-metadata", metadataUrl);
    if (response.kind !== "json" || !isRecord(response.value)) continue;
    const document = response.value;
    const authorizationEndpoint = readString(document, "authorization_endpoint");
    const tokenEndpoint = readString(document, "token_endpoint");
    if (authorizationEndpoint === "" || tokenEndpoint === "") continue;
    const methods = readStringArray(document, "code_challenge_methods_supported");
    return {
      metadataUrl,
      issuer: readString(document, "issuer"),
      authorizationEndpoint,
      tokenEndpoint,
      dynamicRegistration: readString(document, "registration_endpoint") !== "",
      loginOrigin: sameOrigin(authorizationEndpoint, mcpUrl) ? "same" : "other",
      ...(methods.length > 0 && { pkceS256: methods.includes("S256") }),
      scopesSupported: readStringArray(document, "scopes_supported"),
    };
  }
  return undefined;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

type Answer =
  | {
      readonly kind: "response";
      readonly status: number;
      readonly wwwAuthenticate: string;
      readonly contentType: string;
      readonly body: string;
      /** A `Retry-After` in seconds, when the server sent one as a number. */
      readonly retryAfterMs?: number;
      /** The `Mcp-Session-Id` a stateful server issued, to carry on the next request. */
      readonly sessionId?: string;
    }
  | { readonly kind: "error"; readonly error: string };

type JsonAnswer = { readonly kind: "json"; readonly value: unknown } | { readonly kind: "not-json" };

/** The requests the probe makes, each recorded as evidence as it happens. */
class Requester {
  constructor(
    private readonly deps: ProbeDeps,
    private readonly evidence: ProbeStep[],
  ) {}

  /** One request, retried once on a network failure, a 429 or a 5xx. */
  async withRetry(purpose: ProbeStep["purpose"], url: string, init: RequestInit & { method: "GET" | "POST" }, options: { headersOnly?: boolean } = {}): Promise<Answer> {
    const first = await this.once(purpose, url, init, options, false);
    if (!shouldRetry(first)) return first;
    await this.deps.pause(retryPause(first));
    return this.once(purpose, url, init, options, true);
  }

  /** A GET expecting JSON, retried like the others; a non-JSON or non-200 answer is `not-json`. */
  async json(purpose: ProbeStep["purpose"], url: string): Promise<JsonAnswer> {
    const answer = await this.withRetry(purpose, url, { method: "GET", headers: { Accept: "application/json" } });
    if (answer.kind !== "response" || answer.status !== 200) return { kind: "not-json" };
    try {
      return { kind: "json", value: JSON.parse(answer.body) as unknown };
    } catch {
      return { kind: "not-json" };
    }
  }

  private async once(purpose: ProbeStep["purpose"], url: string, init: RequestInit & { method: "GET" | "POST" }, options: { headersOnly?: boolean }, retry: boolean): Promise<Answer> {
    const step = { purpose, method: init.method, url, ...(retry && { retry: true as const }) };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await this.deps.fetchImpl(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), "User-Agent": USER_AGENT },
        redirect: "manual",
        signal: controller.signal,
      });
      const wwwAuthenticate = response.headers.get("www-authenticate") ?? "";
      const contentType = response.headers.get("content-type") ?? "";
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const sessionId = response.headers.get(MCP_SESSION_HEADER) ?? undefined;
      let body = "";
      if (options.headersOnly === true) {
        // An event stream never ends; the headers alone classify it.
        controller.abort();
      } else {
        body = await response.text().catch(() => "");
      }
      this.evidence.push({
        ...step,
        status: response.status,
        ...(wwwAuthenticate !== "" && { wwwAuthenticate }),
        ...(contentType !== "" && { contentType }),
        ...(body !== "" && { bodySnippet: body.slice(0, BODY_SNIPPET_CHARS) }),
      });
      return {
        kind: "response",
        status: response.status,
        wwwAuthenticate,
        contentType,
        body,
        ...(retryAfterMs !== undefined && { retryAfterMs }),
        ...(sessionId !== undefined && { sessionId }),
      };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      this.evidence.push({ ...step, error: message });
      return { kind: "error", error: message };
    } finally {
      clearTimeout(timer);
    }
  }
}

function shouldRetry(answer: Answer): boolean {
  return answer.kind === "error" || answer.status === 429 || answer.status >= 500;
}

/** The server's `Retry-After` when it gave one, capped; the fixed pause otherwise. */
function retryPause(answer: Answer): number {
  if (answer.kind === "response" && answer.retryAfterMs !== undefined) return Math.min(answer.retryAfterMs, RETRY_AFTER_CAP_MS);
  return RETRY_PAUSE_MS;
}

/** `Retry-After` as delay-seconds; the HTTP-date form is left to the fixed pause. */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (header === null || !/^\d+$/.test(header.trim())) return undefined;
  return Number(header.trim()) * 1_000;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readStringArray(value: unknown, key: string): readonly string[] {
  if (!isRecord(value)) return [];
  const list = value[key];
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
