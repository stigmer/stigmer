# Task T01: API Resource Scope Redesign - Detailed Plan

**Created**: 2026-01-30 08:12
**Status**: PENDING REVIEW
**Type**: Refactoring (Breaking Change)

⚠️ **This plan requires your review before execution**

## Problem Statement

The current `ApiResourceOwnerScope` design conflates two concerns:
1. **Visibility** - Who can access a resource (public vs private)
2. **Provider/Origin** - Who created the resource (platform vs org vs user)

This creates a **portability problem**: SDK code using `skillref.Platform("slug")` works in Stigmer Cloud (where Stigmer provides platform resources) but fails in local/self-hosted mode (where no "platform" exists).

### The Root Cause
- Platform-scoped resources have no `org` - they're "above" organizations
- This required a special `scope` field on references to distinguish them
- But "platform" as a concept doesn't exist in local mode

## Design Decision: The GitHub Model

**Everything has an org. Period.**

| Current (Broken) | Proposed (Clean) |
|-----------------|------------------|
| `scope: platform, slug: official-agent` | `org: stigmer, slug: official-agent` |
| `scope: organization, org: my-org, slug: my-skill` | `org: my-org, slug: my-skill` |
| `scope: identity_account, slug: personal-exp` | `org: suresh, slug: personal-exp` |

- **Platform resources** → Become resources owned by the `stigmer` org with `visibility: public`
- **Org resources** → Stay as org-owned, visibility can be public or private
- **Personal resources** → Owned by user's personal org (created during onboarding)

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

**2. ApiResourceMetadata (visibility only)**
```protobuf
message ApiResourceMetadata {
  string name = 1;
  string slug = 2;
  string id = 3;
  string org = 4;                        // Required - who owns it
  ApiResourceVisibility visibility = 5;  // public or private
  // ... rest unchanged
  // REMOVED: ApiResourceOwnerScope owner_scope
}
```

**3. New Visibility Enum (replaces OwnerScope)**
```protobuf
enum ApiResourceVisibility {
  visibility_unspecified = 0;
  private = 1;   // Only org members can access
  public = 2;    // Everyone can access
}
```

**4. Remove ApiResourceOwnerScope enum entirely**

### SDK Changes (Two-Method Pattern)

**skillref package:**
```go
// Always explicit org + slug
func New(org, slug string, opts ...Option) *ApiResourceReference

// With version
func NewVersioned(org, slug, version string) *ApiResourceReference
```

**Agent convenience methods:**
```go
// Same org - uses agent.Org internally
func (a *Agent) AddSkill(slug string, opts ...SkillOption)

// Cross-org - explicit org
func (a *Agent) AddSkillFrom(org, slug string, opts ...SkillOption)
```

**Similar for MCP servers:**
```go
func (a *Agent) UseMCPServer(slug string, tools ...string)
func (a *Agent) UseMCPServerFrom(org, slug string, tools ...string)
```

### FGA Model Changes

- Remove platform-scoped authorization patterns
- All resources authorize via org membership
- Public resources: anyone can read (check visibility in app layer, not FGA)
- Private resources: org members only (standard org-based auth)

## Task Breakdown

### Phase 1: Proto & Enum Changes (Days 1-3)

**T01.1: Create new visibility enum**
- [ ] Add `ApiResourceVisibility` enum to `enum.proto`
- [ ] Values: `visibility_unspecified`, `private`, `public`

**T01.2: Update ApiResourceMetadata**
- [ ] Replace `owner_scope` field with `visibility` field
- [ ] Update field documentation
- [ ] Keep field number if possible for wire compatibility, or document breaking change

**T01.3: Update ApiResourceReference**
- [ ] Remove `scope` field
- [ ] Make `org` required (add buf validation)
- [ ] Update documentation

**T01.4: Mark ApiResourceOwnerScope as deprecated**
- [ ] Add deprecation notice to enum
- [ ] Plan removal in next major version

**T01.5: Regenerate all stubs**
- [ ] Go stubs
- [ ] Python stubs
- [ ] Java stubs
- [ ] TypeScript stubs
- [ ] Dart stubs

