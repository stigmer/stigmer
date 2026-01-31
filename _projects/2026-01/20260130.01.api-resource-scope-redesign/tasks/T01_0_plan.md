# Task T01: API Resource Scope Redesign - Revised Plan

**Created**: 2026-01-30 08:12
**Revised**: 2026-01-31 (after architectural review)
**Status**: APPROVED
**Type**: Refactoring (Breaking Change)

## Executive Summary

Remove `ApiResourceOwnerScope` entirely. Adopt the GitHub model: every resource belongs to an organization, referenced as `org/slug`. Visibility (public/private) is orthogonal to ownership.

---

## Problem Statement

The current `ApiResourceOwnerScope` (platform/organization/identity_account) conflates ownership with visibility and creates portability issues between deployment modes.

**Root issues:**
1. "Platform" scope is cloud-specific—doesn't exist in local/self-hosted mode
2. Three scope types add complexity without clear benefit
3. SDK helpers like `skillref.Platform()` break in non-cloud deployments
4. Mental model is confusing (scope vs visibility vs ownership)

---

## Design Decisions (Finalized)

### 1. Everything Belongs to an Organization

No personal accounts. No platform scope. Just organizations.

| Current | New |
|---------|-----|
| `scope: platform, slug: web-search` | `org: stigmer, slug: web-search` |
| `scope: organization, org: acme, slug: tool` | `org: acme, slug: tool` |
| `scope: identity_account, slug: experiment` | **Eliminated** - use org instead |

### 2. Reference Format: `org/slug` Everywhere

Single consistent format. No special cases.

```go
// SDK usage
agent.AddSkill("my-skill")           // → uses agent.Org
agent.AddSkill("stigmer/web-search") // → parses as org/slug
```

### 3. Visibility is Public or Private

Any org member can set visibility on their resources.

| Visibility | Who Can Access |
|------------|----------------|
| `private` | Only org members |
| `public` | Anyone |

### 4. No "Official" Concept

Users discover resources through marketplace. They see the org name and make their own trust decisions. `stigmer/web-search` is obviously from Stigmer—no badge needed.

### 5. Local Mode Has No External Resources

Users create their own org and define all resources themselves. No dependency on external catalogs.

### 6. No Special Publisher Permissions

Any org member can create public resources. Simple model.

---

## Target Architecture

### Proto Changes

**1. ApiResourceReference (simplified)**
```protobuf
message ApiResourceReference {
  string org = 1;           // Required - which org owns this
  ApiResourceKind kind = 2;
  string slug = 3;          // Required - resource identifier
  string version = 4;       // Optional - for versioned resources
  // REMOVED: ApiResourceOwnerScope scope
}
```

**2. ApiResourceMetadata (visibility replaces scope)**
```protobuf
message ApiResourceMetadata {
  string name = 1;
  string slug = 2;
  string id = 3;
  string org = 4;                        // Required - who owns it
  ApiResourceVisibility visibility = 5;  // public or private
  // ... other fields unchanged
  // REMOVED: ApiResourceOwnerScope owner_scope
}
```

**3. New Visibility Enum**
```protobuf
enum ApiResourceVisibility {
  visibility_unspecified = 0;
  private = 1;   // Only org members can access
  public = 2;    // Everyone can access
}
```

**4. Remove ApiResourceOwnerScope Enum**

Delete entirely. No deprecation period—clean break.

### SDK Changes

**skillref package:**
```go
// Single constructor - always org + slug
func New(org, slug string, opts ...Option) *ApiResourceReference

// Parse "org/slug" format
func Parse(ref string) (*ApiResourceReference, error)

// REMOVED: Platform(), Organization()
```

**mcpserverref package:**
```go
// Single constructor
func New(org, slug string) *ApiResourceReference

// Parse "org/slug" format  
func Parse(ref string) (*ApiResourceReference, error)

// REMOVED: Platform(), Organization(), Personal()
```

**Agent methods:**
```go
// Single method with smart parsing
func (a *Agent) AddSkill(ref string, opts ...SkillOption)
// "my-skill" → org: a.Org, slug: "my-skill"
// "stigmer/web-search" → org: "stigmer", slug: "web-search"

// Single method for MCP servers
func (a *Agent) UseMCPServer(ref string, tools ...string)
// Same parsing logic

// REMOVED: AddSkillRef(), AddOrgSkillRef(), AddSkillRefs()
// REMOVED: UseOrgMCPServer()
```

### FGA Model Changes

- Remove all platform-scoped authorization patterns
- All resources authorize via org membership
- Public resources: check visibility at app layer (not FGA)
- Private resources: standard org-based auth

### Service Layer Changes

**Visibility enforcement:**
```java
// When resolving cross-org references
if (resource.getOrg() != requestingUserOrg) {
    if (resource.getVisibility() != PUBLIC) {
        throw new ForbiddenException("Resource is private");
    }
}
```

---

## Task Breakdown

### Phase 1: Proto & Enum Changes

**T01.1: Add visibility enum**
- [ ] Add `ApiResourceVisibility` enum to `enum.proto`
- [ ] Values: `visibility_unspecified`, `private`, `public`

