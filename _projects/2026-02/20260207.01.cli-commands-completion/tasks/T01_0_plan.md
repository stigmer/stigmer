# Task T01: CLI Commands Architecture & Implementation Plan

**Created**: 2026-02-07 11:31
**Updated**: 2026-02-07 (Final Revision - Verb-First Architecture)
**Status**: PENDING REVIEW
**Type**: Architectural Refactor + Feature Development

⚠️ **This revised plan requires your review before execution**

## Research Summary

Based on [Deep Research Report](../research.cli-command-structure-patterns/04.report.gpt.md) + user feedback:

> **Adopt a pure verb-first architecture: `stigmer <verb> <type> [id]` for ALL commands. No backward compatibility aliases. Clean, consistent, extensible.**

---

## Final Command Grammar

### Principle: 100% Verb-First

Every command follows the pattern:
```
stigmer <verb> [type] [id/slug] [flags]
```

### File-Based Commands (YAML kind auto-detection)

```bash
stigmer apply -f agent.yaml           # Detects kind: Agent
stigmer apply -f ./manifests/         # Applies all YAML in directory
stigmer validate -f workflow.yaml     # Detects kind: Workflow
```

### Reference-Based Commands (type + id as separate args)

```bash
stigmer get agent abc123              # Get by ID
stigmer get agent myorg/my-agent      # Get by org/slug
stigmer list agents                   # List all (pluralized type)
stigmer delete agent abc123           # Delete by ID
stigmer delete workflow myorg/my-wf   # Delete by org/slug
```

### Specialized Verbs (same verb-first pattern)

```bash
stigmer run agent abc123              # Run an agent
stigmer run workflow def456           # Run a workflow
stigmer push skill                    # Push skill (only skill for now)
stigmer test agent abc123             # Future: test an agent
```

### Validation for Unsupported Combinations

```bash
stigmer run project abc123
# Error: "run" is not supported for resource type "project"
# Supported resources for "run": agent, workflow

stigmer push agent abc123
# Error: "push" is not supported for resource type "agent"
# Supported resources for "push": skill
```

### Discoverability

```bash
stigmer resources                     # List all supported resource types
stigmer resources --wide              # Show kind, apiVersion, supported verbs
```

---

## Command Matrix

| Verb | Agent | Workflow | Skill | MCP Server | Project |
|------|-------|----------|-------|------------|---------|
| `apply -f` | ✅ | ✅ | - | ✅ | - |
| `validate -f` | ✅ | ✅ | - | ✅ | ✅ |
| `get <type> <id>` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `list <types>` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `delete <type> <id>` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `run <type> <id>` | ✅ | ✅ | - | - | - |
| `push <type>` | - | - | ✅ | - | - |
| `search <type>` | ✅ | ✅ | - | - | - |

**Legend:**
- ✅ = Supported
- `-` = Not applicable (validation error if attempted)

---

## Architecture Decisions

### Decision 1: No Backward Compatibility Aliases
**Rationale**: Keep codebase simple. Clean break. One way to do things.

### Decision 2: Type + ID as Separate Arguments (not slash-separated)
**Before**: `stigmer get agent/abc123`
**After**: `stigmer get agent abc123` or `stigmer get agent myorg/my-slug`

**Rationale**: More intuitive. Slash in the ID itself (org/slug) doesn't conflict.

### Decision 3: Verb-First for ALL Commands Including Specialized Verbs
**Before**: `stigmer workflow run`, `stigmer skill push`
**After**: `stigmer run workflow`, `stigmer push skill`

**Rationale**: 100% consistency. Same mental model for every command.

### Decision 4: Validation Errors for Unsupported Verb+Type Combinations
**Rationale**: Clear feedback. Extensible - add support later without grammar change.

---

## Implementation Strategy

### Phase 1: Foundation (T02)
**Type registry with verb support matrix**

