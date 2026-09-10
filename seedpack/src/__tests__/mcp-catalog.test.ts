// Marketplace curation policies for the MCP server catalog (`mcp-servers/*.yaml`).
//
// These are the rules the proto contract cannot express: what makes an entry
// a good marketplace citizen, not what makes it a valid `McpServer`. The
// contract half is `make check-docs-yaml`'s (every seedpack manifest decodes
// against the schema with protovalidate, on every PR); this suite starts where
// that gate stops. Every test reads the catalog through `support/mcp-catalog`,
// the one loader, so the field names here are the generated message's.
//
// Replaces `seedpack/mcp_servers_test.go`. One Go test is deliberately not
// carried: `TestMcpServers_OAuthEndpointAudit` logged warnings and asserted
// nothing (a hosted `https://mcp.<vendor>.<tld>/` endpoint with no auth block
// "likely needs OAuth"). A test that cannot fail is not a test; the intent —
// look twice at a hosted endpoint without auth — lives in
// `mcp-servers/CONTRIBUTING.md`'s review checklist, where a reviewer reads it.
//
// Policies that filter the catalog (OAuth-managed HTTP servers, servers with
// an auth block, servers with placeholders) first assert the filtered set is
// non-empty, so a catalog reshaping cannot turn a policy green by starving it.

