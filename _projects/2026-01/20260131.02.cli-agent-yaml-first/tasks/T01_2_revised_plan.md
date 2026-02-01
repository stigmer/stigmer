# Task T01: CLI Agent YAML-First - Revised Implementation Plan

**Created**: 2026-01-31
**Revised**: 2026-02-01
**Status**: AWAITING APPROVAL
**Type**: Refactoring / Architecture

---

## Executive Summary

Transform Stigmer CLI to a **YAML-first, agent-assisted** creation model:

1. **Agent** becomes YAML-first (like MCP Server)
2. **Workflow** remains SDK-only (justified by orchestration complexity)
3. **`draft` commands** replace template-based scaffolding (agent-assisted authoring)
4. **Search & Discover** enable resource exploration
5. **Platform Capabilities** embedded in CLI binary

---

## Key Changes from Original Plan

| Area | Original | Revised |
|------|----------|---------|
| Agentic creation verb | `create` | `draft` |
| Search | Not included | Per-resource `search` + root `discover` |
| Platform skills | External/fetched | Embedded via `go:embed` |
| Template cleanup | Implicit | Explicit phase |

---

## Domain Model

### Resource Taxonomy

| Resource | Nature | Creation Method | Justification |
|----------|--------|-----------------|---------------|
| **Skill** | Artifact (file-based) | `stigmer skill push` | Content-addressable, versioned |
| **MCP Server** | Configuration Aggregate | `stigmer mcpserver apply` | Declarative, reusable |
| **Agent** | Configuration Aggregate | `stigmer agent apply` | Declarative, references Skills/MCP |
| **Workflow** | Orchestration Aggregate | `stigmer workflow apply` (SDK) | Procedural, implicit dependencies |

### Platform Capabilities vs User Skills

| Category | Description | Location | Visibility |
|----------|-------------|----------|------------|
| **Platform Capabilities** | Core drafting functions | Embedded in CLI | NOT in `skill list` |
| **User Skills** | Domain knowledge artifacts | Registry (remote) | In `skill list` |

Platform capabilities are **core platform functions**, not user-space artifacts. They enable the platform itself.

---

## Target CLI Command Structure

```
stigmer
├── skill
│   ├── push <directory>              # Push skill artifact (existing)
│   ├── get <name-or-id>              # Get skill details
│   ├── list                          # List skills
│   ├── delete <name-or-id>           # Delete skill
│   ├── search <query>                # Search skills ✨ NEW
│   └── draft                         # Agent-assisted skill authoring ✨ NEW
│
├── mcpserver (alias: mcp)
│   ├── apply <file>                  # Apply MCP server from YAML (existing)
│   ├── get <name-or-id>              # Get MCP server (existing)
│   ├── list                          # List MCP servers
│   ├── delete <name-or-id>           # Delete MCP server (existing)
│   ├── search <query>                # Search MCP servers ✨ NEW
│   └── draft                         # Agent-assisted MCP server authoring ✨ NEW
│
├── agent
│   ├── apply <file>                  # Apply agent from YAML ✨ NEW
│   ├── get <name-or-id>              # Get agent details ✨ NEW
│   ├── list                          # List agents ✨ NEW
│   ├── delete <name-or-id>           # Delete agent ✨ NEW
│   ├── search <query>                # Search agents ✨ NEW
│   ├── run <slug>                    # Run agent ✨ NEW (moved from root)
│   └── draft                         # Agent-assisted agent authoring ✨ NEW
│
├── workflow
│   ├── apply                         # SDK synthesis and deploy ✨ RENAMED
│   ├── get <name-or-id>              # Get workflow details
│   ├── list                          # List workflows
│   ├── delete <name-or-id>           # Delete workflow
│   ├── search <query>                # Search workflows ✨ NEW
│   ├── run <slug>                    # Run workflow ✨ NEW (moved from root)
│   └── draft                         # Agent-assisted workflow scaffolding ✨ NEW
│
├── discover <query>                  # Cross-cutting resource discovery ✨ NEW
│
├── config                            # Configuration management (existing)
├── backend                           # Backend selection (existing)
└── server                            # Server management (existing)
```

**Removed from root:**
- `apply` → moved to `workflow apply`
- `run` → split into `agent run` and `workflow run`
- `new` → removed entirely, replaced by `draft` subcommands

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
- [ ] Update root `run` to show deprecation warning pointing to `agent run`

**Deliverable**: Users can create, apply, list, get, delete, and run agents via CLI.

---

### Phase 2: Workflow Command Restructuring

**Goal**: Workflow commands are explicit and SDK-only.

