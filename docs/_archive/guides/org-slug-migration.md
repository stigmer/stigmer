# org/slug Migration Guide

Complete guide for migrating from the scope-based ownership model to the new org/slug model.

## Overview

Stigmer has simplified resource ownership to use a GitHub-inspired `org/slug` model, removing the complexity of scope-based references.

**Before (scope-based):**
```go
import "github.com/stigmer/stigmer/sdk/go/skillref"

agent.AddSkillRef(skillref.Platform("code-review"))      // Platform scope
agent.AddSkillRef(skillref.Organization("acme", "scan")) // Organization scope
agent.AddSkillRef(skillref.User("deploy"))               // User scope
```

**After (org/slug):**
```go
// No import needed - direct string references
agent.AddSkill("stigmer/code-review")      // Org: stigmer
agent.AddSkill("acme-corp/scan")           // Org: acme-corp
agent.AddSkill("my-org/deploy")            // Org: my-org
```

## What Changed

### 1. Removed `ApiResourceOwnerScope` Enum

**Before:**
```protobuf
enum ApiResourceOwnerScope {
  API_RESOURCE_OWNER_SCOPE_UNSPECIFIED = 0;
  API_RESOURCE_OWNER_SCOPE_PLATFORM = 1;
  API_RESOURCE_OWNER_SCOPE_ORGANIZATION = 2;
  API_RESOURCE_OWNER_SCOPE_USER = 3;
}
```

**After:**
```protobuf
// Removed entirely - use org field instead
```

### 2. Added `ApiResourceVisibility` Enum

**New:**
```protobuf
enum ApiResourceVisibility {
  API_RESOURCE_VISIBILITY_UNSPECIFIED = 0;
  API_RESOURCE_VISIBILITY_PRIVATE = 1;      // Default
  API_RESOURCE_VISIBILITY_PUBLIC = 2;
}
```

### 3. Updated `ApiResourceMetadata`

**Before:**
```protobuf
message ApiResourceMetadata {
  string org = 1;
  string slug = 2;
  ApiResourceOwnerScope owner_scope = 5;
}
```

**After:**
```protobuf
message ApiResourceMetadata {
  string org = 1;                           // Now required
  string slug = 2;
  ApiResourceVisibility visibility = 5;     // New field
}
```

### 4. Updated `ApiResourceReference`

**Before:**
```protobuf
message ApiResourceReference {
  ApiResourceOwnerScope scope = 1;
  string slug = 2;
  string org = 3;                           // Optional
  string id = 4;
}
```

**After:**
```protobuf
message ApiResourceReference {
  string org = 1;                           // Now required
  string slug = 2;
  string version = 3;                       // New: for versioned resources
  string id = 4;
}
```

## Migration Steps

### Step 1: Update SDK Code

#### Agent Skill References

**Before:**
```go
import "github.com/stigmer/stigmer/sdk/go/skillref"

agent.AddSkillRef(skillref.Platform("security-scan"))
agent.AddSkillRef(skillref.Organization("acme-corp", "custom-scan"))
```

**After:**
```go
// No skillref import needed
agent.AddSkill("stigmer/security-scan")
agent.AddSkill("acme-corp/custom-scan")
```

#### MCP Server References

**Before:**
```go
import "github.com/stigmer/stigmer/sdk/go/mcpserverref"

agent.AddMCPServerRef(mcpserverref.Platform("github"))
agent.AddMCPServerRef(mcpserverref.Organization("acme-corp", "custom-mcp"))
```

**After:**
```go
// No mcpserverref import needed
agent.UseMCP("stigmer/github")
agent.UseMCP("acme-corp/custom-mcp")
```

#### Workflow Agent References

**Before:**
```go
import "github.com/stigmer/stigmer/sdk/go/workflow"

workflow.Agent(
    &workflow.AgentRef{
        Scope: workflow.ScopePlatform,
        Slug:  "code-reviewer",
    },
)
```

**After:**
```go
import "github.com/stigmer/stigmer/sdk/go/workflow"

// Simple string reference
workflow.AgentBySlug("stigmer/code-reviewer")

// Or explicit org/slug
workflow.AgentByOrgSlug("stigmer", "code-reviewer")
```

### Step 2: Update CLI Commands

