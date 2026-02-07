# Design Decision 001: Verb-First CLI Architecture

**Date**: 2026-02-07
**Status**: Approved
**Context**: CLI Commands Completion Project

## Decision

Adopt a **pure verb-first architecture** for all Stigmer CLI commands.

## Command Grammar

```
stigmer <verb> [type] [id/slug] [flags]
```

### Examples

```bash
# File-based (auto-detect kind from YAML)
stigmer apply -f agent.yaml
stigmer validate -f workflow.yaml

# Reference-based (type + id as separate arguments)
stigmer get agent abc123
stigmer get agent myorg/my-agent-slug
stigmer list agents
stigmer delete workflow def456

# Specialized verbs (same pattern)
stigmer run workflow abc123
stigmer push skill
stigmer search agents "query"
```

## Key Decisions

### 1. No Backward Compatibility Aliases

**Decision**: Do not create aliases for old resource-first commands.

**Rationale**: 
- Keeps codebase simple
- One way to do things
- Easier to maintain and document

**Implication**: Users must migrate to new command format.

### 2. Verb-First for ALL Commands

**Before**: `stigmer workflow run`, `stigmer skill push`
**After**: `stigmer run workflow`, `stigmer push skill`

**Rationale**:
- 100% consistency across all commands
- Same mental model for every operation
- Matches kubectl patterns

### 3. Type + ID as Separate Arguments

**Before**: `stigmer get agent/abc123`
**After**: `stigmer get agent abc123`

**Rationale**:
- More intuitive
- Slash in ID (org/slug format) doesn't create ambiguity
- Cleaner shell completion

### 4. Validation for Unsupported Verb+Type Combinations

**Example**:
```bash
$ stigmer run project abc123
Error: "run" is not supported for resource type "project"
Hint: "run" is available for: agent, workflow
```

**Rationale**:
- Clear feedback to users
- Extensible - add support for new combinations later
- Self-documenting via error messages

## Verb Support Matrix

| Verb | Agent | Workflow | Skill | MCP Server | Project |
|------|-------|----------|-------|------------|---------|
| apply | ✅ | ✅ | - | ✅ | - |
| validate | ✅ | ✅ | - | ✅ | ✅ |
| get | ✅ | ✅ | ✅ | ✅ | ✅ |
| list | ✅ | ✅ | ✅ | ✅ | ✅ |
| delete | ✅ | ✅ | ✅ | ✅ | ✅ |
| run | ✅ | ✅ | - | - | - |
| push | - | - | ✅ | - | - |
| search | ✅ | ✅ | - | - | - |

## Research Basis

Decision informed by [Deep Research Report](../research.cli-command-structure-patterns/04.report.gpt.md) analyzing:
- kubectl (Kubernetes)
- Terraform CLI
- AWS CLI
- gcloud (Google Cloud)
- gh (GitHub CLI)
- Pulumi CLI
- Docker/Podman CLI
- Helm CLI

Key finding: Tools with shared lifecycle verbs across many resource types (like Kubernetes) benefit from generic verb-first commands.

## Consequences

### Positive
- Scales to N resource types without command explosion
- Mixed-kind YAML apply supported (`apply -f ./manifests/`)
- Consistent user experience
- Simpler codebase (no alias management)

### Negative
- Breaking change from current resource-first commands
- Users must learn new command format
- Migration effort for existing scripts

### Neutral
- Need to implement type registry with verb support matrix
- Shell completion becomes dynamic based on type