**T01.2: Update ApiResourceMetadata**
- [ ] Add `visibility` field
- [ ] Remove `owner_scope` field
- [ ] Update field documentation

**T01.3: Update ApiResourceReference**
- [ ] Remove `scope` field
- [ ] Add buf validation: `org` is required
- [ ] Update documentation

**T01.4: Delete ApiResourceOwnerScope**
- [ ] Remove enum from `enum.proto`
- [ ] Remove all references in proto files

**T01.5: Regenerate all stubs**
- [ ] Go, Python, Java, TypeScript, Dart stubs

### Phase 2: SDK Refactoring

**T02.1: Refactor skillref package**
- [ ] Remove `Platform()`, `Organization()` functions
- [ ] Add `New(org, slug)` constructor
- [ ] Add `Parse(ref string)` for "org/slug" parsing
- [ ] Update tests

**T02.2: Refactor mcpserverref package**
- [ ] Remove `Platform()`, `Organization()`, `Personal()` functions
- [ ] Add `New(org, slug)` constructor
- [ ] Add `Parse(ref string)` for "org/slug" parsing
- [ ] Update tests

**T02.3: Update Agent methods**
- [ ] Change `AddSkill` to accept string with smart parsing
- [ ] Change `UseMCPServer` to accept string with smart parsing
- [ ] Remove deprecated methods
- [ ] Update all examples

**T02.4: Update SubAgent methods**
- [ ] Mirror Agent method changes
- [ ] Update tests

### Phase 3: Backend Changes (stigmer-cloud)

**T03.1: Update FGA model**
- [ ] Remove platform-scoped patterns
- [ ] Ensure org-based authorization for all resources

**T03.2: Update service layer**
- [ ] Add visibility check for cross-org resource access
- [ ] Public: allow read from any authenticated user
- [ ] Private: require org membership

**T03.3: Data migration**
- [ ] Migrate `platform`-scoped resources → `stigmer` org with `visibility: public`
- [ ] Migrate `organization`-scoped resources → add `visibility: private`
- [ ] Eliminate `identity_account`-scoped resources (or migrate to user's default org)

### Phase 4: CLI Updates

**T04.1: Update CLI reference handling**
- [ ] Remove `--scope` flags from all commands
- [ ] Ensure `--org` defaults to configured org
- [ ] Update help text

**T04.2: Update CLI examples**
- [ ] Update all example commands in help text
- [ ] Update any documentation

### Phase 5: Documentation

**T05.1: Migration guide**
- [ ] Document breaking changes
- [ ] Provide before/after code examples
- [ ] Explain the rationale (GitHub model)

**T05.2: Update SDK documentation**
- [ ] Update README files
- [ ] Update inline comments
- [ ] Update examples

---

## Success Criteria

- [ ] `ApiResourceOwnerScope` enum deleted
- [ ] All references use `org/slug` pattern with `org` required
- [ ] SDK provides single method with smart parsing:
  - `AddSkill("slug")` for same-org
  - `AddSkill("org/slug")` for cross-org
- [ ] `Visibility` (public/private) on resource metadata
- [ ] Same SDK code works in local, cloud, and self-hosted
- [ ] FGA model uses org-based authorization only
- [ ] Migration guide available

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking change for SDK users | Migration guide with clear before/after examples |
| FGA tuple migration | Script to migrate existing tuples, test in staging |
| Proto field changes | Accept breaking change, major version bump if needed |
| Coordination between repos | Plan PRs to land in correct order (stigmer → stigmer-cloud) |

---

## Key Principles (Reference)

These principles guided the design:

1. **DDD: Keep supporting subdomains simple** - Ownership model shouldn't complicate core domain
2. **GitHub model** - `org/slug` is intuitive, battle-tested
3. **No magic** - No "official" concept, no special SDK functions, no deployment-specific behavior
4. **Visibility ≠ Ownership** - Orthogonal concerns, modeled separately
5. **Local mode is self-contained** - No external dependencies

---

## Appendix: Before/After Examples

### SDK Code

**Before:**
```go
agent.AddSkillRef(skillref.Platform("web-search"))
agent.AddSkillRef(skillref.Organization(agent.Org, "my-skill"))
agent.AddMcpServerUsage(mcpserverref.Platform("github"))
```

**After:**
```go
agent.AddSkill("stigmer/web-search")
agent.AddSkill("my-skill")  // Uses agent.Org
agent.UseMCPServer("stigmer/github")
```

### Proto References

**Before:**
```protobuf
ApiResourceReference {
  scope: platform
  slug: "web-search"
}
```

**After:**
```protobuf
ApiResourceReference {
  org: "stigmer"
  slug: "web-search"
}
```

### Resource Metadata

**Before:**
```protobuf
ApiResourceMetadata {
  org: "stigmer"
  slug: "web-search"
  owner_scope: platform
}
```

**After:**
```protobuf
ApiResourceMetadata {
  org: "stigmer"
  slug: "web-search"
  visibility: public
}
```
