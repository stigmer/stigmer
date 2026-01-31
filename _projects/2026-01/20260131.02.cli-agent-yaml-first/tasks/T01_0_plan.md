# Task T01: CLI Agent YAML-First - Complete Implementation Plan

**Created**: 2026-01-31
**Status**: PENDING REVIEW
**Type**: Refactoring / Architecture

⚠️ **This plan requires your review before execution**

## Executive Summary

Transform Stigmer CLI from an SDK-heavy architecture to a **YAML-first, agent-assisted** creation model:

1. **Agent** becomes YAML-first (like MCP Server)
2. **Workflow** remains SDK-only (justified by orchestration complexity)
3. **Agentic creation** replaces template-based `init` commands
4. **Separate run commands** for clarity (`agent run`, `workflow run`)

---

## Domain-Driven Design Analysis

### Resource Taxonomy (Final)

| Resource | Nature | Creation Method | Justification |
|----------|--------|-----------------|---------------|
| **Skill** | Artifact (file-based) | `stigmer skill push` | Content-addressable, versioned |
| **MCP Server** | Configuration Aggregate | `stigmer mcpserver apply` | Declarative, reusable |
| **Agent** | Configuration Aggregate | `stigmer agent apply` | Declarative, references Skills/MCP |
| **Workflow** | Orchestration Aggregate | `stigmer workflow apply` (SDK) | Procedural, implicit dependencies |

### Why This Design?

**Agent is declarative configuration:**
- References skills and MCP servers
- Has instructions (system prompt)
- Contains sub-agents with permission model
- **No flow control, no task dependencies**
- Can be fully expressed in YAML

**Workflow requires SDK:**
- Implicit dependency tracking via field references (`task.Field("x").Expression()`)
- Flow control (conditionals, loops, error handling)
- Type-safe task output references
- **Cannot be elegantly expressed in YAML**

---

## Target CLI Command Structure

```
stigmer
├── skill
│   ├── push <directory>              # Push skill artifact (existing)
│   ├── get <name-or-id>              # Get skill details
│   ├── list                          # List skills
│   ├── delete <name-or-id>           # Delete skill
│   └── create                        # Agentic skill creation ✨
│
├── mcpserver (alias: mcp)
│   ├── apply <file>                  # Apply MCP server from YAML (existing)
│   ├── get <name-or-id>              # Get MCP server (existing)
│   ├── list                          # List MCP servers
│   ├── delete <name-or-id>           # Delete MCP server (existing)
│   └── create                        # Agentic MCP server creation ✨
│
├── agent
│   ├── apply <file>                  # Apply agent from YAML ✨ NEW
│   ├── get <name-or-id>              # Get agent details ✨ NEW
│   ├── list                          # List agents ✨ NEW
│   ├── delete <name-or-id>           # Delete agent ✨ NEW
│   ├── create                        # Agentic agent creation ✨ NEW
│   └── run <slug>                    # Run agent ✨ NEW (moved from root)
│
├── workflow
│   ├── apply                         # SDK synthesis and deploy ✨ RENAMED
│   ├── get <name-or-id>              # Get workflow details
│   ├── list                          # List workflows
│   ├── delete <name-or-id>           # Delete workflow
│   ├── create                        # Agentic workflow creation ✨ NEW
│   └── run <slug>                    # Run workflow ✨ NEW (moved from root)
│
├── config                            # Configuration management (existing)
├── backend                           # Backend selection (existing)
└── server                            # Server management (existing)
```

**Removed from root:**
- `apply` → moved to `workflow apply`
- `run` → split into `agent run` and `workflow run`
- `new` → replaced by `create` subcommands (agentic, not template-based)

---

## Implementation Phases

### Phase 1: Agent YAML-First Foundation

**Goal**: Agent can be created and applied via YAML, matching MCP Server pattern.

#### T01.1: Agent YAML Loader Implementation
- [ ] Create `internal/cli/agent/loader.go` (mirror `mcpserver/loader.go` pattern)
- [ ] Define agent YAML schema validation
- [ ] Implement `LoadAgentFromFile()` function
- [ ] Support auto-discovery of `agent.yaml` or `AGENT.yaml`
- [ ] Parse to `agentv1.Agent` proto message

#### T01.2: Agent Apply Command
- [ ] Create `cmd/stigmer/root/agent.go` command group
- [ ] Implement `stigmer agent apply <file>` command
- [ ] Use existing `Apply` RPC for agents
- [ ] Match mcpserver apply UX (output, error handling)
- [ ] Add `--dry-run` flag for validation only

