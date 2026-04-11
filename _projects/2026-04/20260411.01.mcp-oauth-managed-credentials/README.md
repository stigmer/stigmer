# 20260411.01.mcp-oauth-managed-credentials

## Overview
Separate OAuth token storage from personal environments into per-(user, org, mcp_server) managed environments with strict mutation protection. Adds org_id to OAuthGrant, uses grant.environmentId as authoritative token locator across connect, refresh, and session execution flows.

**Created**: 2026-04-11
**Status**: Planning Complete, Implementation Not Started

## Goal
Clean separation of system-managed OAuth credentials from user-managed personal environments, eliminating collision risk and mixed concerns. OAuthGrant becomes the single source of truth for token location.

## Technology Stack
Protocol Buffers, Go (stigmer-server), Java/Spring (stigmer-cloud), TypeScript/React (SDK/UI)

## Affected Components
- OAuthGrant proto + stores (Go/Java)
- ManagedEnvironmentService (Go/Java) — NEW
- MCP connect/refresh handlers (Go/Java)
- CreateExecutionContextStep session injection (Go/Java)
- Environment mutation guards (Go/Java)
- React SDK hooks (useOAuthGrantStatus, useMcpServerCredentials, useMcpServerSetup)
- UI components (McpServerDetailView, McpServerPicker, McpServerConfigPanel)

## Task Summary

| Task | Scope | Status |
|------|-------|--------|
| T01: Proto + Schema Foundation | Proto, Go grant store, Java grant repo | TODO |
| T02: ManagedEnvironmentService + CompleteOAuthConnect | New services (Go/Java), mutation guards, rewire OAuth complete | TODO |
| T03: Connect + Refresh + Session Injection | Connect handlers, refresh, CreateExecutionContextStep (Go/Java) | TODO |
| T04: Frontend — Grant Status + Session Composer | Query handlers, React hooks, UI components | TODO |
| T05: Migration + E2E Validation | Data cleanup, all-flow validation | TODO |

## Success Criteria
- OAuth tokens stored in dedicated per-(user,org,server) managed environments, not personal env
- OAuthGrant keyed by (identity_account_id, mcp_server_id, org_id)
- grant.environmentId is authoritative -- no label-based personal env re-resolution
- Managed environments protected from user mutation
- Frontend detects OAuth status via getOAuthGrantStatus RPC
- Session execution injects OAuth tokens from managed env
- Personal environment contains only user-managed credentials

## Quick Links
- [Tasks](tasks.md) - Task breakdown and progress
- [Notes](notes.md) - Quick notes and learnings
- [Resume](next-task.md) - **Drag this into chat to resume!**
- [Plan](.cursor/plans/oauth_credentials_env_separation_012b9001.plan.md) - Detailed architectural plan

## Predecessor
- [`20260410.03.mcp-oauth-connect`](..//20260410.03.mcp-oauth-connect/) - Implemented OAuth connect/refresh with tokens in personal env

## Project Type
Quick Project - Designed for focused, structured execution with minimal overhead.
