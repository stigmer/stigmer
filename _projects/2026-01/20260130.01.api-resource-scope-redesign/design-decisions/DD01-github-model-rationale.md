# Design Decision 01: Adopting the GitHub Model for Resource References

**Date**: 2026-01-30
**Status**: Approved
**Decision Makers**: Suresh (Product Owner)

## Context

The existing `ApiResourceOwnerScope` enum (`platform`, `organization`, `identity_account`) was designed to support multi-tenancy in Stigmer Cloud. However, this design creates problems:

1. **Platform scope has no org** - Platform resources exist "above" organizations
2. **SDK code isn't portable** - `skillref.Platform("slug")` works in cloud but fails locally
3. **Conflated concerns** - The enum mixes "who can access" with "who provides"

## The Original Design Problem

```protobuf
// Current: Scope on reference
message ApiResourceReference {
  ApiResourceOwnerScope scope = 1;  // platform, organization, or identity_account
  string org = 2;                   // only needed if scope = organization
  string slug = 4;
}
```

When a user writes:
```go
agent.AddSkillRef(skillref.Platform("coding-best-practices"))
```

This says: "I want a skill that **the platform operator** provides."

- **In Stigmer Cloud**: Works - Stigmer provides this skill
- **In local mode**: Fails - Who is the platform? Nobody.
- **In self-hosted**: Unclear - Is the self-hosting company the "platform"?

## Decision

Adopt the **GitHub model**: everything has an owner (org), and visibility is a separate attribute.

### Key Principles

1. **Every resource has an org** - No exceptions, no "platform" scope
2. **Visibility is on the resource, not the reference** - The resource decides who can see it
3. **Reference identifies, authorization decides** - Reference = "which resource", auth = "can I access it"

### The GitHub Analogy

| GitHub | Stigmer |
|--------|---------|
| `facebook/react` | `skillref.New("stigmer", "coding-agent")` |
| `my-user/my-repo` | `skillref.New("my-org", "my-skill")` |
| Repo is public or private | Resource has `visibility: public` or `private` |
| You reference by `owner/name` | You reference by `org/slug` |
| Auth checks if you can access | Auth checks org membership + visibility |

### Target Design

```protobuf
// New: No scope on reference, just org + slug
message ApiResourceReference {
  string org = 1;           // Required - always specify who owns it
  ApiResourceKind kind = 2;
  string slug = 3;
  string version = 4;
}

// Visibility is on the resource itself
message ApiResourceMetadata {
  string org = 4;
  ApiResourceVisibility visibility = 5;  // public or private
}
```

## SDK Design: Two-Method Pattern

After considering multiple options:

| Option | Example | Rejected Because |
|--------|---------|-----------------|
| Slash syntax | `AddSkill("stigmer/agent")` | Requires string parsing, edge cases with `/` in names |
| Optional param | `AddSkill("agent", org="stigmer")` | Go doesn't have named params, confusing API |
| **Two methods** | `AddSkill("agent")` + `AddSkillFrom("stigmer", "agent")` | **Chosen** - Clear, no parsing, Go-friendly |

### Chosen API

```go
// Same org - uses the agent's org
agent.AddSkill("internal-skill")

// Cross-org - explicit org
agent.AddSkillFrom("stigmer", "official-agent")
```

## What "Platform Resources" Become

In Stigmer Cloud:
- Stigmer (the company) owns an org called `stigmer`
- Official resources are created in the `stigmer` org with `visibility: public`
- Users reference them: `skillref.New("stigmer", "official-agent")`

This is no different from how `github/docs` is just GitHub's org, not a special "platform" space.

## Portability Achieved

The same code now works everywhere:

```go
agent.AddSkillFrom("stigmer", "coding-best-practices")
```

- **Cloud**: Works - `stigmer` org exists with public resources
- **Self-hosted**: Works IF admin has created the resource, fails otherwise (expected)
- **Local**: Works IF user has created it, fails otherwise (expected)

The code is the same. Whether the resource exists depends on the deployment.

## Alternatives Considered

### Alternative 1: Keep platform scope but make it work locally

- Would require bundling "platform resources" with local installations
- Adds complexity: how to keep them updated?
- Still conflates visibility with provider
- **Rejected**: Doesn't solve the fundamental design problem

### Alternative 2: Different APIs for local vs cloud

- Local SDK would have different methods than cloud SDK
- Code wouldn't be portable
- **Rejected**: Violates the core requirement

### Alternative 3: Remove visibility entirely, only org-based access

- Everything org-private, no public resources
- **Rejected**: We do want public/marketplace resources in cloud

## Consequences

### Positive
- SDK code is portable between deployments
- Clean separation: reference identifies, visibility authorizes
- Familiar pattern (GitHub, Docker, npm)
- Simpler mental model

### Negative
- Breaking change for existing SDK users
- Need to migrate existing platform-scoped resources
- More verbose for cross-org references

### Neutral
- Proto regeneration required
- FGA model simplification needed

## Migration Path

1. Add new `visibility` field alongside `owner_scope`
2. Update SDK to use new two-method pattern
3. Deprecate old methods with clear warnings
4. Migrate existing platform resources to `stigmer` org
5. Remove `owner_scope` in next major version
