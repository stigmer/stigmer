# MCP Server: Versioned Skill Resource Template

**Date**: February 19, 2026

## Summary

Added a `stigmer://skills/{org}/{slug}/{version}` resource template to the MCP server, enabling MCP clients to read a specific version of a skill directly by URI. Previously, the resource layer only exposed the latest version; version-pinned reads required calling the `get_skill` tool with an explicit `version` argument. Now both access patterns are available and consistent.

## Problem Statement

The `get_skill` tool has supported versioned reads since T02 — a caller can supply a tag name (e.g. `"stable"`) or SHA-256 content hash to retrieve a specific immutable version. The `skills.Fetch()` function already passes the version field through to `ApiResourceReference`. However, the MCP resource layer (`stigmer://skills/{org}/{slug}`) only ever resolved to the latest version. There was no URI that a client could cache, share, or pin to a specific version.

### Pain Points

- No stable, cacheable URI for a pinned skill version — every read would silently advance to "latest"
- Inconsistency between the tool interface (supports version) and the resource interface (ignores version)
- No URI-level mechanism for immutable references (SHA-256 hashes), which are the strongest reproducibility guarantee the platform offers
- `ListResourceTemplates` advertised only one skill template, giving clients no signal that versioned access was possible

## Solution

Two MCP resource templates are now registered for skills:

| Template | Resolves to |
|----------|-------------|
| `stigmer://skills/{org}/{slug}` | Latest version (unchanged) |
| `stigmer://skills/{org}/{slug}/{version}` | Specific version (tag or SHA-256) |

The existing template and its handler are untouched. The versioned template uses a new `ParseVersionedResourceURI` function that accepts 2 or 3 URI path segments, enabling the same function to serve agents and workflows when they gain versioning later.

## Implementation Details

### New: `ParseVersionedResourceURI` in `uriutil.go`

```go
// ParseVersionedResourceURI extracts the org, slug, and optional version
// segments from a Stigmer resource URI. It accepts two forms:
//
//   stigmer://{kind}/{org}/{slug}            → version=""
//   stigmer://{kind}/{org}/{slug}/{version}  → version="stable", "v1.0", sha256, etc.
func ParseVersionedResourceURI(uri string) (org, slug, version string, err error)
```

Key properties:
- 2 path segments → `version=""` (latest semantics, consistent with backend)
- 3 path segments → version extracted and validated non-empty
- 4+ segments → error (no accidental forward-compatibility)
- Existing `ParseResourceURI` (2 segments, strict) left completely untouched

URI anatomy note worth preserving: in `stigmer://skills/acme/slug/stable`, Go's `url.Parse` yields `Host="skills"` (the kind, in the authority component) and `Path="/acme/slug/stable"` (3 path segments). Kind is never in the path.

### New: `VersionedTemplate()` and `VersionedResourceHandler()` in `skills/resources.go`

`VersionedTemplate()` registers `stigmer://skills/{org}/{slug}/{version}` with name `stigmer_skill_version`. The handler calls `ParseVersionedResourceURI`, then delegates to the existing `Fetch(ctx, serverAddress, org, slug, version)` — no new gRPC logic, no new connection plumbing.

### Registration in `server.go`

```go
srv.AddResourceTemplate(skills.Template(), skills.ResourceHandler(serverAddress))
srv.AddResourceTemplate(skills.VersionedTemplate(), skills.VersionedResourceHandler(serverAddress))
```

Both templates are registered in order. The MCP SDK routes by URI template match, and the two templates are structurally distinct (2 vs 3 path segments), so routing is unambiguous.

### Test Coverage

| Test | What it validates |
|------|-----------------|
| `TestParseVersionedResourceURI` | 14 table-driven cases: tag, SHA-256, semver-style tag, cross-domain URIs, trailing slashes, error paths |
| `TestVersionedTemplate_metadata` | Template name, URI template, MIME type; also asserts name differs from latest template |
| `TestVersionedResourceHandler_success` | Version `"stable"` extracted from URI, forwarded verbatim to gRPC `ApiResourceReference.Version` |
| `TestVersionedResourceHandler_latestFallback` | 2-segment URI routed through versioned handler still works: `version=""` |
| `TestVersionedResourceHandler_malformedURI` | 1-segment URI returns error |
| `TestVersionedResourceHandler_grpcNotFound` | Tag not found → clean user-facing error via `domains.RPCError` |

All 11 packages pass under `-race`; `go vet` clean.

## Benefits

- **Reproducibility**: SHA-256 URIs are immutable references — the same URI always returns the same content as long as the artifact exists
- **Shareability**: Clients (Cursor, Claude Desktop, CI pipelines) can exchange pinned URIs without ambiguity about which version is meant
- **Consistency**: Resource interface now mirrors the tool interface — both support version-pinned reads
- **Forward compatibility**: `ParseVersionedResourceURI` is already structured to serve agents and workflows when they add versioning; no new plumbing needed at that point
- **Zero regression**: All existing code paths are untouched; 100% of prior tests still pass

## Impact

- **MCP clients**: Cursor, Claude Desktop, and any RFC-compliant MCP client can now issue `ReadResource` requests against `stigmer://skills/acme/my-skill/stable` and receive a deterministic response
- **Platform reliability**: Pinned SHA-256 URIs enable reproducible agent execution traces — an agent referencing a specific skill version will always load the same artifact
- **Developer experience**: IDE users browsing `ListResourceTemplates` now see both templates, making the versioning capability discoverable without reading documentation

## Related Work

- T02 (get_skill tool with version parameter) — the Fetch() foundation this builds on
- T07 (config bridging) — the session immediately prior; auth layer that makes all resource reads work zero-config
- T09 (future) — will extend `ParseVersionedResourceURI` to agents and workflows, or add write operations

---

**Status**: ✅ Production Ready
**Timeline**: T08, Session 7, ~1 hour