#### Resource References

**Before:**
```bash
# Platform resources (implicit scope)
stigmer run code-reviewer

# Organization resources (required --org flag)
stigmer run --org acme-corp deploy-pipeline
```

**After:**
```bash
# Explicit org/slug format
stigmer run stigmer/code-reviewer
stigmer run acme-corp/deploy-pipeline

# Or use current org context (slug-only)
stigmer run code-reviewer  # Uses current org from config
```

#### MCP Server Commands

**Before:**
```bash
# Get platform MCP server
stigmer mcpserver get github --scope platform

# Get org MCP server
stigmer mcpserver get custom-mcp --org acme-corp
```

**After:**
```bash
# Explicit org/slug format
stigmer mcpserver get stigmer/github
stigmer mcpserver get acme-corp/custom-mcp
```

#### Skill Push

**Before:**
```bash
# Push to platform (required --scope flag)
stigmer artifact skill push --scope platform my-skill.zip

# Push to org
stigmer artifact skill push --org acme-corp my-skill.zip
```

**After:**
```bash
# Org is inferred from context or specified explicitly
stigmer artifact skill push my-skill.zip  # Uses current org

# Or explicit org
stigmer artifact skill push --org acme-corp my-skill.zip
```

### Step 3: Update Resource Metadata

#### In Code (SDK)

**Before:**
```go
agent := &agent.Agent{
    Metadata: &ApiResourceMetadata{
        OwnerScope: API_RESOURCE_OWNER_SCOPE_ORGANIZATION,
        Org:        "acme-corp",
        Slug:       "code-reviewer",
    },
}
```

**After:**
```go
agent := &agent.Agent{
    Metadata: &ApiResourceMetadata{
        Org:        "acme-corp",  // Required
        Slug:       "code-reviewer",
        Visibility: API_RESOURCE_VISIBILITY_PRIVATE,  // Optional, default: PRIVATE
    },
}
```

#### In YAML Files

**Before:**
```yaml
metadata:
  owner_scope: ORGANIZATION
  org: acme-corp
  slug: code-reviewer
```

**After:**
```yaml
metadata:
  org: acme-corp
  slug: code-reviewer
  visibility: PRIVATE  # Optional, default: PRIVATE
```

### Step 4: Update Authorization Checks

#### Backend Code (Java)

**Before:**
```java
// Scope-based authorization
if (metadata.getOwnerScope() == ApiResourceOwnerScope.PLATFORM) {
    // Platform admin check
    authService.checkPlatformAdmin(user);
} else if (metadata.getOwnerScope() == ApiResourceOwnerScope.ORGANIZATION) {
    // Org member check
    authService.checkOrgMember(user, metadata.getOrg());
}
```

**After:**
```java
// Pure FGA authorization (no scope checks)
authService.authorize(user, resource, "viewer");

// Organization membership is checked via FGA tuples
```

#### Backend Code (Go)

**Before:**
```go
// Scope-based conditionals
if ref.Scope == apiresourcev1.ApiResourceOwnerScope_API_RESOURCE_OWNER_SCOPE_PLATFORM {
    return c.platformRepo.GetBySlug(ctx, ref.Slug)
} else {
    return c.orgRepo.GetByOrgAndSlug(ctx, ref.Org, ref.Slug)
}
```

**After:**
```go
// Simple org-based lookup
return c.repo.GetByOrgAndSlug(ctx, ref.Org, ref.Slug)
```

## Scope to Org Mapping

### Platform Resources → stigmer Org

**Before:**
```go
skillref.Platform("code-review")      // PLATFORM scope
mcpserverref.Platform("github")       // PLATFORM scope
```

**After:**
```go
agent.AddSkill("stigmer/code-review")  // stigmer org
agent.UseMCP("stigmer/github")         // stigmer org
```

**Visibility:**
- Most platform resources: `PUBLIC` (marketplace)
- Some platform resources: `PRIVATE` (internal)

### Organization Resources → Explicit Org

**Before:**
```go
skillref.Organization("acme-corp", "custom-skill")
mcpserverref.Organization("acme-corp", "custom-mcp")
```

**After:**
```go
agent.AddSkill("acme-corp/custom-skill")
agent.UseMCP("acme-corp/custom-mcp")
```

