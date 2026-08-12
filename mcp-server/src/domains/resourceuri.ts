// Parsing and construction of stigmer:// resource URIs.
// Go parity: mcp-server/internal/domains/resourceuri.go.
//
// A resource URI has the form stigmer://{authority}/{org}/{slug}[/{version}].
// The authority (e.g. "agents") is the URL host and encodes the kind; org/slug
// (and optional version) are the path segments. Parsing deliberately validates
// only the scheme and the path-segment count/shape — the authority is not
// checked here, exactly as the Go server behaves.

/** The org and slug extracted from a two-segment resource URI. */
export interface ResourceRef {
  readonly org: string;
  readonly slug: string;
}

/** A resource ref that may also carry an explicit version ("" means latest). */
export interface VersionedResourceRef extends ResourceRef {
  readonly version: string;
}

/**
 * Extract org and slug from a stigmer://{authority}/{org}/{slug} URI.
 * Throws when the scheme is not "stigmer" or the path is not exactly two
 * non-empty segments.
 */
export function parseResourceURI(uri: string): ResourceRef {
  const segments = pathSegments(uri);
  if (segments.length !== 2) {
    throw new Error(
      `expected URI path with 2 segments (org/slug), got ${segments.length} in "${uri}"`,
    );
  }
  const org = segments[0] ?? "";
  const slug = segments[1] ?? "";
  if (org === "" || slug === "") {
    throw new Error(`org and slug must be non-empty in "${uri}"`);
  }
  return { org, slug };
}

/**
 * Extract org, slug, and optional version from a resource URI. Two path
 * segments yield version "" (latest); three yield an explicit, non-empty
 * version. Any other shape throws.
 */
export function parseVersionedResourceURI(uri: string): VersionedResourceRef {
  const segments = pathSegments(uri);

  let org = "";
  let slug = "";
  let version = "";
  switch (segments.length) {
    case 2:
      org = segments[0] ?? "";
      slug = segments[1] ?? "";
      break;
    case 3:
      org = segments[0] ?? "";
      slug = segments[1] ?? "";
      version = segments[2] ?? "";
      if (version === "") {
        throw new Error(`version segment must be non-empty in "${uri}"`);
      }
      break;
    default:
      throw new Error(
        `expected URI path with 2 or 3 segments (org/slug[/version]), got ${segments.length} in "${uri}"`,
      );
  }

  if (org === "" || slug === "") {
    throw new Error(`org and slug must be non-empty in "${uri}"`);
  }
  return { org, slug, version };
}

/**
 * Map a singular kind name (as it appears in the ApiResourceKind proto enum) to
 * the plural authority used in stigmer:// URIs. Only kinds that have a
 * registered MCP resource template appear here.
 */
export const kindToAuthority: Readonly<Record<string, string>> = {
  agent: "agents",
  environment: "environments",
  mcp_server: "mcp-servers",
  skill: "skills",
  workflow: "workflows",
};

/**
 * Construct a stigmer:// URI from a kind, org, and slug — the inverse of
 * {@link parseResourceURI}. Returns "" when the kind has no registered template
 * or org/slug are empty, mirroring the Go server's enrichment fallback.
 */
export function buildResourceURI(kind: string, org: string, slug: string): string {
  const authority = kindToAuthority[kind];
  if (authority === undefined || org === "" || slug === "") {
    return "";
  }
  return `stigmer://${authority}/${org}/${slug}`;
}

/**
 * Parse the URI, assert the scheme, and return its path split into segments.
 * The double-slash authority (the kind) is intentionally discarded; only the
 * path carries org/slug[/version]. Interior empty segments are preserved so the
 * count matches Go's strings.Split semantics.
 */
function pathSegments(uri: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch (err) {
    throw new Error(`malformed resource URI "${uri}": ${err instanceof Error ? err.message : err}`);
  }

  if (parsed.protocol !== "stigmer:") {
    throw new Error(
      `unexpected URI scheme "${parsed.protocol.replace(/:$/, "")}", expected "stigmer"`,
    );
  }

  const trimmed = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? [] : trimmed.split("/");
}
