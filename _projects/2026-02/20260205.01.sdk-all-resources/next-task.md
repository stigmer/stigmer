# Next Task: 20260205.01.sdk-all-resources

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: SDK All Resources

**Description**: Extend Stigmer SDK to synthesize all 4 resource types (Agent, Workflow, Skill, MCP Server) for CLI-assembled Project reconciliation.

**Key Architecture Point**: 
- **Project is NOT an SDK concept** - defined in `stigmer.yaml`, assembled by CLI
- SDK synthesizes resources → CLI combines with `stigmer.yaml` → Project Apply API

**Tech Stack**: Go SDK

**Components**: 
- Go SDK: `/Users/suresh/scm/github.com/stigmer/stigmer/sdk/go`
- Context: `/Users/suresh/scm/github.com/stigmer/stigmer/sdk/go/stigmer/context.go`

---

## Current Status

**Phase**: Phase A - MCP Server Registration & Synthesis
**Status**: ✅ **COMPLETED** (Phase A1-A4)

**Last Session**: February 6, 2026 - Implemented MCPServer with composition pattern

---

## Session Progress (2026-02-06)

### ✅ Completed: Phase A1-A4

**Implemented MCP Server registration and synthesis with architectural improvement:**

1. **Created MCPServer Type** (`sdk/go/mcpserver/server.go`, 232 lines)
   - Uses **composition pattern** (embeds Args, not duplicates fields)
   - `Stdio()` and `HTTP()` constructors with auto-registration
   - Full validation and slug generation

2. **Created Proto Conversion** (`sdk/go/mcpserver/proto.go`, 191 lines)
   - `ToProto()` reads from embedded Args (single source of truth)
   - Protovalidate integration
   - SDK annotations for tracking

3. **Updated Context** (`sdk/go/stigmer/context.go`, +77 lines)
   - Added `mcpServers` field
   - Implemented `RegisterMCPServer()` and `MCPServers()` methods
   - Added `synthesizeMCPServers()` for output generation

4. **Test Coverage** (564 lines of tests)
   - 28 tests total, all passing
   - Constructor validation tests
   - Proto conversion tests
   - Edge case coverage

### 🎯 Key Architectural Decision

**Composition Over Duplication**: MCPServer establishes the correct pattern for SDK resources:

```go
// CORRECT (MCPServer) - Composition
type MCPServer struct {
    Name string          // Identity
    Slug string          // Identity
    Args *McpServerArgs  // Single source of truth
    ctx  Context         // Runtime
}

// INCORRECT (Agent/Workflow) - Duplication
type Agent struct {
    Name        string
    Description string  // DUPLICATED from Args
    // ... more duplicated fields
}
```

### 📝 Backlog Added

Documented comprehensive plan for refactoring Agent and Workflow to use composition pattern (breaking change, requires major version bump).

---

## Architecture

```
stigmer.yaml          +        main.go (SDK)
(project metadata)             (resource definitions)
       │                              │
       │                              ▼
       │                     .stigmer/ output:
       │                     ├── agent-N.pb
       │                     ├── workflow-N.pb
       │                     ├── mcpserver-N.pb  ✅ NOW SYNTHESIZED
       │                     ├── skill-N.pb      ← NEXT (Phase B)
       │                     └── dependencies.json
       │                              │
       └──────────────┬───────────────┘
                      ▼
              stigmer apply (CLI)
              Assembles Project proto
                      │
                      ▼
              Backend Project Apply API
              Reconciliation + Pruning
```

---

## Gap Summary

| Resource | Registered | Synthesized | Status |
|----------|-----------|-------------|--------|
| Agent | ✅ Yes | ✅ Yes | Complete |
| Workflow | ✅ Yes | ✅ Yes | Complete |
| MCP Server | ✅ Yes | ✅ Yes | ✅ **DONE** (Phase A) |
| Skill | ❌ No | ❌ No | **Phase B** (Next) |

---

## Implementation Phases