**Visibility:**
- Default: `PRIVATE` (org-only)
- Optional: `PUBLIC` (share with others)

### User Resources → User's Personal Org

**Before:**
```go
skillref.User("my-skill")              // USER scope
```

**After:**
```go
agent.AddSkill("alice-personal/my-skill")  // User's personal org
```

**Migration note:** Each user gets a personal organization (e.g., `alice-personal`).

## Reference Format Examples

### Basic References

```go
// Agents
"stigmer/code-reviewer"
"acme-corp/deploy-agent"

// Skills
"stigmer/security-scan"
"my-team/coding-standards"

// Workflows
"stigmer/ci-pipeline"
"acme-corp/deploy-workflow"

// MCP Servers
"stigmer/github"
"acme-corp/custom-api"
```

### Versioned References

```go
// Semantic version
"stigmer/security-scan@v2.1.0"
"acme-corp/deploy@v1.5.2"

// Tag-based version
"stigmer/security-scan@latest"
"acme-corp/deploy@prod"
"my-team/analyzer@beta"

// Hash-based version (content-addressable)
"stigmer/security-scan@sha256:abc123..."
```

### Resource IDs

```go
// Still supported - bypasses org/slug resolution
"agt_01abc123"           // Agent ID
"wf_01xyz789"            // Workflow ID
"skill_01def456"         // Skill ID
"mcp-01ghi789"           // MCP Server ID
"agtexec_01jkl012"       // Agent Execution ID
"wfexec_01mno345"        // Workflow Execution ID
```

## Breaking Changes

### Removed APIs

| Removed API | Replacement |
|-------------|-------------|
| `skillref.Platform(slug)` | `agent.AddSkill("stigmer/slug")` |
| `skillref.Organization(org, slug)` | `agent.AddSkill("org/slug")` |
| `skillref.User(slug)` | `agent.AddSkill("personal-org/slug")` |
| `mcpserverref.Platform(slug)` | `agent.UseMCP("stigmer/slug")` |
| `mcpserverref.Organization(org, slug)` | `agent.UseMCP("org/slug")` |
| `workflow.AgentRef{Scope, Slug}` | `workflow.AgentBySlug("org/slug")` |

### Changed CLI Flags

| Old Flag | New Approach |
|----------|--------------|
| `--scope platform` | Use `stigmer/` prefix in reference |
| `--scope organization --org acme` | Use `acme-corp/` prefix in reference |
| `--scope user` | Use personal org prefix |

### Changed Proto Fields

| Proto Message | Old Field | New Field |
|---------------|-----------|-----------|
| `ApiResourceMetadata` | `owner_scope` (enum) | `visibility` (enum) |
| `ApiResourceReference` | `scope` (enum) | Removed (use `org` field) |

## Common Migration Patterns

### Pattern 1: Simple Skill Reference

**Before:**
```go
package main

import (
    "github.com/stigmer/stigmer/sdk/go/agent"
    "github.com/stigmer/stigmer/sdk/go/skillref"
    "github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
    stigmer.Run(func(ctx *stigmer.Context) error {
        myAgent, _ := agent.New(ctx, "reviewer", &agent.AgentArgs{
            Instructions: "Review code",
        })
        
        myAgent.AddSkillRef(skillref.Platform("code-standards"))
        return nil
    })
}
```

**After:**
```go
package main

import (
    "github.com/stigmer/stigmer/sdk/go/agent"
    "github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
    stigmer.Run(func(ctx *stigmer.Context) error {
        myAgent, _ := agent.New(ctx, "reviewer", &agent.AgentArgs{
            Org:          "my-org",
            Instructions: "Review code",
        })
        
        // Simple string reference
        myAgent.AddSkill("stigmer/code-standards")
        return nil
    })
}
```

### Pattern 2: Multiple Skills

**Before:**
```go
myAgent.AddSkillRef(skillref.Platform("security"))
myAgent.AddSkillRef(skillref.Organization("acme", "custom"))
myAgent.AddSkillRef(skillref.User("personal"))
```

**After:**
```go
myAgent.AddSkills(
    "stigmer/security",        // Platform → stigmer org
    "acme/custom",             // Organization
    "alice-personal/personal", // User → personal org
)
```