#### T02.1: Workflow Apply (SDK Synthesis)
- [ ] Rename/move `stigmer apply` to `stigmer workflow apply`
- [ ] Keep SDK synthesis behavior (runs Go code, reads .stigmer/)
- [ ] Update help text to clarify SDK-only nature
- [ ] Add deprecation warning if called as `stigmer apply` (point to `workflow apply`)

#### T02.2: Workflow Run Command
- [ ] Create `stigmer workflow run <slug>` command
- [ ] Accept workflow slug as positional argument
- [ ] Support workflow-specific flags (inputs, etc.)
- [ ] Update root `run` to detect workflow vs agent and route appropriately (transitional)

#### T02.3: Workflow CRUD Commands
- [ ] Implement `stigmer workflow get <name-or-id>`
- [ ] Implement `stigmer workflow list`
- [ ] Implement `stigmer workflow delete <name-or-id>`

**Deliverable**: Workflows have explicit namespace (`workflow apply/run/get/list/delete`).

---

### Phase 3: Search and Discovery

**Goal**: Users can find resources across the platform.

#### T03.1: Backend Search RPC Implementation
- [ ] Design `Search` RPC for skills (by name, description, tags)
- [ ] Design `Search` RPC for agents (by name, description, skills used)
- [ ] Design `Search` RPC for MCP servers (by name, description, tools)
- [ ] Design `Search` RPC for workflows (by name, description, tasks)
- [ ] Implement backend handlers for each Search RPC

#### T03.2: Per-Resource Search Commands
- [ ] Implement `stigmer skill search <query>`
- [ ] Implement `stigmer agent search <query>`
- [ ] Implement `stigmer mcpserver search <query>`
- [ ] Implement `stigmer workflow search <query>`
- [ ] Consistent output format: name, description, slug, relevance

#### T03.3: Cross-Cutting Discovery Command
- [ ] Implement `stigmer discover <query>`
- [ ] Query all resource types in parallel
- [ ] Return categorized results (Skills, Agents, MCP Servers, Workflows)
- [ ] Support `--type` flag to filter (e.g., `--type skill,agent`)

**Deliverable**: Users can search within resource types and discover across the platform.

---

### Phase 4: Remove Agent from SDK

**Goal**: SDK only contains Workflow. Agent is removed.

#### T04.1: SDK Agent Deprecation
- [ ] Add deprecation notice to `sdk/go/agent/agent.go`
- [ ] Document migration path (SDK agent → YAML agent)
- [ ] Update SDK README with new guidance

#### T04.2: SDK Agent Removal
- [ ] Remove `sdk/go/agent/` package
- [ ] Remove `sdk/go/subagent/` package (if agent-specific)
- [ ] Update `sdk/go/stigmer/context.go` to remove agent tracking
- [ ] Remove agent synthesis from `Synthesize()` method
- [ ] Update SDK examples (remove agent examples, keep workflow)

#### T04.3: CLI Apply Updates
- [ ] `workflow apply` no longer processes agents from SDK
- [ ] Error if SDK tries to create agents (with migration guidance)

**Deliverable**: SDK is workflow-only. Agent creation is YAML-only.

---

### Phase 5: Platform Capabilities (Draft Commands)

**Goal**: Users can author resources with agent assistance using embedded platform capabilities.

#### T05.1: Platform Capabilities Architecture
- [ ] Create `cli/embedded/capabilities/` directory structure
- [ ] Define capability interface in `internal/platform/capability.go`
- [ ] Implement `go:embed` loader for capabilities
- [ ] Create capability registry (skill-drafter, agent-drafter, etc.)

#### T05.2: Embedded Capability Definitions
Create platform capabilities (agent definitions + skills):

```
cli/embedded/capabilities/
├── skill-drafter/
│   ├── agent.yaml           # Agent definition for skill drafting
│   └── SKILL.md             # Instructions for drafting skills
├── agent-drafter/
│   ├── agent.yaml           # Agent definition for agent drafting
│   └── SKILL.md             # Instructions for drafting agents
├── mcpserver-drafter/
│   ├── agent.yaml           # Agent definition for MCP server drafting
│   └── SKILL.md             # Instructions for drafting MCP servers
└── workflow-drafter/
    ├── agent.yaml           # Agent definition for workflow scaffolding
    └── SKILL.md             # Instructions for drafting workflows
```

- [ ] Create skill-drafter capability (knows SKILL.md format, best practices)
- [ ] Create agent-drafter capability (knows agent.yaml schema, patterns)
- [ ] Create mcpserver-drafter capability (knows mcpserver.yaml schema)
- [ ] Create workflow-drafter capability (knows SDK patterns, scaffolding)

