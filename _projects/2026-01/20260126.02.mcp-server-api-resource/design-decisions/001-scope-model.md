# Design Decision 001: McpServer Scope Model

**Date**: 2026-01-26
**Status**: PROPOSED (Pending Approval)
**Deciders**: Developer review required

## Context

MCP (Model Context Protocol) servers are being extracted from inline `AgentSpec` configuration into a first-class API resource. A key design decision is which scopes should be supported for `McpServer` resources.

## Decision

Support **all three scopes**: Platform, Organization, and Identity Account.

## Scope Details

### Platform Scope
- **Owner**: Stigmer platform operators
- **Visibility**: Public to all users (marketplace)
- **Use Cases**:
  - Generic MCP servers shipped by Stigmer (GitHub, Slack, AWS, filesystem, etc.)
  - Community-contributed MCP servers after review
  - Reference implementations and examples

### Organization Scope
- **Owner**: Organization administrators
- **Visibility**: Organization members only
- **Use Cases**:
  - Private/proprietary MCP servers
  - Internal API integrations
  - Organization-specific tooling
  - Sensitive configurations that shouldn't be public

### Identity Account Scope
- **Owner**: Individual user
- **Visibility**: Only the owner
- **Use Cases**:
  - Personal development tools
  - Local integrations (localhost services)
  - Experimental/WIP MCP servers
  - Personal API keys/configurations

## Rationale

1. **Reusability at Multiple Levels**: Different teams/individuals need to share MCP configs at different granularities
2. **Security Boundaries**: Organizations need private MCP servers for proprietary systems
3. **Developer Experience**: Individual developers want personal MCP server configs without creating org resources
4. **Marketplace Enablement**: Platform scope enables a catalog of pre-built MCP servers

## Comparison with Similar Resources

| Resource | Scopes Supported | Rationale |
|----------|------------------|-----------|
| **Skill** | Platform, Organization | Knowledge is shareable, no personal secrets |
| **Agent** | Platform, Organization | Agents are meant to be shared/discovered |
| **Environment** | Organization, Identity Account | Env configs often contain secrets |
| **AgentInstance** | Organization only | Runtime instances are org-specific |
| **McpServer** | Platform, Org, Identity Account | Combines shareable config + personal use |

## Consequences

### Positive
- Maximum flexibility for users
- Enables marketplace/catalog of MCP servers
- Supports private org-specific integrations
- Personal configs without org overhead

### Negative
- Slightly more complex FGA model (3 scopes vs 2)
- Need to handle visibility correctly in list/search operations
- Migration complexity if user changes scope

## FGA Implementation

```fga
type mcp_server
  relations
    define platform: [platform]
    define organization: [organization]
    define identity_account: [identity_account]
    
    define operator: operator from platform or operator from organization or operator from identity_account
    define owner: [identity_account] or admin from organization or operator
    define viewer: owner or member from organization
    
    define can_view: viewer or platform
    define can_use: viewer or platform
    define can_edit: owner
    define can_delete: owner
```

## Related Decisions

- 002-reference-vs-inline.md (how agents reference MCP servers)
- 003-env-var-handling.md (schema vs values separation)
