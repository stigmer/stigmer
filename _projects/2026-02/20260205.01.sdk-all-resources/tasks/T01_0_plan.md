# Task T01: SDK All Resources - Analysis & Implementation Plan

**Created**: 2026-02-05
**Status**: PENDING REVIEW
**Type**: Feature Development
**Supersedes**: 20260131.02.cli-agent-yaml-first (Phase 5: SDK Unification)

---

## Executive Summary

This project extends the Stigmer SDK to synthesize **all 4 resource types** (Agent, Workflow, Skill, MCP Server). The **Project is NOT an SDK concept** - it's defined in `stigmer.yaml` and assembled by the CLI for reconciliation.

**Architecture Clarification**:
- `stigmer.yaml` defines project metadata (name, org, runtime, entry_point)
- SDK code defines resources (agents, workflows, skills, MCP servers)
- CLI combines `stigmer.yaml` + synthesized resources into Project proto
- Backend reconciles via Project Apply API

**Goal**: SDK can synthesize all 4 resource types; CLI assembles into Project for reconciliation.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Repository                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  stigmer.yaml                    main.go (SDK code)             │
│  ─────────────                   ────────────────               │
│  apiVersion: v1                  stigmer.Run(func(ctx) {        │
│  kind: Project                       agent.New(ctx, ...)        │
│  metadata:                           workflow.New(ctx, ...)     │
│    name: my-app                      mcpserver.Stdio(ctx, ...)  │
│    org: my-org                       skill.FromDir(ctx, ...)    │
│  spec:                           })                             │
│    runtime: go                                                   │
│    entryPoint: main.go                                          │
│                                                                  │
└───────────────┬─────────────────────────────┬───────────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────┐   ┌─────────────────────────────────┐
│   stigmer.yaml metadata   │   │   .stigmer/ (synthesis output)  │
│   (name, org, runtime)    │   │   agent-0.pb, workflow-0.pb     │
│                           │   │   mcpserver-0.pb, skill-0.pb    │ ← NEW
│                           │   │   dependencies.json              │
└───────────────┬───────────┘   └────────────────┬────────────────┘
                │                                 │
                └────────────────┬────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │   stigmer apply        │
                    │   (CLI)                │
                    │                        │
                    │   1. Read stigmer.yaml │
                    │   2. Read .stigmer/    │
                    │   3. Assemble Project  │
                    │   4. Call Apply API    │
                    └────────────┬───────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │   Backend              │
                    │   Project Apply API    │
                    │   Reconciliation       │
                    └────────────────────────┘
