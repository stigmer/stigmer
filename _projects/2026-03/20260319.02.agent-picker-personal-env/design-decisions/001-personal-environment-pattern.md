# Design Decision 001: Personal Environment Pattern

**Date**: 2026-03-19
**Status**: Accepted

## Context

Users need to provide credentials (GitHub tokens, API keys, etc.) for agents that require them. The question was: where should these secrets be stored and how should they be managed?

## Options Considered

### Option A: Browser localStorage
Store secrets in browser localStorage, similar to the current GitHub token approach.

- Pro: Simple, no server changes
- Con: XSS-vulnerable, no lifecycle management (expiry, rotation, revocation), not suitable for a platform-for-platforms where host apps have full JS access

### Option B: One Environment per AgentInstance
Create a new Environment resource every time a user configures an agent.

- Pro: Isolation between agents
- Con: User enters the same GitHub token N times for N agents that need it. Terrible UX.

### Option C: One personal Environment per user per org (selected)
Each user has a single personal Environment that accumulates credentials over time. All personal AgentInstances reference this same Environment.

- Pro: Enter a credential once, reuse across all agents. Server-side storage. FGA-enforced privacy.
- Con: Requires env_spec whitelist filtering to prevent agents from accessing secrets they don't need.

## Decision

Option C. One personal Environment per user per org, identified by:
- Slug: `personal`
- Label: `stigmer.ai/personal: "true"`
- FGA: RESTRICTED model (owner-only by default)

## Security Constraint

The backend env merge must filter merged variables to only include keys declared in the agent's `env_spec`. Without this filter, Agent X could read Agent Y's secrets from the shared personal environment. See T03.1 in the task plan.

## Consequences

- Users enter credentials once, not per-agent
- Secrets are stored server-side with proper auth, not in browser storage
- The AgentInstance/Environment abstractions are preserved but invisible to the user
- Backend env merge needs a whitelist filter (new work)