#### T05.3: Draft Commands Implementation
- [ ] Implement `stigmer skill draft` command
- [ ] Implement `stigmer agent draft` command
- [ ] Implement `stigmer mcpserver draft` command
- [ ] Implement `stigmer workflow draft` command

**Interaction Pattern:**
```
$ stigmer agent draft
🤖 What kind of agent would you like to create?
> I want an agent that reviews code for security vulnerabilities

📋 Here's my plan:
  - Name: security-reviewer
  - Purpose: Review code for security vulnerabilities
  - Skills: security-analysis, owasp-top-10
  - MCP Servers: github (search_code, get_file_contents)

Do you want me to draft this agent? [Y/n]
> Y

✅ Created agent.yaml at ./security-reviewer/agent.yaml

Next steps:
  1. Review and edit the generated file
  2. Apply with: stigmer agent apply ./security-reviewer/agent.yaml
```

#### T05.4: Draft Command UX Polish
- [ ] Interactive mode (default): conversational agent interaction
- [ ] Non-interactive mode (`--description "..."` flag): single-shot generation
- [ ] Output directory flag (`--output-dir`)
- [ ] Dry-run flag (`--dry-run`): show what would be created

**Deliverable**: Users can author resources through agent-assisted drafting.

---

### Phase 6: Cleanup and Documentation

**Goal**: Remove deprecated code, update documentation.

#### T06.1: Remove Deprecated Commands
- [ ] Remove root `apply` command (now `workflow apply`)
- [ ] Remove root `run` command (now `agent run` / `workflow run`)
- [ ] Remove `new` command entirely (replaced by `draft` subcommands)

#### T06.2: Remove Template Infrastructure
- [ ] Remove `sdk/go/templates/` directory
- [ ] Remove template loading code from CLI
- [ ] Remove any template-related utilities

#### T06.3: Documentation Updates
- [ ] Update CLI README with new command structure
- [ ] Update SDK README (workflow-only)
- [ ] Create migration guide: `stigmer new` → `stigmer <resource> draft`
- [ ] Create migration guide: SDK agent → YAML agent
- [ ] Update examples and tutorials

#### T06.4: Testing
- [ ] Unit tests for agent YAML loader
- [ ] Unit tests for platform capability loader
- [ ] Integration tests for agent apply flow
- [ ] Integration tests for draft commands
- [ ] E2E tests for search and discover
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

## Phase Summary

| Phase | Description | Key Deliverables |
|-------|-------------|------------------|
| **1** | Agent YAML-First Foundation | `agent apply/get/list/delete/run` commands |
| **2** | Workflow Command Restructuring | `workflow apply/run/get/list/delete` commands |
| **3** | Search and Discovery | `search` per resource + `discover` root command |
| **4** | Remove Agent from SDK | SDK is workflow-only |
| **5** | Platform Capabilities (Draft) | `draft` commands with embedded capabilities |
| **6** | Cleanup and Documentation | Remove deprecated code, update docs |

---

## Success Criteria

| Criterion | Validation |
|-----------|------------|
| Agent YAML apply works | `stigmer agent apply agent.yaml` creates agent |
| Agent run works | `stigmer agent run my-org/my-agent` executes agent |
| Workflow SDK-only | `stigmer workflow apply` runs SDK synthesis |
| Workflow run works | `stigmer workflow run my-org/my-workflow` executes |
| Skill search works | `stigmer skill search "security"` returns results |
| Discover works | `stigmer discover "code review"` returns categorized results |
| Skill draft works | `stigmer skill draft` invokes embedded capability |
| Agent draft works | `stigmer agent draft` outputs agent.yaml |
| SDK agent removed | `sdk/go/agent/` package no longer exists |
| Templates removed | `sdk/go/templates/` no longer exists |
| `stigmer new` removed | Command no longer available |
| No root apply/run | Commands moved to resource subcommands |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing SDK agent users | Deprecation period + migration guide |
| Draft quality variance | Iterate on embedded capability instructions |
| Search RPC complexity | Start with simple text search, add filters later |
| Command discovery | Clear help text, documentation |
| Embedded capability size | Monitor size, currently negligible (~100KB) |

---

## Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Command name for agentic creation | `draft` |
| Search scope | Per-resource `search` + root `discover` |
| Platform capabilities deployment | Embedded via `go:embed` |
| Template cleanup | Explicit removal in Phase 6 |

---

## Approval

**This plan is ready for your approval to begin execution.**

- [ ] Phase ordering is correct
- [ ] Scope is appropriate
- [ ] Ready to start Phase 1

**To approve**: Reply "Approved" or "Start Phase 1"

---

*Revised: 2026-02-01*
*Status: Awaiting approval*
