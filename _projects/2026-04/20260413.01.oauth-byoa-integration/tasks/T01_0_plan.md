# Task T01: Proto Layer — New Messages, RPCs, and Enums

**Created**: 2026-04-13 11:03
**Status**: PENDING REVIEW
**Repo**: stigmer
**Estimated scope**: ~15-20 files (proto definitions + regenerated stubs)

## Objective

Define all new proto types, modify existing messages, and regenerate stubs to support the BYOA resolution chain, disconnect flow, and connection health reporting. This is the foundational task — everything downstream depends on it.

## Context

This task delivers the contract layer for the entire project. All 6 subsequent tasks consume these proto definitions. Proto changes are done in one shot to avoid regenerating stubs multiple times.

### Architecture Reference

The full architecture plan with gap analysis is documented in:
- Plan file: `~/.cursor/plans/oauth_byoa_architecture_6d4d6d67.plan.md`
- This conversation's architect analysis (10 gaps identified, resolution chain designed)

## Deliverables

### 1. New message: `OAuthAppOverride` in `apis/ai/stigmer/agentic/mcpserver/v1/oauth.proto`

Internal document (same pattern as `OAuthGrant`). Composite key: `(resource_id, resource_kind, org_id)`.

```protobuf
message OAuthAppOverride {
  string resource_id = 1;
  string resource_kind = 2;
  string org_id = 3;
  string oauth_app_id = 4;
}
```

### 2. New enums

**`OAuthAppSource`** — where the effective OAuth app came from (query-time enrichment):
```protobuf
enum OAuthAppSource {
  OAUTH_APP_SOURCE_UNSPECIFIED = 0;
  OAUTH_APP_SOURCE_PLATFORM = 1;
  OAUTH_APP_SOURCE_ORG_OVERRIDE = 2;
  OAUTH_APP_SOURCE_NONE = 3;
}
```

**`OAuthConnectionHealth`** — token health evaluation:
```protobuf
enum OAuthConnectionHealth {
  OAUTH_CONNECTION_HEALTH_UNSPECIFIED = 0;
  OAUTH_CONNECTION_HEALTH_HEALTHY = 1;
  OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED = 2;
  OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE = 3;
  OAUTH_CONNECTION_HEALTH_NO_GRANT = 4;
}
```

### 3. Modify `McpServerAuth` in `spec.proto`

Add two read-only, query-time-enriched fields:
```protobuf
OAuthAppSource effective_oauth_source = 8;
string effective_oauth_app_id = 9;
```

### 4. Modify `GetOAuthGrantStatusOutput` in `io.proto`

Add connection health field:
```protobuf
OAuthConnectionHealth connection_health = 5;
```

### 5. New I/O messages in `io.proto`

**Disconnect OAuth:**
```protobuf
message DisconnectOAuthInput {
  string mcp_server_id = 1;
  string org = 2;
}
message DisconnectOAuthOutput {
  bool disconnected = 1;
}
```

**Set Org OAuth App (BYOA):**
```protobuf
message SetOrgOAuthAppInput {
  string mcp_server_id = 1;
  string org = 2;
  string client_id = 3;
  string client_secret = 4;
}
message SetOrgOAuthAppOutput {
  string oauth_app_id = 1;
  OAuthAppSource source = 2;
}
```

**Get Org OAuth App:**
```protobuf
message GetOrgOAuthAppInput {
  string resource_id = 1;
  string org = 2;
}
message GetOrgOAuthAppOutput {
  bool has_override = 1;
  string oauth_app_id = 2;
  string client_id = 3;
}
```

**Delete Org OAuth App:**
```protobuf
message DeleteOrgOAuthAppInput {
  string resource_id = 1;
  string org = 2;
}
message DeleteOrgOAuthAppOutput {
  bool deleted = 1;
}
```

### 6. New RPCs on `McpServerCommandController` in `command.proto`

```protobuf
rpc disconnectOAuth(DisconnectOAuthInput) returns (DisconnectOAuthOutput);
rpc setOrgOAuthApp(SetOrgOAuthAppInput) returns (SetOrgOAuthAppOutput);
rpc getOrgOAuthApp(GetOrgOAuthAppInput) returns (GetOrgOAuthAppOutput);
rpc deleteOrgOAuthApp(DeleteOrgOAuthAppInput) returns (DeleteOrgOAuthAppOutput);
```

### 7. Regenerate stubs

Run full stub regeneration across Go, TypeScript, Python, Java, and JSON schemas.

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `apis/ai/stigmer/agentic/mcpserver/v1/oauth.proto` | Modify | Add `OAuthAppOverride` message |
| `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto` | Modify | Add `OAuthAppSource` enum, `effective_oauth_source` + `effective_oauth_app_id` to `McpServerAuth` |
| `apis/ai/stigmer/agentic/mcpserver/v1/io.proto` | Modify | Add `OAuthConnectionHealth` enum, `connection_health` field, new I/O messages |
| `apis/ai/stigmer/agentic/mcpserver/v1/command.proto` | Modify | Add 4 new RPCs |
| All stub directories | Regenerate | Go, TS, Python, Java, JSON schema stubs |

## Acceptance Criteria

- [ ] `OAuthAppOverride` message defined with correct composite key fields
- [ ] `OAuthAppSource` and `OAuthConnectionHealth` enums defined
- [ ] `McpServerAuth` enriched with effective source fields (field 8, 9)
- [ ] `GetOAuthGrantStatusOutput` enriched with `connection_health` (field 5)
- [ ] All 4 new RPCs defined with proper authorization annotations
- [ ] All I/O messages have buf validation constraints
- [ ] Stubs regenerated cleanly across all languages
- [ ] Existing proto fields unchanged (backward compatible)

## Predecessor Tasks

None — this is the first task.

## Successor Tasks

T02 (Disconnect + Health backend), T03 (Harden backend), T04 (BYOA infrastructure) all depend on this.
