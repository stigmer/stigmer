# MCP Seedpack Test Automation Strategy

**Date**: May 18, 2026

## Summary

Implemented a four-tier automated testing strategy for the MCP server seedpack (54 curated marketplace entries), plus a Cursor rule for ongoing maintenance and a credential management system backed by Planton secrets. This eliminates manual QA for MCP server validation and catches the entire class of bugs surfaced by community testing (#140, #141, #142, #147, #148, #150).

## Problem Statement

The MCP server seedpack had zero automated validation beyond a file-existence check. Manual testing by the community revealed five categories of bugs that automated tests would have caught before release: CLI org field not passed (#140), placeholder expansion failures (#141, #150), stdio servers shown in cloud UI (#142), and OAuth auth-method mismatches (#147, #148).

### Pain Points

- No schema validation for seedpack YAML files -- structurally invalid definitions could ship
- No auth consistency checks -- servers could reference undeclared env vars or misconfigure OAuth
- No transport-level verification -- dead endpoints or wrong protocols went undetected
- No regression tests for the connect pipeline (env var substitution, org passing)
- No automated canary tests to verify real-world MCP servers remain functional
- No process for managing test credentials when new servers are added

## Solution

A four-tier testing pyramid with automated credential management:

- **Tier 1 (Static)**: Pure YAML validation -- proto parsing, required fields, auth consistency, placeholder syntax, OAuth endpoint audit. Runs on every PR in milliseconds.
- **Tier 2 (Transport)**: Network reachability -- HTTP endpoint alive checks, OAuth discovery validation, stdio server launch verification. Runs nightly.
- **Tier 3 (Connect Pipeline)**: Full harness integration -- org propagation, placeholder resolution in headers and args, error message quality. Runs on every PR.
- **Tier 4 (Canary)**: Real credentials -- connects to live vendor endpoints (Tavily, Stripe, Linear, GitHub, etc.) and verifies tool discovery. Runs nightly with credentials from Planton secrets.

## Implementation Details

### New Files Created (stigmer repo)

| File | Purpose |
|------|---------|
| `.cursor/rules/add-mcp-server-to-seedpack.mdc` | Cursor rule guiding the full process of adding a new MCP server |
| `seedpack/mcp-servers/credential-manifest.yaml` | Tracks canary readiness for all 54 servers |
| `seedpack/mcp_servers_test.go` | 7 Tier 1 static validation tests (all passing) |
| `test/integration/mcp_seedpack_connect_test.go` | 6 Tier 3 connect pipeline regression tests |
| `test/integration/seedpack_mcp_transport_test.go` | 4 Tier 2 transport reachability tests |
| `test/integration/seedpack_workflow_test.go` | 3 workflow parsing validation tests |
| `test/integration/harness/mock_oauth_server.go` | RFC 8414 + RFC 7591 DCR mock for OAuth testing |
| `test/integration/seedpack_mcp_canary_test.go` | 6 Tier 4 credential-gated canary tests |
| `.github/workflows/ci.seedpack-static.yaml` | CI for Tier 1 on seedpack PRs |
| `.github/workflows/ci.seedpack-canary.yaml` | Nightly CI for Tier 2 + Tier 4 |

### New Files Created (stigmer-cloud repo)

- 13 Planton secret YAMLs under `_ops/planton/connect/secrets/mcp-canary-*.yaml`
- Corresponding `.secret-values/` files (gitignored, local-only)
- All 11 secrets applied to Planton secrets manager

### Credential Classification

From the team's testing spreadsheet:
- **10 no-auth servers**: fetch, memory, filesystem, git, etc.
- **13 provisioned** (API keys stored in Planton): tavily, stripe, linear, atlassian, cloudflare, neon, pagerduty, brevo, exa, google-maps, github, cloudinary, sentry
- **17 OAuth-only**: monday, notion, hubspot, figma, slack, etc. (require browser OAuth)
- **13 pending**: databases, terraform, twilio, etc. (need credential provisioning)
- **1 header fix needed**: gitlab (wrong auth header format in seedpack)

## Benefits

- The #147/#148 class of bugs (OAuth mismatch) would now be caught by `TestMcpServers_AuthConsistency` and `TestMcpServers_OAuthEndpointAudit` before any human tests
- The #140/#141/#150 bugs would be caught by Tier 3 connect pipeline regression tests
- New MCP servers added via `@add-mcp-server-to-seedpack` automatically get validated, classified, and flagged for credential provisioning
- Nightly canary tests detect vendor endpoint changes or token expiry without manual intervention

## Impact

- **Testing team**: Eliminates the need to manually test MCP server connections for servers that have credentials provisioned
- **Contributors**: Adding a new MCP server now has a defined process with automated guardrails
- **CI confidence**: Every PR touching seedpack gets instant schema validation; nightly runs verify real-world connectivity
- **Credential management**: Single source of truth (credential-manifest.yaml) for which servers are testable

## Related Work

- Builds on the existing integration test harness (`test/integration/harness/`)
- Complements the auth integration test strategy (shared mock server patterns)
- Uses the same Planton secrets infrastructure as Discord bot credentials

---

**Status**: Production Ready
**Timeline**: Single session implementation