import type {
  HttpServerConfig,
  McpServerAuth,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { describe, expect, it } from "vitest";
import {
  canaryManifestSlugs,
  loadMcpCatalog,
  placeholdersIn,
  type CatalogEntry,
} from "./support/mcp-catalog.js";

const catalog = loadMcpCatalog();
const bySlug = new Map(catalog.map((e) => [e.slug, e]));

/** Kept in sync with the Categories table in `mcp-servers/CONTRIBUTING.md`. */
const VALID_CATEGORIES = new Set([
  "developer-tools",
  "databases",
  "search",
  "cloud-infrastructure",
  "communication",
  "productivity",
  "monitoring",
  "payments",
  "design",
  "crm-support",
]);

const isSystemServer = (e: CatalogEntry): boolean =>
  e.server.metadata.labels["stigmer.ai/system"] === "true";

// Type guards, so a policy over "HTTP servers" or "servers with auth" reads the
// narrowed field without a non-null assertion at every use.
type HttpEntry = CatalogEntry & {
  readonly server: {
    readonly spec: {
      readonly serverType: {
        readonly case: "http";
        readonly value: HttpServerConfig;
      };
    };
  };
};
type AuthEntry = CatalogEntry & {
  readonly server: { readonly spec: { readonly auth: McpServerAuth } };
};
const isHttp = (e: CatalogEntry): e is HttpEntry =>
  e.server.spec.serverType.case === "http";
const hasAuth = (e: CatalogEntry): e is AuthEntry =>
  e.server.spec.auth !== undefined;

/** `[slug, entry]` pairs for `it.each`, so every arm is named by its manifest; keeps the guards' narrowing. */
const named = <E extends CatalogEntry>(entries: E[]): [string, E][] =>
  entries.map((e) => [e.slug, e]);

describe("catalog envelope", () => {
  it("has entries", () => {
    expect(catalog.length).toBeGreaterThan(0);
  });

  it.each(named(catalog))(
    "%s: is an agentic.stigmer.ai/v1 McpServer",
    (_slug, e) => {
      expect(e.server.apiVersion).toBe("agentic.stigmer.ai/v1");
      expect(e.server.kind).toBe("McpServer");
    },
  );
});

describe("required fields", () => {
  it.each(named(catalog))(
    "%s: names, describes, tags and declares exactly one transport",
    (_slug, e) => {
      const { metadata, spec } = e.server;
      expect(metadata.name, "metadata.name").toBeTruthy();
      expect(metadata.visibility, "metadata.visibility").not.toBe(
        ApiResourceVisibility.api_resource_visibility_unspecified,
      );
      expect(spec.description, "spec.description").toBeTruthy();
      expect(
        spec.tags.length + metadata.tags.length,
        "spec.tags (or metadata.tags)",
      ).toBeGreaterThan(0);

      // fromJson already refuses two members of the oneof; the contract's
      // `required` is protovalidate's. Assert the one thing left: it is set.
      const transport = spec.serverType;
      expect(
        transport.case,
        "exactly one of spec.stdio / spec.http",
      ).toBeDefined();
      if (transport.case === "stdio")
        expect(transport.value.command, "spec.stdio.command").toBeTruthy();
      if (transport.case === "http")
        expect(transport.value.url, "spec.http.url").toBeTruthy();
    },
  );
});

describe("category label", () => {
  const marketplace = catalog.filter((e) => !isSystemServer(e));

  it("covers marketplace servers (system servers use stigmer.ai/system instead)", () => {
    expect(marketplace.length).toBeGreaterThan(0);
  });

  it.each(named(marketplace))(
    "%s: carries a stigmer.ai/category from the CONTRIBUTING table",
    (_slug, e) => {
      const category = e.server.metadata.labels["stigmer.ai/category"];
      expect(category, "missing label stigmer.ai/category").toBeDefined();
      expect(
        VALID_CATEGORIES.has(category ?? ""),
        `category "${category}" is not in the allowed set`,
      ).toBe(true);
    },
  );
});

describe("auth consistency", () => {
  const withAuth = catalog.filter(hasAuth);

  it("covers servers that declare an auth block", () => {
    expect(withAuth.length).toBeGreaterThan(0);
  });

  it.each(named(withAuth))(
    "%s: auth.target_env_var is declared in spec.env",
    (_slug, e) => {
      const { auth } = e.server.spec;
      if (auth.targetEnvVar === "") return;
      expect(
        Object.keys(e.server.spec.env),
        `auth.target_env_var "${auth.targetEnvVar}"`,
      ).toContain(auth.targetEnvVar);
    },
  );

  // DCR OAuth (no vendor OAuthApp, no explicit discovery URL) derives its
  // .well-known discovery from http.url, so it has no meaning over stdio.
  it.each(named(withAuth))(
    "%s: DCR OAuth without discovery_url requires the HTTP transport",
    (_slug, e) => {
      const { auth } = e.server.spec;
      const isDcrWithoutDiscovery =
        auth.oauthAppRef === undefined &&
        auth.discoveryUrl === "" &&
        auth.targetEnvVar !== "";
      if (!isDcrWithoutDiscovery) return;
      expect(
        isHttp(e),
        "DCR OAuth (no oauth_app_ref, no discovery_url) requires spec.http for .well-known discovery",
      ).toBe(true);
    },
  );
});

describe("OAuth token on the wire", () => {
  // Scope is the exact OAuth-managed HTTP set: spec.http AND spec.auth. Stdio
  // servers pass the token as an env var, not a header; static-key HTTP
  // servers with no auth block are not Stigmer-managed and legitimately use
  // other schemes (pagerduty `Authorization: Token ...`, context7 a custom
  // header). The env var name comes from auth.target_env_var because names
  // vary (`neon` uses NEON_API_KEY, not *_ACCESS_TOKEN).
  const isOauthHttp = (e: CatalogEntry): e is HttpEntry & AuthEntry =>
    isHttp(e) && hasAuth(e);
  const oauthHttp = catalog.filter(isOauthHttp);

  it("covers OAuth-managed HTTP servers", () => {
    expect(oauthHttp.length).toBeGreaterThan(0);
  });

  // The MCP Authorization spec mandates `Authorization: Bearer <token>`. A
  // custom, env-var-named header is the stdio convention: it works when the
  // token is a subprocess env var and silently fails against a remote OAuth
  // endpoint, which ignores the unknown header and rejects the session with an
  // opaque transport error (stigmer/stigmer#147).
  it.each(named(oauthHttp))(
    "%s: presents the token as Authorization: Bearer ${target_env_var} (#147)",
    (_slug, e) => {
      const target = e.server.spec.auth.targetEnvVar;
      // An empty target_env_var is auth consistency's finding; keep this message specific.
      if (target === "") return;
      const want = `Bearer \${${target}}`;
      expect(
        e.server.spec.serverType.value.headers["Authorization"],
        `OAuth-managed HTTP server must send the token via an Authorization header; set headers.Authorization: "${want}"`,
      ).toBe(want);
    },
  );
});

describe("placeholders", () => {
  const placeholderSites = (e: CatalogEntry): [string, string][] => {
    const t = e.server.spec.serverType;
    if (t.case === "http") {
      return [
        ...Object.entries(t.value.headers).map(([k, v]): [string, string] => [
          `http.headers[${k}]`,
          v,
        ]),
        ...Object.entries(t.value.queryParams).map(
          ([k, v]): [string, string] => [`http.query_params[${k}]`, v],
        ),
      ];
    }
    if (t.case === "stdio")
      return t.value.args.map((a, i): [string, string] => [
        `stdio.args[${i}]`,
        a,
      ]);
    return [];
  };

  it("appear somewhere in the catalog (the policy below is not vacuous)", () => {
    expect(
      catalog.some((e) =>
        placeholderSites(e).some(([, v]) => placeholdersIn(v).length > 0),
      ),
    ).toBe(true);
  });

  it.each(named(catalog))(
    "%s: every ${VAR} placeholder names a declared spec.env entry",
    (_slug, e) => {
      const declared = new Set(Object.keys(e.server.spec.env));
      const undeclared = placeholderSites(e).flatMap(([site, value]) =>
        placeholdersIn(value)
          .filter((v) => !declared.has(v))
          .map((v) => `${site}: \${${v}}`),
      );
      expect(
        undeclared,
        "placeholders referencing undeclared env vars",
      ).toEqual([]);
    },
  );
});

describe("catalog-wide invariants", () => {
  it("metadata.name is unique across the catalog", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const e of catalog) {
      const name = e.server.metadata.name ?? "";
      if (name === "") continue;
      const prior = seen.get(name);
      if (prior !== undefined)
        duplicates.push(`"${name}" in both ${prior} and ${e.path}`);
      seen.set(name, e.path);
    }
    expect(duplicates).toEqual([]);
  });

  // The canary manifest (seedpack/canary/credential-manifest.yaml) tracks a
  // credential state for every marketplace server: provisioned, pending, or
  // not_required. Both directions matter — a server without an entry has no
  // canary story; an entry without a server is a stale line nobody will clean.
  it("the canary credential manifest and the catalog agree both ways", () => {
    const manifest = canaryManifestSlugs();
    const slugs = catalog.map((e) => e.slug);
    expect(
      slugs.filter((s) => !manifest.includes(s)),
      "servers with no credential-manifest entry",
    ).toEqual([]);
    expect(
      manifest.filter((s) => !bySlug.has(s)),
      "credential-manifest entries with no server manifest",
    ).toEqual([]);
  });
});