```

---

## Current State Analysis

### SDK Context - What's Registered & Synthesized

| Resource Type | Registered in Context | Synthesized | Notes |
|---------------|----------------------|-------------|-------|
| Agent | ✅ `RegisterAgent()` | ✅ `agent-N.pb` | Complete |
| Workflow | ✅ `RegisterWorkflow()` | ✅ `workflow-N.pb` | Complete |
| MCP Server | ❌ No registration | ❌ No synthesis | **Gap** - only attached to agents |
| Skill | ❌ No registration | ❌ No synthesis | **Gap** - only references, no `FromDir()` |

### Current Synthesis Output

```
.stigmer/
├── agent-0.pb
├── agent-1.pb
├── workflow-0.pb
└── dependencies.json
```

### Needed Synthesis Output

```
.stigmer/
├── agent-0.pb
├── agent-1.pb
├── workflow-0.pb
├── mcpserver-0.pb          ← NEW
├── skill-0.pb              ← NEW (with artifact manifest)
└── dependencies.json
```

---

## Gap Analysis

### Gap 1: MCP Server Not Registered or Synthesized

**Current**: `mcpserver.Stdio()`, `HTTP()`, `Docker()` create MCP servers that attach to agents. Context doesn't track them as standalone resources.

**Needed**: 
- `RegisterMCPServer()` in Context
- `synthesizeMCPServers()` outputs `mcpserver-N.pb`
- MCP servers can be shared across agents

### Gap 2: Skill Cannot Be Defined from Source (Local or Git)

**Current**: `skill.Parse()` and `skill.New()` only create references to existing skills (org/slug). No way to define skill content from source.

**Needed** (following Buf's input pattern):
- `skill.FromLocal(ctx, name, path)` - skill from local directory
- `skill.FromGit(ctx, name, url, opts...)` - skill from git repository
- Registers with Context
- Synthesis outputs skill metadata with source info
- CLI fetches content (using user's git credentials) and uploads artifact

**Proto Already Has This!** The `SkillSource` value object in `spec.proto`:
```proto
message SkillSource {
  oneof source {
    LocalSource local = 1;  // Local directory
    GitSource git = 2;      // Remote git repo
  }
}
```

### Gap 3: MCP Server Missing ToProto()

**Current**: `mcpserver` package returns `*mcpserverv1.McpServer` directly for some functions, but needs verification for standalone synthesis.

**Needed**: Ensure clean `ToProto()` pattern for synthesis.

---

## Implementation Phases

### Phase A: MCP Server Registration & Synthesis

**Goal**: MCP servers become first-class synthesized resources.

#### A1: Add RegisterMCPServer to Context ✅ COMPLETED
- [x] Add `mcpServers []*mcpserver.MCPServer` field to Context
- [x] Add `RegisterMCPServer(*mcpserver.MCPServer)` method
- [x] Add `MCPServers()` accessor method
- [x] Create `MCPServer` struct using **composition pattern** (embeds `Args *McpServerArgs`)
- [x] Implement `mcpserver.Stdio()` and `mcpserver.HTTP()` constructors with auto-registration
- [x] Implement `ToProto()` method reading from embedded Args
- [x] Add unit tests for constructors and ToProto
- [x] All 28 tests passing

**Architectural Note**: MCPServer uses the composition pattern (embedding Args) as the reference implementation. Agent and Workflow should be refactored to follow this pattern (see Backlog section).

#### A2: Add synthesizeMCPServers ✅ COMPLETED
- [x] Add `synthesizeMCPServers(outputDir string) error` to Context
- [x] Iterate registered MCP servers
- [x] Call `ToProto()` → serialize → write `mcpserver-N.pb`

#### A3: Verify MCPServer ToProto ✅ COMPLETED
- [x] `mcpserver` package has proper `ToProto()` method
- [x] Includes protovalidate validation
- [x] Includes SDK annotations

#### A4: Tests ✅ COMPLETED
- [x] Unit tests for Stdio() and HTTP() constructors
- [x] Unit tests for ToProto()
- [x] Unit tests for ServerType() and String()
- [x] Unit tests for slug generation
- [x] All tests passing

**Deliverable**: MCP servers are synthesized to `mcpserver-N.pb`.

---

### Phase B: Skill Source Definition & Synthesis

**Goal**: Skills can be defined from local directories OR git repositories, following Buf's input pattern.

#### Domain Model (Already in Proto!)

The proto already has the correct Value Object design:

```proto
message SkillSource {
  oneof source {
    LocalSource local = 1;   // Local directory
    GitSource git = 2;       // Remote git repository
  }
}
```

The SDK API should mirror this with explicit source methods.

#### B1: Skill Type Extension
- [ ] Create `Skill` struct in `skill/` package (not just reference)
- [ ] Fields: Name, Org, Source (Value Object)
- [ ] Distinguish between "reference" (existing skill) and "defined" (to be pushed)

#### B2: SkillSource Value Object
- [ ] Create `SkillSource` interface (sealed)
- [ ] Create `LocalSource` struct: `Path string`
- [ ] Create `GitSource` struct: `URL, Ref, Subdir string`
- [ ] Factory functions for each source type

#### B3: FromLocal Function
- [ ] Implement `skill.FromLocal(ctx, name, path string) (*Skill, error)`
- [ ] Validate path is non-empty (existence checked by CLI at resolution time)
- [ ] Create Skill with LocalSource
- [ ] Register with Context

#### B4: FromGit Function
- [ ] Implement `skill.FromGit(ctx, name, url string, opts ...GitOption) (*Skill, error)`
- [ ] Options: `skill.Ref("v1.0")`, `skill.Subdir("skills/coding")`
- [ ] Validate URL format
- [ ] Create Skill with GitSource
- [ ] Register with Context

#### B5: Add RegisterSkill to Context
- [ ] Add `skills []*skill.Skill` field to Context
- [ ] Add `RegisterSkill(*skill.Skill)` method

#### B6: Add synthesizeSkills
- [ ] Add `synthesizeSkills(outputDir string) error` to Context
- [ ] Output `skill-N.pb` with source metadata (not content - CLI fetches)
- [ ] CLI reads source info and fetches content using user's credentials

#### B7: Skill ToProto
- [ ] Add `ToProto() (*skillv1.Skill, error)` to Skill type
- [ ] Convert LocalSource → `skillv1.LocalSource`
- [ ] Convert GitSource → `skillv1.GitSource`
- [ ] Leave `skill_md` empty (CLI populates after fetching content)

#### B8: Tests
- [ ] Unit tests for FromLocal
- [ ] Unit tests for FromGit with options
- [ ] Unit tests for ToProto conversion
- [ ] Validation tests (empty path, invalid URL)

**SDK API Examples:**

```go
// Local directory (CLI auto-detects git info if in a repo)
codingSkill := skill.FromLocal(ctx, "coding-standards", "./skills/coding")

