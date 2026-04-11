# Notes: 20260411.01.mcp-oauth-managed-credentials

**Created**: 2026-04-11

## Purpose

Use this file to capture important information as you work:

- Decisions: Why you chose approach A over B
- Gotchas: Issues discovered and how you solved them
- Learnings: Insights that might help later
- Commands: Useful commands or snippets
- References: Links to docs, Stack Overflow, etc.

---

## 2026-04-11 — Planning Session

### Key Architectural Decisions

**1:1 OAuthGrant-to-Environment**: Each OAuth grant owns exactly one managed environment. This gives zero-collision isolation and clean lifecycle (revoke grant = delete its env).

**Per-(user, org, mcp_server) granularity chosen over per-(user, org)**: Even though per-(user, org) is simpler, the 1:1 mapping with OAuthGrant eliminates any env var naming collisions between MCP servers and makes the grant-to-environment relationship unambiguous.

**Strict mutation protection**: Handler-level guard rejects user mutations on managed environments. OAuth flows use direct repo access (not gRPC OBO), which is a documented boundary exception analogous to the existing OAuthAppRepo exception.

**`getOAuthGrantStatus` RPC instead of env-var-presence detection**: The frontend should never have been checking personal environment key presence to infer OAuth status. The new RPC is architecturally cleaner and provides richer information (expiry timestamp).

### Go/Java Asymmetry Discovery

The Go `CreateExecutionContextStep` does NOT have `injectMcpEnvFromPersonalEnvironment` — only the Java version does. In OSS Go, MCP OAuth tokens must come through `environment_refs` or `runtime_env`. The new `injectMcpOAuthFromManagedEnvironment` fills this gap for Go.

### FGA Critical Path

`ManagedEnvironmentService.createManagedEnvironment` MUST create FGA authorization tuples when creating the environment document. Without this, the managed environment is invisible to FGA-gated queries. Follow the pattern in `U20260411_SeedVendorOAuthApps.java` where FGA tuples are created alongside the document.

### Session Execution Refresh

The execution pipeline (CreateExecutionContextStep) has no separate RefreshOAuthToken step (unlike the connect pipeline). The new `injectMcpOAuthFromManagedEnvironment` must check token expiry and refresh inline to handle the case where a user starts a session without a recent connect.

---

## 2026-04-11 — T01 Implementation Session

### Generalization Decision: resource_id over mcp_server_id

User proposed making OAuthGrant resource-agnostic. After analysis, agreed this is the right call: the grant record IS conceptually resource-agnostic (user X authorized service Y, tokens in env Z). The MCP-specific parts are the flows (initiate/complete), not the data model.

Added `resource_kind` as a non-key attribute. Discussed whether to use `ApiResourceReference` (org + kind + slug) instead of `resource_id` + `org_id`, but rejected — all code paths have the system ID at hand, slug-based lookups would add unnecessary indirection, and the grant is an infrastructure record (not user-facing YAML).

### GetOAuthGrantStatusInput uses resource_id

User caught that the initial plan had `mcp_server_id` in the input. Updated to `resource_id` for consistency with the generalized model. The `resource_kind = mcp_server` on the RPC option handles authorization resolution.

### Build Commands

- stigmer repo: `make codegen` (not `make build`) for proto stub regeneration
- stigmer-cloud repo: `make protos` for proto stub regeneration
- stigmer-cloud Java compilation: `bazel build //backend/services/stigmer-service/...`

### PendingOAuthState NOT renamed

The `PendingOAuthState` (Go struct + Java document) keeps `McpServerID`. This is correct — the pending state is transient and inherently MCP-specific (it's the state between initiateOAuthConnect and completeOAuthConnect, which are MCP-scoped RPCs).

### Duplicate org variable gotcha

Both `connect.go` (Go) and `OAuthTokenRefreshService.java` had a pattern where `org` was extracted from `mcpServer.getMetadata().getOrg()` AFTER the grant lookup. When we moved `org` extraction BEFORE the lookup (to pass it to `Find`), we had to remove the duplicate declaration lower down. Easy to miss.

---

*Add your timestamped notes below as you work*

---