describe("oauth_only", () => {
  // Endpoints verified to reject manually-entered static tokens. Without the
  // flag the connect UI offers a dead-end "enter token manually" path
  // (stigmer/stigmer#148). canva verified 2026-08-11 (oss#235): a dummy bearer
  // gets a 401 OAuth challenge from mcp.canva.com; there is no manual path.
  // Extend as the remaining dcr_oauth servers are rolled out.
  const OAUTH_ONLY_SLUGS = ["notion", "monday", "canva"];

  it.each(OAUTH_ONLY_SLUGS)(
    "%s: declares auth.oauth_only with a target_env_var (#148)",
    (slug) => {
      const e = bySlug.get(slug);
      if (e === undefined)
        expect.fail(`expected the catalog to contain ${slug}`);
      const { auth } = e.server.spec;
      if (auth === undefined) expect.fail(`${slug} must declare an auth block`);
      expect(
        auth.oauthOnly,
        `${slug} must set auth.oauth_only=true — its endpoint rejects manual tokens`,
      ).toBe(true);
      expect(
        auth.targetEnvVar,
        `${slug} oauth_only server must still declare auth.target_env_var`,
      ).not.toBe("");
    },
  );
});

describe("retired endpoints", () => {
  // A cited denylist, not a blanket no-/sse rule, on purpose: some vendors
  // (square) still document /sse as their ONLY endpoint, so a blanket rule
  // would force an unverifiable guess. A retired endpoint fails connect with
  // an opaque transport error (stigmer/stigmer#238); a deprecated one relies on
  // the legacy HTTP+SSE transport our clients do not speak natively — the
  // fragile path stigmer/stigmer#231 documents. Add an entry only with a
  // vendor source confirming the replacement.
  const RETIRED: Record<string, string> = {
    // Webflow changelog 2025-12-09: /sse retired in the SSE -> streamable HTTP migration.
    "https://mcp.webflow.com/sse":
      "retired; use https://mcp.webflow.com/mcp (Webflow changelog 2025-12-09, stigmer/stigmer#238)",
    // Intercom MCP docs: /mcp is "Recommended", /sse is "Legacy SSE (deprecated)".
    "https://mcp.intercom.com/sse":
      "deprecated; use https://mcp.intercom.com/mcp (Intercom MCP docs)",
    // PayPal's quickstart is stale; the live server (probed 2026-08-11) answers
    // a spec-correct OAuth 401 on /mcp and 404 on /http; /sse is the legacy
    // transport our clients cannot use (stigmer/stigmer#231).
    "https://mcp.paypal.com/sse":
      "legacy; use https://mcp.paypal.com/mcp (live probe 2026-08-11 + MCP registries, stigmer/stigmer#231)",
  };

  it.each(named(catalog.filter(isHttp)))(
    "%s: does not point at a retired or deprecated endpoint",
    (_slug, e) => {
      const { url } = e.server.spec.serverType.value;
      const reason = RETIRED[url];
      expect(reason, `${url} — ${reason ?? ""}`).toBeUndefined();
    },
  );
});