// Remote git repository (CLI uses user's git credentials)
securitySkill := skill.FromGit(ctx, "security-guidelines",
    "https://github.com/stigmer/skills",
    skill.Ref("v1.0"),           // optional: tag, branch, or commit
    skill.Subdir("security"),    // optional: subdirectory
)

// Attach to agent
myAgent.AddSkill(codingSkill)
myAgent.AddSkill(securitySkill)
```

**Separation of Concerns:**

| Concern | Who Handles |
|---------|-------------|
| Source Definition | SDK (this phase) |
| Content Fetching | CLI (uses git credentials) |
| Git Info Auto-Detection | CLI (for LocalSource) |
| Artifact Upload | CLI |
| Source Traceability | Backend (stores for reproducibility) |

**Deliverable**: `skill.FromLocal()` and `skill.FromGit()` work, skills synthesized with source metadata.

---

### Phase C: Unified Synthesis & Dependencies

**Goal**: Synthesis includes all 4 resource types with proper dependency tracking.

#### C1: Update Synthesize Method
- [ ] Call `synthesizeMCPServers()` in addition to agents/workflows
- [ ] Call `synthesizeSkills()` in addition to agents/workflows
- [ ] Order: skills → MCP servers → agents → workflows (dependency order)

#### C2: Update Dependency Tracking
- [ ] Track MCP server dependencies (agents depend on MCP servers)
- [ ] Track skill dependencies (agents depend on skills)
- [ ] Update `dependencies.json` format

#### C3: Backward Compatibility
- [ ] Ensure existing agent/workflow-only synthesis still works
- [ ] Add feature flag or auto-detection if needed

**Deliverable**: All 4 resource types synthesized with dependency graph.

---

### Phase D: Documentation & Examples

**Goal**: Update SDK documentation and examples.

#### D1: SDK README Updates
- [ ] Document all 4 resource types
- [ ] Show `skill.FromDir()` pattern
- [ ] Clarify `stigmer.yaml` + SDK relationship

#### D2: New Examples
- [ ] Example with MCP server shared across agents
- [ ] Example with local skill from directory
- [ ] Full example with all 4 resource types

**Deliverable**: Updated documentation and examples.

---

## Phase Dependencies

```
A1 → A2 → A3 → A4
          ↓
B1 → B2 → B3 → B4 → B5 → B6
                    ↓
               C1 → C2 → C3
                    ↓
               D1 → D2