1. Create resource type registry
2. Define which verbs each type supports
3. Implement YAML kind detection
4. Create reference parsing (id vs org/slug)

### Phase 2: Core Lifecycle Verbs (T03)
**Generic apply, validate, get, list, delete**

1. Implement `apply` - file-based, auto-detect kind
2. Implement `validate` - file-based, auto-detect kind  
3. Implement `get` - type + id/slug
4. Implement `list` - pluralized type
5. Implement `delete` - type + id/slug

### Phase 3: Specialized Verbs (T04)
**run, push, search with verb support validation**

1. Implement `run` - validates type supports run
2. Implement `push` - validates type supports push
3. Implement `search` - validates type supports search
4. Clear error messages for unsupported combinations

### Phase 4: Discoverability (T05)
**resources command**

1. Implement `resources` command
2. Show supported verbs per type in `--wide` output

### Phase 5: Fill Resource Gaps (T06)
**Complete handlers for all types**

1. Skill: get, list, delete handlers
2. MCP Server: validate, list handlers
3. Project: list handler

### Phase 6: Migration & Cleanup (T07)
**Remove old command structure**

1. Remove resource-specific command files (agent.go, workflow.go, etc.)
2. Update all documentation
3. Update shell completion

### Phase 7: Testing & Docs (T08)
**Integration testing and documentation**

1. Test all command combinations
2. Test validation error messages
3. Update CLI help text
4. Create migration guide for existing users

---

## Task Breakdown

### T01: Architecture & Design (Current)
- [x] Initial gap analysis
- [x] Deep research on CLI patterns
- [x] Define verb-first architecture
- [x] Incorporate user feedback (no aliases, separate args)
- [ ] **Await final approval**

### T02: Foundation - Type Registry
- [ ] Create `internal/cli/types/registry.go`
  - Resource type definitions
  - Verb support matrix per type
- [ ] Create `internal/cli/types/detection.go`
  - YAML kind detection
  - Multi-doc support
- [ ] Create `internal/cli/types/reference.go`
  - ID parsing
  - Org/slug parsing
- [ ] Write unit tests

### T03: Core Lifecycle Verbs
- [ ] Create `cmd/stigmer/root/apply.go`
- [ ] Create `cmd/stigmer/root/validate.go`
- [ ] Create `cmd/stigmer/root/get.go`
- [ ] Create `cmd/stigmer/root/list.go`
- [ ] Create `cmd/stigmer/root/delete.go`
- [ ] Create `internal/cli/generic/` handlers
- [ ] Wire up existing resource handlers
- [ ] Write unit tests

### T04: Specialized Verbs
- [ ] Create `cmd/stigmer/root/run.go`
  - Validate: only agent, workflow supported
- [ ] Create `cmd/stigmer/root/push.go`
  - Validate: only skill supported
- [ ] Create `cmd/stigmer/root/search.go`
  - Validate: only agent, workflow supported
- [ ] Implement verb support validation with clear errors
- [ ] Write unit tests

### T05: Discoverability
- [ ] Create `cmd/stigmer/root/resources.go`
- [ ] Show all resource types
- [ ] `--wide` flag shows supported verbs per type
- [ ] Shell completion for resource types

### T06: Fill Resource Gaps
- [ ] Implement Skill get/list/delete handlers
- [ ] Implement MCP Server validate handler
- [ ] Fix MCP Server list handler (currently stub)
- [ ] Implement Project list handler
- [ ] Register all in type registry

### T07: Migration & Cleanup
- [ ] Remove old resource-specific commands
  - Remove `agent.go`, `workflow.go`, `skill.go`, `mcpserver.go`, `project.go` command groups
- [ ] Update imports and registrations
- [ ] Verify no dead code

### T08: Testing & Docs
- [ ] Integration tests for all commands
- [ ] Test validation error messages
- [ ] Test mixed-kind directory apply
- [ ] Update help text
- [ ] Create changelog
- [ ] Create migration guide