### Phase 2: SDK Refactoring (Days 4-7)

**T02.1: Refactor skillref package**
- [ ] Remove `Platform()`, `Organization()` functions
- [ ] Add `New(org, slug)` as the only constructor
- [ ] Add `NewVersioned(org, slug, version)` for versioned refs
- [ ] Update all tests

**T02.2: Refactor mcpserverref package**
- [ ] Remove `Platform()`, `Organization()`, `Personal()` functions
- [ ] Add `New(org, slug)` as the only constructor
- [ ] Update all tests

**T02.3: Update Agent methods**
- [ ] Add `AddSkill(slug)` - uses agent.Org
- [ ] Add `AddSkillFrom(org, slug)` - explicit org
- [ ] Deprecate `AddSkillRef()`, `AddOrgSkillRef()`, `AddSkillRefs()`
- [ ] Same pattern for MCP servers
- [ ] Update all examples

**T02.4: Update SubAgent methods**
- [ ] Mirror Agent method changes
- [ ] Update tests

### Phase 3: FGA Model Updates (Days 8-10) - stigmer-cloud

**T03.1: Simplify FGA model**
- [ ] Remove platform-specific authorization patterns
- [ ] Ensure all resources use org-based authorization
- [ ] Document that visibility is enforced at app layer, not FGA

**T03.2: Update service layer**
- [ ] Check visibility when resolving cross-org references
- [ ] Public resources: allow read from any authenticated user
- [ ] Private resources: require org membership

**T03.3: Migration for existing data**
- [ ] Plan migration for existing platform-scoped resources
- [ ] Move to `stigmer` org with `visibility: public`

### Phase 4: CLI Updates (Days 11-12)

**T04.1: Update CLI reference handling**
- [ ] Remove `--scope` flags
- [ ] Ensure `--org` is required or defaults to configured org
- [ ] Update help text

**T04.2: Update CLI examples and docs**
- [ ] Update all example commands
- [ ] Document the new reference pattern

### Phase 5: Documentation & Migration (Days 13-15)

**T05.1: Migration guide**
- [ ] Document breaking changes
- [ ] Provide before/after code examples
- [ ] Explain the rationale

**T05.2: Update SDK documentation**
- [ ] Update README files
- [ ] Update inline code comments
- [ ] Update examples

**T05.3: Update architecture docs**
- [ ] Document the new ownership model
- [ ] Explain visibility vs ownership

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

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Breaking change for SDK users | Provide migration guide with clear before/after examples |
| FGA tuple migration | Script to migrate existing tuples, test in staging first |
| Proto field number changes | Evaluate wire compatibility, may need major version bump |
| Coordination between repos | Plan PRs to land in correct order |

## Estimated Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Phase 1: Proto changes | 3 days | Updated protos, regenerated stubs |
| Phase 2: SDK refactoring | 4 days | New SDK API, updated examples |
| Phase 3: FGA model | 3 days | Simplified auth model |
| Phase 4: CLI updates | 2 days | Updated CLI commands |
| Phase 5: Documentation | 3 days | Migration guide, updated docs |
| **Total** | **~15 days (3 weeks)** | |

## Review Questions

**Please consider before approving:**

1. **Two-method pattern**: Is `AddSkill(slug)` + `AddSkillFrom(org, slug)` the right UX?
2. **Visibility scope**: Should we have `org_only` in addition to `public`/`private`?
3. **Personal orgs**: Do we need to implement personal org creation in onboarding now, or defer?
4. **Wire compatibility**: Should we try to maintain proto wire compatibility, or accept a major version bump?
5. **Phasing**: Should we deprecate first and remove later, or do it all at once?

---

**What happens next**:
1. **You review this plan** - Take your time to consider the approach
2. **Provide feedback** - Share any concerns, suggestions, or changes
3. **I'll revise the plan** - Create an updated version incorporating your feedback
4. **You approve** - Give explicit approval to proceed
5. **Execution begins** - Implementation tracked in T01_3_execution.md