```

Phases A and B can be done in parallel.

---

## Key Files to Modify

### Context (synthesis entry point)
- `sdk/go/stigmer/context.go`
  - Add `mcpServers` field
  - Add `skills` field
  - Add `RegisterMCPServer()`, `RegisterSkill()`
  - Add `synthesizeMCPServers()`, `synthesizeSkills()`
  - Update `synthesizeManifests()` to include all types

### MCP Server Package
- `sdk/go/mcpserver/mcpserver.go`
  - Verify/add `ToProto()` method
  - Update `Stdio()`, `HTTP()`, `Docker()` to register with Context

### Skill Package
- `sdk/go/skill/skill.go`
  - Add `Skill` struct (not just reference helpers)
  - Add `FromDir()` function
  - Add `ToProto()` method

---

## Success Criteria

| Criterion | Phase | Validation |
|-----------|-------|------------|
| MCP servers registered | A | `ctx.MCPServers()` returns list |
| MCP servers synthesized | A | `mcpserver-N.pb` files created |
| `skill.FromLocal()` works | B | Creates skill with LocalSource |
| `skill.FromGit()` works | B | Creates skill with GitSource + options |
| SkillSource ToProto works | B | Converts to `skillv1.SkillSource` correctly |
| Skills synthesized | B | `skill-N.pb` files with source metadata |
| All 4 types in synthesis | C | All `.pb` files in output |
| Dependencies correct | C | `dependencies.json` includes all types |
| Examples compile | D | All new examples work |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing synthesis | High | Maintain backward compatibility |
| Skill artifact format | Medium | Define clear manifest format |
| MCP server proto structure | Low | Pattern already exists in agent |

---

## Estimated Effort

| Phase | Tasks | Effort |
|-------|-------|--------|
| A: MCP Server | 4 | ~3-4 hours |
| B: Skill Source (Local + Git) | 8 | ~5-6 hours |
| C: Unified Synthesis | 3 | ~2-3 hours |
| D: Documentation | 2 | ~2 hours |
| **Total** | 17 | ~2 days |

---

## Backlog: SDK Resource Composition Refactoring

**Priority**: Medium
**Type**: Tech Debt
**Breaking**: Yes

### Context

During Phase A1 implementation, an architectural decision was made to use the **composition pattern** for MCPServer (embedding Args struct) rather than **field duplication** (copying fields from Args into the resource struct). This is the correct pattern that aligns with DDD principles and Pulumi's resource design.

### Current State (Technical Debt)

Agent and Workflow currently use the **duplication pattern**:

```go
// Current Agent pattern - DUPLICATES fields from Args
type Agent struct {
    Description  string  // DUPLICATED from AgentArgs
    Instructions string  // DUPLICATED from AgentArgs
    IconURL      string  // DUPLICATED from AgentArgs
    Name         string  // From constructor
    ctx          Context // Runtime
}
```

This violates DRY and creates maintenance burden when the generator changes.

### Correct Pattern (MCPServer reference implementation)

MCPServer uses the **composition pattern**:

```go
// MCPServer pattern - COMPOSES Args
type MCPServer struct {
    Name string          // From constructor
    Slug string          // From constructor
    Args *McpServerArgs  // Single source of truth for config
    ctx  Context         // Runtime
}
```

Benefits:
- Single source of truth (Args)
- Generator changes automatically propagate
- Access pattern: `server.Args.Description`
- Lower maintenance burden

### Tasks

- [ ] Refactor `Agent` struct to embed `Args *AgentArgs` instead of duplicating fields
- [ ] Update all access patterns from `agent.Description` to `agent.Args.Description`
- [ ] Update `Agent.ToProto()` to read from `Args`
- [ ] Update all Agent tests
- [ ] Refactor `Workflow` struct to embed `Args *WorkflowArgs` (if applicable)
- [ ] Update all Workflow tests
- [ ] Create migration guide for SDK users
- [ ] Consider semver major version bump (breaking change)

### Breaking Change Considerations

This is a **breaking API change** that affects:
- Direct field access: `agent.Description` → `agent.Args.Description`
- Constructor patterns may change
- All SDK users will need to update their code

### Migration Strategy

1. Release with deprecation warnings first (optional)
2. Provide automated migration script if possible
3. Document all breaking changes
4. Major version bump (e.g., v0.x → v1.0 or v1.x → v2.0)

---

## Review Checklist

- [ ] Project is NOT an SDK concept (defined in stigmer.yaml, assembled by CLI)
- [ ] SDK synthesizes all 4 resource types
- [ ] Context registers all resource types
- [ ] `skill.FromDir()` enables local skill definition
- [ ] MCP servers can be shared across agents
- [ ] Backward compatibility preserved
- [ ] Ready to start Phase A

**To approve**: Reply "Approved" or "Start Phase A"

---

*Created: 2026-02-05*
*Updated: 2026-02-05 (corrected architecture - Project is CLI concept, not SDK)*
*Status: Awaiting approval*