### Pattern 3: Versioned Skills

**Before:**
```go
myAgent.AddSkillRef(skillref.Platform("security"))  // Always latest
```

**After:**
```go
// Pin to version
myAgent.AddSkill("stigmer/security@v2.1")

// Or track latest (default)
myAgent.AddSkill("stigmer/security")
```

### Pattern 4: Workflow Agent Call

**Before:**
```go
import "github.com/stigmer/stigmer/sdk/go/workflow"

workflow.CallAgent(&workflow.AgentCallTaskConfig{
    Agent: &workflow.AgentRef{
        Scope: workflow.ScopePlatform,
        Slug:  "code-reviewer",
    },
    Message: "Review this code",
})
```

**After:**
```go
import "github.com/stigmer/stigmer/sdk/go/workflow"

workflow.CallAgent(&workflow.AgentCallTaskConfig{
    Agent:   workflow.AgentBySlug("stigmer/code-reviewer"),
    Message: "Review this code",
})
```

## Database Migration

### MongoDB Collections

**Before:**
```javascript
// Old schema with owner_scope field
{
  _id: "agt_01abc123",
  metadata: {
    owner_scope: "ORGANIZATION",
    org: "acme-corp",
    slug: "code-reviewer"
  }
}
```

**After:**
```javascript
// New schema with visibility field
{
  _id: "agt_01abc123",
  metadata: {
    org: "acme-corp",
    slug: "code-reviewer",
    visibility: "PRIVATE"
  }
}
```

### Default Mapping

**Automatic migration (handled by backend):**

| Old `owner_scope` | New `org` | New `visibility` |
|-------------------|-----------|------------------|
| `PLATFORM` | `stigmer` | `PUBLIC` (marketplace) |
| `ORGANIZATION` | (existing `org`) | `PRIVATE` |
| `USER` | `{username}-personal` | `PRIVATE` |

### Repository Method Migration

**Before:**
```java
// Old repository methods
public interface AgentRepo extends MongoRepository<Agent, String> {
    Optional<Agent> findByOwnerScopeAndSlug(
        ApiResourceOwnerScope scope, String slug);
    Optional<Agent> findByOwnerScopeAndOrgAndSlug(
        ApiResourceOwnerScope scope, String org, String slug);
}
```

**After:**
```java
// New repository methods
public interface AgentRepo extends MongoRepository<Agent, String> {
    Optional<Agent> findByOrgAndSlug(String org, String slug);
    
    // No scope parameter needed
}
```

## Testing Your Migration

### 1. SDK Tests

```go
func TestMigration_SkillReferences(t *testing.T) {
    ctx := stigmer.NewContext()
    agent, _ := agent.New(ctx, "test", &agent.AgentArgs{
        Org: "test-org",
    })
    
    // Old pattern (deprecated)
    // agent.AddSkillRef(skillref.Platform("skill"))
    
    // New pattern
    agent.AddSkill("stigmer/skill")
    
    assert.Len(t, agent.Skills, 1)
    assert.Equal(t, "stigmer", agent.Skills[0].Org)
    assert.Equal(t, "skill", agent.Skills[0].Slug)
}
```

### 2. CLI Integration Tests

```bash
# Test org/slug references
stigmer run stigmer/test-agent

# Test versioned references
stigmer artifact skill push stigmer/test-skill@v1.0

# Test ID-based references
stigmer run agt_01abc123
```

### 3. Backend Tests

```java
@Test
public void testOrgSlugResolution() {
    ApiResourceReference ref = ApiResourceReference.newBuilder()
        .setOrg("test-org")
        .setSlug("test-agent")
        .build();
    
    Agent agent = handler.getByReference(ref);
    
    assertThat(agent.getMetadata().getOrg()).isEqualTo("test-org");
    assertThat(agent.getMetadata().getSlug()).isEqualTo("test-agent");
}
```

## Rollback Strategy

If you need to rollback to the old scope-based model:

### 1. SDK Rollback

```bash
# Revert to previous SDK version
go get github.com/stigmer/stigmer/sdk/go@v0.x.x
```

### 2. CLI Rollback

```bash
# Use previous CLI version
brew unlink stigmer
brew install stigmer@0.x.x
```

