# Design Decision 001: Agent as YAML-First Resource

**Date**: 2026-01-31
**Status**: Proposed
**Deciders**: Suresh, AI Architect

## Context

The Stigmer platform has four core resources:
1. **Skill** - Artifact (file-based, versioned)
2. **MCP Server** - Configuration aggregate
3. **Agent** - Configuration aggregate (currently SDK-based)
4. **Workflow** - Orchestration aggregate

Currently, Agent and Workflow are both created via SDK (Go code with synthesis). The question arose: **Should Agent remain SDK-based, or move to YAML-first like MCP Server?**

## Decision Drivers

1. **Onboarding friction**: Users want to quickly create agents without scaffolding Go projects
2. **Agent-assisted creation**: We want agents to create other agents (outputting YAML is trivial, outputting Go code is complex)
3. **Domain modeling accuracy**: Agent is fundamentally declarative, Workflow is procedural
4. **Maintenance burden**: SDK is expensive to maintain across multiple languages

## Considered Options

### Option 1: Keep Agent in SDK (Status Quo)

**Pros:**
- Consistent with Workflow
- Type-safe validation at compile time
- IDE support for discovering methods

**Cons:**
- High friction for simple agent creation
- Blocks agent-assisted creation pattern
- Over-engineering for a declarative resource

### Option 2: Agent YAML-First (Selected)

**Pros:**
- Low friction (edit YAML, `stigmer agent apply`)
- Enables agent-assisted creation
- Matches domain reality (Agent is configuration, not orchestration)
- Consistent with MCP Server pattern

**Cons:**
- Two creation patterns in CLI (YAML for Agent, SDK for Workflow)
- Migration required for existing SDK agent users

### Option 3: Both YAML and SDK for Agent

**Pros:**
- Maximum flexibility
- No breaking changes

**Cons:**
- Maintenance burden (two paths)
- Confusing for users
- Violates "one obvious way to do it"

## Decision

**Option 2: Agent becomes YAML-First**

Agent moves out of SDK and into YAML/CLI pattern alongside MCP Server. Workflow remains SDK-only.

## Rationale

### Domain Analysis

| Dimension | Agent | Workflow |
|-----------|-------|----------|
| **Nature** | Declarative configuration | Procedural orchestration |
| **Dependencies** | Static references | Dynamic implicit dependencies |
| **Flow Control** | None | Conditionals, loops, error handling |
| **Complexity** | Configuration breadth | Logic depth |

Agent can be fully expressed in YAML:
```yaml
spec:
  instructions: "You are a code reviewer..."
  skills:
    - stigmer/security-analysis
  mcpServers:
    - ref: stigmer/github
      enabledTools: [search_code]
```

Workflow requires SDK for implicit dependency tracking:
```go
fetch := wf.HttpGet("fetch", "https://api.example.com/data")
process := wf.Set("process", map[string]string{
    "data": fetch.Field("body").Expression(),  // Implicit dependency!
})
```

### Agent-Assisted Creation Pattern

With Agent as YAML-first:
1. User runs `stigmer agent create`
2. Agent generates `agent.yaml`
3. User runs `stigmer agent apply agent.yaml`

This virtuous cycle cannot work if Agent creation requires Go code.

## Consequences

### Positive
- Users can create agents quickly via YAML
- Agents can create other agents (output YAML)
- Clearer mental model (YAML = config, SDK = orchestration)
- Reduced SDK maintenance burden

### Negative
- Breaking change for existing SDK agent users
- Need migration guide and deprecation period
- Two creation patterns (acceptable given domain differences)

## Migration Path

1. Add `stigmer agent apply` command
2. Add deprecation notice to SDK agent package
3. Provide migration guide (SDK agent → YAML agent)
4. Remove SDK agent package after deprecation period

## References

- Pulumi resource model (SDK for infrastructure orchestration)
- Kubernetes (YAML for declarative configuration)
- Claude Code (agents creating agents via text output)