#### T01.3: Agent CRUD Commands
- [ ] Implement `stigmer agent get <name-or-id>`
- [ ] Implement `stigmer agent list`
- [ ] Implement `stigmer agent delete <name-or-id>`
- [ ] Ensure consistent output formatting with mcpserver

#### T01.4: Agent Run Command (Moved from Root)
- [ ] Move run logic to `stigmer agent run <slug>`
- [ ] Accept agent slug as positional argument
- [ ] Support `--message` flag for initial message
- [ ] Support `--env` flags for runtime variables
- [ ] Remove agent run from root `run` command

**Deliverable**: Users can create, apply, list, get, delete, and run agents via CLI.

---

### Phase 2: Workflow Command Restructuring

**Goal**: Workflow commands are explicit and SDK-only.

#### T02.1: Workflow Apply (SDK Synthesis)
- [ ] Rename/move `stigmer apply` to `stigmer workflow apply`
- [ ] Keep SDK synthesis behavior (runs Go code, reads .stigmer/)
- [ ] Update help text to clarify SDK-only nature
- [ ] Deprecation warning if called as `stigmer apply`

#### T02.2: Workflow Run Command
- [ ] Create `stigmer workflow run <slug>` command
- [ ] Accept workflow slug as positional argument
- [ ] Support workflow-specific flags (inputs, etc.)
- [ ] Remove workflow run from root `run` command

#### T02.3: Workflow CRUD Commands
- [ ] Implement `stigmer workflow get <name-or-id>`
- [ ] Implement `stigmer workflow list`
- [ ] Implement `stigmer workflow delete <name-or-id>`

**Deliverable**: Workflows have explicit namespace (`workflow apply/run/get/list/delete`).

---

### Phase 3: Remove Agent from SDK

**Goal**: SDK only contains Workflow. Agent is removed.

#### T03.1: SDK Agent Deprecation
- [ ] Add deprecation notice to `sdk/go/agent/agent.go`
- [ ] Document migration path (SDK agent → YAML agent)
- [ ] Update SDK README with new guidance

#### T03.2: SDK Agent Removal
- [ ] Remove `sdk/go/agent/` package
- [ ] Remove `sdk/go/subagent/` package (if agent-specific)
- [ ] Update `sdk/go/stigmer/context.go` to remove agent tracking
- [ ] Remove agent synthesis from `Synthesize()` method
- [ ] Update SDK examples (remove agent examples, keep workflow)

#### T03.3: CLI Apply Updates
- [ ] `workflow apply` no longer processes agents from SDK
- [ ] Error if SDK tries to create agents (with migration guidance)

**Deliverable**: SDK is workflow-only. Agent creation is YAML-only.

---

### Phase 4: Agentic Creation Commands

**Goal**: Users describe what they want, agents create the resources.

#### T04.1: Foundation Skills
Create skills that agents use to create resources:

- [ ] `stigmer/skill-creator` - Skill to create SKILL.md files
- [ ] `stigmer/agent-creator` - Skill to create agent.yaml files
- [ ] `stigmer/mcpserver-creator` - Skill to create mcpserver.yaml files
- [ ] `stigmer/workflow-creator` - Skill to create SDK workflow projects

#### T04.2: Creation Agent Definitions
Create agents that use the foundation skills:

- [ ] `stigmer/skill-creation-agent` - Agent using skill-creator
- [ ] `stigmer/agent-creation-agent` - Agent using agent-creator
- [ ] `stigmer/mcpserver-creation-agent` - Agent using mcpserver-creator
- [ ] `stigmer/workflow-creation-agent` - Agent using workflow-creator

#### T04.3: Create Commands Implementation
- [ ] `stigmer skill create` - Invokes skill-creation-agent
- [ ] `stigmer agent create` - Invokes agent-creation-agent
- [ ] `stigmer mcpserver create` - Invokes mcpserver-creation-agent
- [ ] `stigmer workflow create` - Invokes workflow-creation-agent

**Interaction Pattern:**
```
$ stigmer agent create
🤖 What kind of agent would you like to create?
> I want an agent that reviews code for security vulnerabilities

📋 Here's my plan:
  1. Create agent "security-reviewer" with instructions for vulnerability detection
  2. Add skills: stigmer/coding-best-practices, stigmer/security-analysis
  3. Configure MCP servers: stigmer/github (tools: search_code, create_pr)

Do you want me to proceed? [Y/n]
> Y

✅ Created agent.yaml at ./security-reviewer/agent.yaml
   Run: stigmer agent apply ./security-reviewer/agent.yaml
```

