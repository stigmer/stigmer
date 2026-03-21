# DD-001: "Library" Naming Over "Customize"

**Date**: 2026-03-20
**Status**: Decided
**Participants**: Developer + Architect

## Context

Claude Code uses "Customize" for its personalization screen. We needed to decide on naming for the equivalent Stigmer feature.

## Decision

Use **"Library"** instead of "Customize."

## Rationale

- In Claude, "Customize" makes sense — you're personalizing a single AI assistant
- In Stigmer, users manage a **library of platform resources** (agents, skills, MCP servers) — first-class entities with lifecycles, versions, and ownership
- The mental model is closer to a **package registry** (npm, Docker Hub) than a preferences panel
- "Library" communicates the right mental model: reusable building blocks you browse, create, and manage
- Jakob's Law: developers already have a strong mental model for "library" from package managers
- "Registry" was also considered but "Library" is warmer and more accessible

## Alternatives Considered

- **Customize**: Wrong metaphor for resource management
- **Registry**: Too infrastructure-focused, less approachable
- **Resources**: Too generic, conflicts with the platform domain concept
- **Toolbox**: Doesn't convey the browsing/management aspect