| Phase | Description | Status | Effort |
|-------|-------------|--------|--------|
| **A** | MCP Server Registration & Synthesis | ✅ **DONE** | 3-4 hours |
| **B** | Skill FromLocal & FromGit | 🔜 **NEXT** | 5-6 hours |
| **C** | Unified Synthesis & Dependencies | ⏳ Pending | 2-3 hours |
| **D** | Documentation & Examples | ⏳ Pending | 2 hours |

**Progress**: 1/4 phases complete (~25%)

---

## Next Steps

### Immediate: Phase B - Skill Source Definition

Implement Skill resource following the MCPServer composition pattern:

1. **B1**: Create `Skill` struct in `skill/` package
   ```go
   type Skill struct {
       Name   string
       Slug   string
       Args   *SkillArgs  // Composition pattern
       ctx    Context
   }
   ```

2. **B2**: Implement `SkillSource` Value Object
   - `LocalSource`: Path string
   - `GitSource`: URL, Ref, Subdir

3. **B3**: Implement `skill.FromLocal(ctx, name, path)`
   - Validate path (existence checked by CLI)
   - Register with Context

4. **B4**: Implement `skill.FromGit(ctx, name, url, opts...)`
   - Options: `skill.Ref("v1.0")`, `skill.Subdir("skills/")`
   - Validate URL format
   - Register with Context

5. **B5-B7**: Context integration and synthesis
   - Add `RegisterSkill()` to Context
   - Add `synthesizeSkills()` for output
   - Implement `ToProto()` conversion

**User API Example**:
```go
// Local directory
codingSkill := skill.FromLocal(ctx, "coding-standards", "./skills/coding")

// Remote git repository
securitySkill := skill.FromGit(ctx, "security-guidelines",
    "https://github.com/stigmer/skills",
    skill.Ref("v1.0"),
    skill.Subdir("security"),
)
```

---

## Context for Resume

### Files Modified This Session
- Created: `sdk/go/mcpserver/server.go`, `proto.go`, `server_test.go`, `proto_test.go`
- Modified: `sdk/go/stigmer/context.go`, project plan
- Total: ~987 new lines, ~199 modified lines

### Key Findings
1. **Composition is superior** to field duplication for maintainability
2. **Protovalidate** catches errors early in ToProto()
3. **Mock interfaces** enable clean unit testing without dependencies
4. Agent/Workflow need refactoring (documented in backlog)

### Important Context
- MCPServer serves as **reference implementation** for Skill
- Same composition pattern should be used
- Test coverage is critical (28 tests, all passing)
- Proto conversion must read from Args (single source of truth)

---

## Blockers

None currently. Ready to proceed with Phase B.

---

## Quick Resume

To continue Phase B (Skill implementation), drag this file into chat:
```
@_projects/2026-02/20260205.01.sdk-all-resources/next-task.md
```

Then say: "Start Phase B - implement Skill resource"

---

## Key Files to Modify Next (Phase B)

1. **Skill Package** (new)
   - `sdk/go/skill/skill.go` - Skill struct and constructors
   - `sdk/go/skill/source.go` - SkillSource value objects
   - `sdk/go/skill/proto.go` - ToProto() conversion
   - `sdk/go/skill/skill_test.go` - Unit tests

2. **Context** (`sdk/go/stigmer/context.go`)
   - Add `skills` field
   - Add `RegisterSkill()` method
   - Add `synthesizeSkills()` method
   - Update `synthesizeManifests()` to include skills

---

## Project Folders

```
_projects/2026-02/20260205.01.sdk-all-resources/
├── README.md
├── next-task.md (this file)
├── tasks/
│   └── T01_0_plan.md (updated with Phase A completion)
├── checkpoints/
├── design-decisions/
├── coding-guidelines/
├── wrong-assumptions/
└── dont-dos/
```

---

## Related Changelog

See: `_changelog/2026-02/2026-02-06-125018-sdk-mcpserver-composition-pattern.md`

---

*Last Updated: 2026-02-06 (Phase A Complete)*
*Next Session: Phase B - Skill Source Definition*