**Deliverable**: Users can create resources agentically via natural language.

---

### Phase 5: Cleanup and Documentation

#### T05.1: Remove Deprecated Commands
- [ ] Remove root `apply` command (now `workflow apply`)
- [ ] Remove root `run` command (now `agent run` / `workflow run`)
- [ ] Remove `new` command (replaced by `create` subcommands)

#### T05.2: Documentation Updates
- [ ] Update CLI README with new command structure
- [ ] Update SDK README (workflow-only)
- [ ] Create migration guide for existing SDK agent users
- [ ] Update examples and tutorials

#### T05.3: Testing
- [ ] Unit tests for agent YAML loader
- [ ] Integration tests for agent apply flow
- [ ] E2E tests for agentic creation commands
- [ ] Regression tests for workflow SDK flow

---

## Agent YAML Schema

Reference YAML format for `agent.yaml`:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: security-reviewer
  org: my-org                          # Optional, defaults to user's org
  visibility: PRIVATE                  # PUBLIC or PRIVATE
  description: Security-focused code reviewer
  tags:
    - security
    - code-review
spec:
  instructions: |
    You are a code reviewer specializing in security vulnerabilities.
    
    Focus on:
    - SQL injection
    - XSS vulnerabilities
    - Authentication bypass
    - Secrets exposure
    
    For each file, provide:
    1. List of vulnerabilities found
    2. Severity rating (Critical/High/Medium/Low)
    3. Remediation suggestions
  
  skills:
    - stigmer/coding-best-practices
    - stigmer/security-analysis
    - stigmer/owasp-top-10
  
  mcpServers:
    - ref: stigmer/github
      enabledTools:
        - search_code
        - create_pr
        - get_file_contents
      approvalOverrides:
        - tool: create_pr
          requiresApproval: true
          message: "Creating PR: {{args.title}}"
  
  subAgents:
    - name: codeql-scanner
      description: Deep analysis using CodeQL patterns
      instructions: |
        Perform deep security analysis using CodeQL patterns.
        Focus on data flow analysis and taint tracking.
      skills:
        - stigmer/codeql-patterns
      mcpAccess:
        - mcpServer: github
          enabledTools:
            - search_code        # Subset of parent's enabled tools
  
  envSpec:
    required:
      - name: GITHUB_TOKEN
        description: GitHub API token for repository access
    optional:
      - name: SEVERITY_THRESHOLD
        description: Minimum severity to report (default: Medium)
```

---

## Success Criteria

| Criterion | Validation |
|-----------|------------|
| Agent YAML apply works | `stigmer agent apply agent.yaml` creates agent |
| Agent run works | `stigmer agent run my-org/my-agent` executes agent |
| Workflow SDK-only | `stigmer workflow apply` runs SDK synthesis |
| Workflow run works | `stigmer workflow run my-org/my-workflow` executes |
| Agentic skill creation | `stigmer skill create` invokes agent, outputs SKILL.md |
| Agentic agent creation | `stigmer agent create` invokes agent, outputs agent.yaml |
| SDK agent removed | `sdk/go/agent/` package no longer exists |
| No root apply/run | Commands moved to resource subcommands |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing SDK agent users | Deprecation period + migration guide |
| Agentic creation quality | Iterate on skills, use HITL approval |
| YAML schema complexity | Start simple, add features incrementally |
| Command discovery | Clear help text, documentation |

---

## Open Questions

1. **Skill CRUD commands**: Should we add `stigmer skill get/list/delete`? (Currently only `push` exists)
2. **Backward compatibility period**: How long should we keep deprecated commands?
3. **Default agents**: Should we ship pre-made agents (skill-creation-agent, etc.) in a public org?

---

## Review Process

**What happens next**:
1. **You review this plan** - Consider the phases, priorities, and approach
2. **Provide feedback** - Share concerns, changes, or reordering
3. **I'll revise the plan** - Create T01_2_revised_plan.md with your feedback
4. **You approve** - Give explicit approval to proceed
5. **Execution begins** - Start with Phase 1

**Please consider**:
- Is the phase ordering correct?
- Should any phases be combined or split?
- Are there missing tasks?
- Do you want to start with a specific phase?
- Any concerns about the agentic creation approach?
