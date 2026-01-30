# Project: API Resource Scope Redesign

## Overview

Redesign the API resource ownership model to make SDK code portable between local, cloud, and self-hosted deployments.

**Created**: 2026-01-30
**Status**: Active - Pending Plan Review
**Timeline**: ~3 weeks

## The Problem

The current `ApiResourceOwnerScope` design conflates **visibility** (who can access) with **provider** (who created). This creates code that works in cloud but fails locally:

```go
// This works in Stigmer Cloud (Stigmer provides platform resources)
// But FAILS in local mode (no "platform" exists)
agent.AddSkillRef(skillref.Platform("coding-best-practices"))
```

## The Solution: GitHub Model

**Everything has an org. No exceptions.**

| Before | After |
|--------|-------|
| `skillref.Platform("slug")` | `skillref.New("stigmer", "slug")` |
| `skillref.Organization("my-org", "slug")` | `skillref.New("my-org", "slug")` |
| `scope: platform` on reference | `org: stigmer` on reference |

**SDK Two-Method Pattern:**
```go
// Same org (uses agent.Org)
agent.AddSkill("internal-skill")

// Cross-org (explicit)
agent.AddSkillFrom("stigmer", "official-agent")
```

## Key Changes

1. **Remove `ApiResourceOwnerScope`** from `ApiResourceReference`
2. **Add `ApiResourceVisibility`** (public/private) on resource metadata only
3. **Make `org` required** on all references
4. **SDK two-method pattern**: `AddSkill()` vs `AddSkillFrom()`
5. **Platform resources** → `stigmer` org with `visibility: public`

## Success Criteria

- [ ] `ApiResourceOwnerScope` removed from `ApiResourceReference`
- [ ] All references use `org/slug` pattern with `org` required
- [ ] SDK provides two-method pattern:
  - `AddSkill(slug)` for same-org
  - `AddSkillFrom(org, slug)` for cross-org
- [ ] `Visibility` (public/private) lives only on resource metadata
- [ ] Same SDK code works in local, cloud, and self-hosted
- [ ] FGA model uses org-based authorization only
- [ ] Migration guide available for existing users

## Affected Components

| Component | Repository | Changes |
|-----------|-----------|---------|
| Proto definitions | stigmer | Remove scope from reference, add visibility |
| Go SDK | stigmer | Refactor skillref, mcpserverref, agent |
| CLI | stigmer | Update reference handling |
| FGA model | stigmer-cloud | Simplify to org-based auth |
| Backend services | stigmer-cloud | Check visibility on cross-org access |

## Project Structure

- **`tasks/`** - Task plans and execution logs
- **`checkpoints/`** - Major milestone summaries
- **`design-decisions/`** - Architectural choices (this redesign is the main one)
- **`coding-guidelines/`** - Code standards discovered
- **`wrong-assumptions/`** - Corrected misconceptions

## How to Resume

**Quick Resume**: Drag `next-task.md` into your AI conversation.

## Current Status

**Active Task**: T01 - Plan Review

The detailed plan is at `tasks/T01_0_plan.md`. Please review and provide feedback.