### 3. Database Rollback

```javascript
// Restore owner_scope field
db.agents.updateMany({}, {
  $set: {
    "metadata.owner_scope": function() {
      return this.metadata.org === "stigmer" ? "PLATFORM" : "ORGANIZATION";
    }
  },
  $unset: { "metadata.visibility": "" }
})
```

## Troubleshooting

### Error: "org is required"

**Symptom:**
```
Error: org field is required in ApiResourceReference
```

**Cause:** Reference missing org field

**Solution:**
```go
// ❌ Old - slug-only
ref := &ApiResourceReference{Slug: "code-reviewer"}

// ✅ New - org/slug
ref := &ApiResourceReference{
    Org:  "stigmer",
    Slug: "code-reviewer",
}
```

### Error: "skillref package not found"

**Symptom:**
```
cannot find package "github.com/stigmer/stigmer/sdk/go/skillref"
```

**Cause:** `skillref` package removed in new version

**Solution:**
```go
// ❌ Old import
import "github.com/stigmer/stigmer/sdk/go/skillref"

// ✅ Remove import, use direct string references
agent.AddSkill("stigmer/security-scan")
```

### Error: "mcpserverref package not found"

**Symptom:**
```
cannot find package "github.com/stigmer/stigmer/sdk/go/mcpserverref"
```

**Cause:** `mcpserverref` package removed in new version

**Solution:**
```go
// ❌ Old import
import "github.com/stigmer/stigmer/sdk/go/mcpserverref"

// ✅ Remove import, use direct string references
agent.UseMCP("stigmer/github")
```

### Error: "scope field not found"

**Symptom:**
```
unknown field 'scope' in ApiResourceReference
```

**Cause:** `scope` field removed from proto

**Solution:**
```protobuf
// ❌ Old proto
message ApiResourceReference {
  ApiResourceOwnerScope scope = 1;
  string slug = 2;
}

// ✅ New proto
message ApiResourceReference {
  string org = 1;
  string slug = 2;
}
```

## Timeline

### Phase 1: Proto Changes (✅ Completed)
- Removed `ApiResourceOwnerScope` enum
- Added `ApiResourceVisibility` enum
- Updated all proto files
- Regenerated stubs

### Phase 2: SDK Changes (✅ Completed)
- Removed `skillref` package
- Removed `mcpserverref` package
- Added smart parsing to `agent` and `subagent` packages
- Updated all examples and tests

### Phase 3: Backend Changes (✅ Completed)
- Updated Java service layer (stigmer-cloud)
- Updated Go service layer (stigmer)
- Migrated FGA authorization model
- Updated repository methods

### Phase 4: CLI Changes (✅ Completed)
- Created `pkg/reference` parsing package
- Updated all CLI commands
- Removed scope-based flags

### Phase 5: Documentation (🔄 In Progress)
- Architecture documentation
- Migration guides
- Updated CLI examples

## Getting Help

### Resources

- **Architecture:** [org/slug Ownership Model](../architecture/org-slug-ownership-model.md)
- **SDK Guide:** [SDK Migration Guide](../../sdk/go/docs/guides/migration-guide.md)
- **Examples:** `sdk/go/examples/`

### Support Channels

- **GitHub Issues:** [github.com/stigmer/stigmer/issues](https://github.com/stigmer/stigmer/issues)
- **Documentation:** [docs.stigmer.ai](https://docs.stigmer.ai)

## Summary

**Key Takeaways:**

1. ✅ Replace `skillref.Platform()` with `"stigmer/slug"`
2. ✅ Replace `skillref.Organization(org, slug)` with `"org/slug"`
3. ✅ Remove `skillref` and `mcpserverref` imports
4. ✅ Use `org/slug[@version]` format everywhere
5. ✅ Set `visibility` instead of `owner_scope`
6. ✅ Org field is now required in all references

**Next Steps:**

1. Update SDK code to use `org/slug` references
2. Remove deprecated package imports
3. Update CLI commands to use `org/slug` format
4. Test your migration thoroughly
5. Deploy updated code

**Remember:** The new model is simpler, more consistent, and portable across all environments!

---

*Last Updated: 2026-01-31 (org/slug Migration Guide)*