---

## File Structure (Final)

```
client-apps/cli/
├── cmd/stigmer/root/
│   ├── root.go                     # Root command
│   │
│   │ # Core lifecycle verbs
│   ├── apply.go                    # stigmer apply -f
│   ├── validate.go                 # stigmer validate -f
│   ├── get.go                      # stigmer get <type> <id>
│   ├── list.go                     # stigmer list <types>
│   ├── delete.go                   # stigmer delete <type> <id>
│   │
│   │ # Specialized verbs
│   ├── run.go                      # stigmer run <type> <id>
│   ├── push.go                     # stigmer push <type>
│   ├── search.go                   # stigmer search <type> <query>
│   │
│   │ # Discoverability
│   └── resources.go                # stigmer resources
│
└── internal/cli/
    ├── types/
    │   ├── registry.go             # Resource types + verb support
    │   ├── detection.go            # YAML kind detection
    │   └── reference.go            # ID/slug parsing
    │
    ├── generic/
    │   ├── apply.go                # Generic apply logic
    │   ├── validate.go             # Generic validate logic
    │   ├── get.go                  # Generic get logic
    │   ├── list.go                 # Generic list logic
    │   ├── delete.go               # Generic delete logic
    │   ├── run.go                  # Generic run logic
    │   ├── push.go                 # Generic push logic
    │   └── search.go               # Generic search logic
    │
    └── handlers/
        ├── agent/                  # Agent-specific handlers
        ├── workflow/               # Workflow-specific handlers
        ├── skill/                  # Skill-specific handlers
        ├── mcpserver/              # MCP Server-specific handlers
        └── project/                # Project-specific handlers
```

---

## Success Criteria

1. **100% Verb-First**: Every command is `stigmer <verb> <type> [args]`
2. **No Aliases**: Single way to do each operation
3. **Clear Validation**: Unsupported verb+type → helpful error with suggestions
4. **Auto-Detection**: `apply`/`validate` detect kind from YAML
5. **Discoverability**: `stigmer resources` shows all types and supported verbs
6. **Build Passes**: `bazel build //client-apps/cli/...` succeeds
7. **Tests Pass**: Unit tests for all new functionality

---

## Example Session

```bash
# Apply resources
$ stigmer apply -f agent.yaml
Applied agent "myorg/my-agent" (created)

$ stigmer apply -f ./manifests/
Applied agent "myorg/agent-1" (created)
Applied workflow "myorg/workflow-1" (created)
Applied mcpserver "myorg/server-1" (updated)

# Get/List/Delete
$ stigmer get agent abc123
Name: my-agent
Org: myorg
...

$ stigmer list agents
NAME          ORG      CREATED
my-agent      myorg    2026-02-01
other-agent   myorg    2026-02-05

$ stigmer delete agent abc123
Deleted agent "abc123"

# Specialized verbs
$ stigmer run workflow myorg/my-workflow
Running workflow...

$ stigmer push skill
Pushing skill from current directory...

# Validation errors
$ stigmer run project abc123
Error: "run" is not supported for resource type "project"
Hint: "run" is available for: agent, workflow

# Discoverability
$ stigmer resources
TYPE         PLURAL       SUPPORTED VERBS
agent        agents       apply, validate, get, list, delete, run, search
workflow     workflows    apply, validate, get, list, delete, run, search
skill        skills       get, list, delete, push
mcpserver    mcpservers   apply, validate, get, list, delete
project      projects     validate, get, list, delete
```

---

## Review Checklist

**Please confirm:**
1. ✅ Verb-first for ALL commands (including run, push, etc.)
2. ✅ No backward compatibility aliases
3. ✅ Type + ID as separate arguments (not slash-separated)
4. ✅ Validation errors for unsupported verb+type combinations

**To approve**: Reply with "Approved" to begin implementation.

---

*Waiting for final approval before proceeding.*
