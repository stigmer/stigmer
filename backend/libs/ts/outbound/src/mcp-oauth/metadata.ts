/**
 * Finding an MCP endpoint's login server: the RFC 9728, RFC 8414 and
 * OpenID walk, as documents to try in order and the reader that tries them.
 *
 * Why a walk and not one URL. Of the 41 OAuth-protected MCP servers the
 * catalogue audit resolved on 2026-09-19, 21 keep their login server on a
 * different origin from the MCP URL, which only RFC 9728's protected
 * resource metadata can point at, and several issuers carry a path, which
 * RFC 8414 section 3 says to insert the well-known segment BEFORE (an
 * issuer `https://auth.example/tenant` describes itself at
 * `https://auth.example/.well-known/oauth-authorization-server/tenant`).
 * A reader that only asked the MCP origin for `oauth-authorization-server`
 * reached half of them.
 *
 * The order, from the most specific to the fallback that worked before:
 *
 *   1. The protected resource's own document: the `resource_metadata` URL
 *      a 401 challenge named, else `/.well-known/oauth-protected-resource`
 *      at the MCP origin with the MCP path appended, else bare
 *      (RFC 9728 section 3). It names `authorization_servers`.
 *   2. For each issuer named, its authorization-server metadata: RFC 8414
 *      with the issuer's path inserted, RFC 8414 at the origin, then
 *      OpenID's `/.well-known/openid-configuration` under the path and at
 *      the origin (RFC 8414 section 5 allows the OpenID document).
 *   3. When no protected-resource document exists, the MCP origin itself is
 *      the one issuer to try, which is exactly the reader this replaces.
 *
 * Every attempt is recorded (URL, status or error) so a caller can name the
 * document it failed on. The reader validates nothing beyond the two
 * endpoints a login needs; the control plane keeps its own pinned
 * validation and copy on top. Pure over an injected fetch, one deadline per
 * request.
 *
 * Proven by __tests__/metadata.test.ts.
 */
import type { OutboundFetch } from "../egress/fetch.js";

/** RFC 8414 metadata in the fields Sign in reads; snake_case on the wire, camelCase here. */
export interface AuthorizationServerMetadata {
  /** The document these facts were read from. */
  readonly metadataUrl: string;
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  /** Empty when the login server does not register clients dynamically (RFC 7591). */
  readonly registrationEndpoint: string;
  readonly scopesSupported: readonly string[];
  readonly codeChallengeMethodsSupported: readonly string[];
}

/** One GET the walk made and what came back. */
export interface MetadataAttempt {
  readonly url: string;
  readonly status?: number;
  readonly error?: string;
  /** Set when the document parsed but lacked the endpoint a login needs, so a caller can say which. */
  readonly missing?: "authorization_endpoint" | "token_endpoint";
}

export type MetadataRead =
  | { readonly kind: "found"; readonly metadata: AuthorizationServerMetadata; readonly attempts: readonly MetadataAttempt[] }
  | { readonly kind: "not-found"; readonly attempts: readonly MetadataAttempt[] };

export interface MetadataReadDeps {
  readonly fetchImpl: OutboundFetch;
  /** Per request. */
  readonly timeoutMs: number;
}

/** The RFC 9728 documents describing a resource, most specific first. */
export function protectedResourceMetadataUrls(resource: URL): readonly string[] {
  const bare = `${resource.origin}/.well-known/oauth-protected-resource`;
  const path = resource.pathname.replace(/\/+$/, "");
  return path === "" ? [bare] : [`${bare}${path}`, bare];
}

/** The documents describing an issuer, RFC 8414 (path inserted, then origin) then OpenID (path, then origin). */
export function authorizationServerMetadataUrls(issuer: URL): readonly string[] {
  const path = issuer.pathname.replace(/\/+$/, "");
  const urls = [
    ...(path === "" ? [] : [`${issuer.origin}/.well-known/oauth-authorization-server${path}`]),
    `${issuer.origin}/.well-known/oauth-authorization-server`,
    ...(path === "" ? [] : [`${issuer.origin}${path}/.well-known/openid-configuration`]),
    `${issuer.origin}/.well-known/openid-configuration`,
  ];
  return [...new Set(urls)];
}

/**
 * The issuers protecting a resource, from its RFC 9728 document (the
 * challenge's pointer when the caller has one, else the well-known
 * documents at the resource). Empty when no document names any; the caller
 * decides what that means (the control plane falls back to the origin).
 */
export async function resolveAuthorizationServers(
  resourceUrl: string,
  pointer: string | undefined,
  deps: MetadataReadDeps,
): Promise<{ readonly issuers: readonly string[]; readonly attempts: readonly MetadataAttempt[] }> {
  const attempts: MetadataAttempt[] = [];
  const candidates = pointer !== undefined ? [pointer] : protectedResourceMetadataUrls(new URL(resourceUrl));
  for (const candidate of candidates) {
    const read = await readJson(candidate, deps, attempts);
    if (read === undefined) continue;
    const issuers = readStringArray(read, "authorization_servers");
    if (issuers.length > 0) return { issuers, attempts };
  }
  return { issuers: [], attempts };
}

/** The first document for `issuer` that names an authorization and a token endpoint. */
export async function readAuthorizationServerMetadata(issuer: string, deps: MetadataReadDeps): Promise<MetadataRead> {
  const attempts: MetadataAttempt[] = [];
  let parsed: URL;
  try {
    parsed = new URL(issuer);
  } catch {
    return { kind: "not-found", attempts };
  }
  for (const metadataUrl of authorizationServerMetadataUrls(parsed)) {
    const document = await readJson(metadataUrl, deps, attempts);
    if (document === undefined) continue;
    const authorizationEndpoint = readString(document, "authorization_endpoint");
    const tokenEndpoint = readString(document, "token_endpoint");
    if (authorizationEndpoint === "" || tokenEndpoint === "") {
      const last = attempts.pop();
      if (last !== undefined) attempts.push({ ...last, missing: authorizationEndpoint === "" ? "authorization_endpoint" : "token_endpoint" });
      continue;
    }
    return {
      kind: "found",
      attempts,
      metadata: {
        metadataUrl,
        issuer: readString(document, "issuer"),
        authorizationEndpoint,
        tokenEndpoint,
        registrationEndpoint: readString(document, "registration_endpoint"),
        scopesSupported: readStringArray(document, "scopes_supported"),
        codeChallengeMethodsSupported: readStringArray(document, "code_challenge_methods_supported"),
      },
    };
  }
  return { kind: "not-found", attempts };
}

/** A GET expecting a JSON object; anything else is recorded and read as absent. */
async function readJson(url: string, deps: MetadataReadDeps, attempts: MetadataAttempt[]): Promise<Record<string, unknown> | undefined> {
  let response: Response;
  try {
    response = await deps.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
  } catch (error) {
    attempts.push({ url, error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
  attempts.push({ url, status: response.status });
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  try {
    const parsed: unknown = await response.json();
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readStringArray(record: Record<string, unknown>, key: string): readonly string[] {
  const list = record[key];
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
