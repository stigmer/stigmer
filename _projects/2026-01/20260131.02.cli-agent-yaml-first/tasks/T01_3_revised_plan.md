# Task T01: CLI Agent YAML-First - Revised Implementation Plan v3

**Created**: 2026-01-31
**Revised**: 2026-02-01 (v3.1 - Qualified Slug Clarification)
**Status**: AWAITING APPROVAL
**Type**: Refactoring / Architecture

---

## Executive Summary

Transform Stigmer CLI to a **YAML-first, agent-assisted** creation model:

1. **Agent** becomes YAML-first (like MCP Server)
2. **Workflow** remains SDK-only (chosen for Go type safety and IDE support)
3. **`draft` commands** replace template-based scaffolding (agent-assisted authoring)
4. **Search & Discover** enable resource exploration
5. **Platform Capabilities** embedded in CLI binary

---

## Glossary (Ubiquitous Language)

| Term | Definition |
|------|------------|
| **Skill** | A reusable knowledge artifact (SKILL.md file) that provides domain expertise to agents. Content-addressable and versioned. |
| **MCP Server** | A Model Context Protocol server configuration that exposes tools (APIs/functions) to agents. Declarative YAML. |
| **Agent** | A configured AI assistant with instructions, skills, and MCP server access. Declarative YAML. Can contain sub-agents. |
| **Workflow** | An orchestrated sequence of tasks with dependencies, conditionals, and flow control. Requires Go SDK for type safety. |
| **Sub-Agent** | An agent definition embedded within a parent agent. Not an independent resource—lives inside parent's boundary. |
| **Platform Capability** | A core drafting function embedded in the CLI binary. Used by `draft` commands. Not visible in `skill list`. |
| **User Skill** | A skill created by users, stored in the registry. Visible in `skill list`. |
| **Name** | User-friendly display name. Mutable. Can contain spaces and capitals (e.g., `My Cool Agent`). |
| **Slug** | Immutable, URL-friendly identifier auto-generated from name. Lowercase, hyphens, no spaces (e.g., `my-cool-agent`). Unique within an org. Stored in backend. |
| **Qualified Slug** | User-facing reference format: `org/slug` (e.g., `stigmer/security-analysis`). Used in CLI commands and YAML references. If org omitted, defaults to current user's org. CLI resolves to org + slug for API calls. |
| **Apply** | Deploy a resource to the platform from a YAML file. Validates references. |
| **Draft** | Agent-assisted authoring that generates YAML files locally. |
| **Validate** | Check a YAML file for correctness without deploying. |

---

## Qualified Slug Resolution

The CLI uses **qualified slugs** (`org/slug`) for user-facing references while the backend stores `org_id` and `slug` separately.

### Resolution Rules

| User Input | Resolution | Example |
|------------|------------|---------|
| `org/slug` | Explicit org and slug | `stigmer/security-analysis` → org=`stigmer`, slug=`security-analysis` |
| `slug` (no `/`) | Uses current user's org | `security-analysis` → org=`<user's org>`, slug=`security-analysis` |

### CLI Examples

```bash
# User authenticated as member of org "acme"

# Get own resource (org defaults to "acme")
$ stigmer agent get my-agent
# → API: GetAgent(org="acme", slug="my-agent")

# Get resource from another org (explicit)
$ stigmer agent get stigmer/code-reviewer
# → API: GetAgent(org="stigmer", slug="code-reviewer")

# Run own agent
$ stigmer agent run security-reviewer
# → API: RunAgent(org="acme", slug="security-reviewer")

# Run public agent from stigmer org
$ stigmer agent run stigmer/general-assistant
# → API: RunAgent(org="stigmer", slug="general-assistant")
```

### YAML Reference Examples

```yaml
spec:
  skills:
    - security-analysis           # → Resolves to: <current org>/security-analysis
    - stigmer/coding-best-practices  # → Resolves to: stigmer/coding-best-practices
  
  mcpServers:
    - ref: github                 # → Resolves to: <current org>/github
    - ref: stigmer/github         # → Resolves to: stigmer/github (public MCP server)
```

### Implementation (CLI)

```go
// ParseQualifiedSlug splits a qualified slug into org and slug components
func ParseQualifiedSlug(input string, defaultOrg string) (org, slug string) {
    if idx := strings.Index(input, "/"); idx != -1 {
        return input[:idx], input[idx+1:]
    }
    return defaultOrg, input
}
```

**Note**: Backend API remains unchanged. CLI handles the translation from qualified slug to separate org + slug parameters.

---

## Aggregate Boundaries (MVP)

### Principle: References Are Strings, Validate at Apply Time

No magic. No cascades. No runtime reference checking. Simple and predictable.

### The Four Aggregates

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              RESOURCE GRAPH                                  │
│                                                                             │
│   ┌─────────┐         ┌─────────────┐         ┌──────────────┐             │
│   │  SKILL  │◄────────│    AGENT    │────────►│  MCP SERVER  │             │
│   │ (leaf)  │  refs   │             │  refs   │    (leaf)    │             │
│   └─────────┘         │  ┌───────┐  │         └──────────────┘             │
│                       │  │SubAgt │  │                                       │
│                       │  │(owned)│  │                                       │
│                       │  └───────┘  │                                       │
│                       └──────▲──────┘                                       │
│                              │ refs                                         │
│                       ┌──────┴──────┐                                       │
│                       │  WORKFLOW   │                                       │
│                       │  (SDK-only) │                                       │
│                       └─────────────┘                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Aggregate Definitions

| Aggregate | Owns (Inside Boundary) | References (Outside Boundary) |
|-----------|------------------------|-------------------------------|
| **Skill** | Content, metadata, tags | Nothing (leaf node) |
| **MCP Server** | Tools list, connection config | Nothing (leaf node) |
| **Agent** | Instructions, envSpec, subAgents | Skills (by slug), MCP Servers (by slug) |
| **Workflow** | Tasks, dependencies (in Go code) | Agents (by slug, if applicable) |

### Validation Strategy (MVP)

| When | What We Validate | If Invalid |
|------|------------------|------------|
| `agent apply` | Referenced skills exist | Error: `Skill 'org/name' not found` |
| `agent apply` | Referenced MCP servers exist | Error: `MCP Server 'org/name' not found` |
| `agent apply` | `enabledTools` are valid | **Skip for MVP** — MCP server errors at runtime |
| `agent run` | Everything still exists | Runtime error with clear message |
| `agent validate` | Same as apply, without deploying | Validation errors only |

### Reference Lifecycle (MVP)

| Action | Behavior | User Experience |
|--------|----------|-----------------|
| Delete Skill | Just delete | Agents referencing it fail on next `run` |
| Delete MCP Server | Just delete | Agents referencing it fail on next `run` |
| Delete Agent | Just delete | Workflows referencing it fail on next `run` |

**Rationale**: Simple to implement, predictable behavior, clear error messages. No hidden magic.

### Future Enhancements (Post-MVP)

- `--strict` flag for tool name validation at apply time
- `--check-references` flag for safe deletion with warnings
- Soft-delete with grace period
- Background job to detect broken references

---

## Error Taxonomy

Domain-specific errors that users will see. These should be clear and actionable.

### Validation Errors

| Error Code | Message Template | When |
|------------|------------------|------|
| `SKILL_NOT_FOUND` | `Skill '{slug}' not found. Check the skill exists: stigmer skill get {slug}` | Apply references non-existent skill |
| `MCP_SERVER_NOT_FOUND` | `MCP Server '{slug}' not found. Check the server exists: stigmer mcpserver get {slug}` | Apply references non-existent MCP server |
| `INVALID_YAML` | `Invalid YAML at line {line}: {detail}` | Malformed YAML syntax |
| `SCHEMA_VIOLATION` | `Invalid agent schema: {field} is required` | Missing required fields |
| `INVALID_SLUG` | `Invalid slug '{value}'. Expected format: org/name` | Malformed resource reference |

### Runtime Errors

| Error Code | Message Template | When |
|------------|------------------|------|
| `SKILL_DELETED` | `Skill '{slug}' was deleted. Update your agent.yaml and re-apply.` | Referenced skill no longer exists |
| `MCP_SERVER_DELETED` | `MCP Server '{slug}' was deleted. Update your agent.yaml and re-apply.` | Referenced MCP server no longer exists |
| `TOOL_NOT_FOUND` | `Tool '{tool}' not found on MCP Server '{server}'.` | MCP server doesn't expose requested tool |
| `PERMISSION_DENIED` | `You don't have access to '{slug}'. Contact the owner or use a public resource.` | Visibility/permission issue |

### CLI Errors

| Error Code | Message Template | When |
|------------|------------------|------|
| `FILE_NOT_FOUND` | `File not found: {path}` | apply/validate with missing file |
| `NOT_AUTHENTICATED` | `Not authenticated. Run: stigmer config auth` | API call without auth |
| `NETWORK_ERROR` | `Cannot reach Stigmer API. Check your connection.` | Network failure |

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
│   ├── validate <file>               # Validate without applying ✨ NEW
│   └── draft                         # Agent-assisted MCP server authoring ✨ NEW
│
├── agent
│   ├── apply <file>                  # Apply agent from YAML ✨ NEW
│   ├── get <name-or-id>              # Get agent details ✨ NEW
│   ├── list                          # List agents ✨ NEW
│   ├── delete <name-or-id>           # Delete agent ✨ NEW
│   ├── search <query>                # Search agents ✨ NEW
│   ├── run <slug>                    # Run agent ✨ NEW (moved from root)
│   ├── validate <file>               # Validate without applying ✨ NEW
│   └── draft                         # Agent-assisted agent authoring ✨ NEW
│
├── workflow
│   ├── apply                         # SDK synthesis and deploy ✨ RENAMED
│   ├── get <name-or-id>              # Get workflow details
│   ├── list                          # List workflows
│   ├── delete <name-or-id>           # Delete workflow
│   ├── search <query>                # Search workflows ✨ NEW
│   └── run <slug>                    # Run workflow ✨ NEW (moved from root)
│
├── discover <query>                  # Cross-cutting resource discovery ✨ NEW
│
├── config                            # Configuration management (existing)
├── backend                           # Backend selection (existing)
└── server                            # Server management (existing)
```

**New Commands Added:**
- `validate` subcommands for agent and mcpserver (check without deploying)

**Removed from root:**
- `apply` → moved to `workflow apply`
- `run` → split into `agent run` and `workflow run`
- `new` → removed entirely, replaced by `draft` subcommands

---

## Implementation Phases (Reordered)

### Phase 1: Agent YAML-First Foundation

**Goal**: Agent can be created and applied via YAML, matching MCP Server pattern.

#### T01.1: Qualified Slug Resolution Utility
- [ ] Create `internal/cli/slug/resolver.go`
- [ ] Implement `ParseQualifiedSlug(input, defaultOrg) (org, slug string)`
- [ ] Handle both `org/slug` and `slug` (defaults to user's org) formats
- [ ] Add unit tests for slug resolution

#### T01.2: Agent YAML Loader Implementation
- [ ] Create `internal/cli/agent/loader.go` (mirror `mcpserver/loader.go` pattern)
- [ ] Define agent YAML schema validation
- [ ] Implement `LoadAgentFromFile()` function
- [ ] Resolve qualified slugs in `skills` and `mcpServers` references
- [ ] Support auto-discovery of `agent.yaml` or `AGENT.yaml`
- [ ] Parse to `agentv1.Agent` proto message

#### T01.3: Agent Apply Command
- [ ] Create `cmd/stigmer/root/agent.go` command group
- [ ] Implement `stigmer agent apply <file>` command
- [ ] Use qualified slug resolver for skill/MCP server references
- [ ] Validate skill references exist (call Skill API with resolved org + slug)
- [ ] Validate MCP server references exist (call MCP Server API with resolved org + slug)
- [ ] Return domain-specific errors (see Error Taxonomy)
- [ ] Use existing `Apply` RPC for agents
- [ ] Match mcpserver apply UX (output, error handling)
- [ ] Add `--dry-run` flag for validation only

#### T01.4: Agent Validate Command
- [ ] Implement `stigmer agent validate <file>` command
- [ ] Same validation as apply, but no deployment
- [ ] Output: "✓ Valid" or list of errors
- [ ] Useful for CI/CD pipelines and pre-commit hooks

#### T01.5: Agent CRUD Commands
- [ ] Implement `stigmer agent get <qualified-slug>` (supports `org/slug` or `slug`)
- [ ] Implement `stigmer agent list`
- [ ] Implement `stigmer agent delete <qualified-slug>`
- [ ] Ensure consistent output formatting with mcpserver

#### T01.6: Agent Run Command (Moved from Root)
- [ ] Move run logic to `stigmer agent run <qualified-slug>`
- [ ] Accept qualified slug as positional argument (resolve org/slug)
- [ ] Support `--message` flag for initial message
- [ ] Support `--env` flags for runtime variables
- [ ] Update root `run` to show deprecation warning pointing to `agent run`

**Deliverable**: Users can create, apply, validate, list, get, delete, and run agents via CLI.

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

### Phase 3: Remove Agent from SDK (Before Draft Commands)

**Goal**: SDK only contains Workflow. Agent is removed. Clean foundation before building new features.

**Rationale**: Don't build new agentic creation (draft) on top of deprecated SDK patterns. Clean up first.

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

**Deliverable**: SDK is workflow-only. Agent creation is YAML-only. Clean slate for draft commands.

---

### Phase 4: Search and Discovery (Can Parallelize)

**Goal**: Users can find resources across the platform.

**Note**: This phase is independent of Phases 1-3 and can be worked on in parallel.

#### T04.1: Backend Search RPC Implementation
- [ ] Design `Search` RPC for skills (by name, description, tags)
- [ ] Design `Search` RPC for agents (by name, description, skills used)
- [ ] Design `Search` RPC for MCP servers (by name, description, tools)
- [ ] Design `Search` RPC for workflows (by name, description, tasks)
- [ ] Implement backend handlers for each Search RPC
- [ ] Start with simple text search (LIKE queries), optimize later

#### T04.2: Per-Resource Search Commands
- [ ] Implement `stigmer skill search <query>`
- [ ] Implement `stigmer agent search <query>`
- [ ] Implement `stigmer mcpserver search <query>`
- [ ] Implement `stigmer workflow search <query>`
- [ ] Consistent output format: name, description, slug, relevance

#### T04.3: Cross-Cutting Discovery Command
- [ ] Implement `stigmer discover <query>`
- [ ] Query all resource types in parallel
- [ ] Return categorized results (Skills, Agents, MCP Servers, Workflows)
- [ ] Support `--type` flag to filter (e.g., `--type skill,agent`)

**Deliverable**: Users can search within resource types and discover across the platform.

---

### Phase 5: Platform Capabilities (Draft Commands)

**Goal**: Users can author resources with agent assistance using embedded platform capabilities.

**Prerequisite**: Phase 3 complete (SDK agent removed). Building on clean foundation.

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
  2. Validate with: stigmer agent validate ./security-reviewer/agent.yaml
  3. Apply with: stigmer agent apply ./security-reviewer/agent.yaml
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
- [ ] Unit tests for agent validate command
- [ ] Unit tests for platform capability loader
- [ ] Integration tests for agent apply flow (with reference validation)
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
  name: Security Reviewer              # Display name (mutable, spaces allowed)
  # slug: security-reviewer            # Auto-generated from name (immutable)
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
  
  skills:                              # Qualified slugs (org/slug or just slug)
    - stigmer/coding-best-practices    # Public skill from stigmer org
    - stigmer/security-analysis        # Public skill from stigmer org
    - owasp-top-10                     # Own skill (org defaults to metadata.org)
  
  mcpServers:
    - ref: stigmer/github              # Qualified slug: stigmer org's github MCP
      enabledTools:
        - search_code
        - create_pr
        - get_file_contents
      approvalOverrides:
        - tool: create_pr
          requiresApproval: true
          message: "Creating PR: {{args.title}}"
  
  subAgents:
    - name: CodeQL Scanner             # Display name for sub-agent
      description: Deep analysis using CodeQL patterns
      instructions: |
        Perform deep security analysis using CodeQL patterns.
        Focus on data flow analysis and taint tracking.
      skills:
        - stigmer/codeql-patterns      # Qualified slug
      mcpAccess:
        - mcpServer: github            # References parent's MCP server (short name)
          enabledTools:
            - search_code              # Subset of parent's enabled tools
  
  envSpec:
    required:
      - name: GITHUB_TOKEN
        description: GitHub API token for repository access
    optional:
      - name: SEVERITY_THRESHOLD
        description: Minimum severity to report (default: Medium)
```

**Schema Notes:**
- `metadata.name`: User-friendly display name (can have spaces, capitals)
- `metadata.slug`: Auto-generated from name, immutable, not specified in YAML
- `spec.skills`: List of qualified slugs (`org/slug`) or short slugs (defaults to `metadata.org`)
- `spec.mcpServers[].ref`: Qualified slug for MCP server reference

---

## Phase Summary (Reordered)

| Phase | Description | Key Deliverables | Dependencies |
|-------|-------------|------------------|--------------|
| **1** | Agent YAML-First Foundation | `agent apply/validate/get/list/delete/run` | None |
| **2** | Workflow Command Restructuring | `workflow apply/run/get/list/delete` | None |
| **3** | Remove Agent from SDK | SDK is workflow-only | Phase 1 (migration path exists) |
| **4** | Search and Discovery | `search` + `discover` commands | None (parallelizable) |
| **5** | Platform Capabilities (Draft) | `draft` commands | Phase 3 (clean foundation) |
| **6** | Cleanup and Documentation | Remove deprecated, update docs | All phases |

**Parallelization Opportunity**: Phase 4 can run in parallel with Phases 1-3.

---

## Success Criteria

| Criterion | Validation |
|-----------|------------|
| Agent YAML apply works | `stigmer agent apply agent.yaml` creates agent |
| Agent validate works | `stigmer agent validate agent.yaml` checks without deploying |
| Reference validation works | Apply fails with clear error if skill/MCP server missing |
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
| Error messages are domain-specific | No raw RPC errors exposed to users |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing SDK agent users | Deprecation period + migration guide (Phase 3) |
| Draft quality variance | Iterate on embedded capability instructions |
| Search RPC complexity | Start with simple text search, add filters later |
| Command discovery | Clear help text, documentation |
| Embedded capability size | Monitor size, currently negligible (~100KB) |
| Reference validation performance | Batch API calls, cache org resources |

---

## Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Command name for agentic creation | `draft` |
| Search scope | Per-resource `search` + root `discover` |
| Platform capabilities deployment | Embedded via `go:embed` |
| Template cleanup | Explicit removal in Phase 6 |
| Aggregate boundaries | MVP: validate at apply, no cascade/block |
| Tool name validation | Skip for MVP, let MCP server error at runtime |
| Phase ordering | SDK removal (Phase 3) before draft commands (Phase 5) |
| Slug format | Backend stores `slug` (no org). CLI uses `org/slug` (qualified slug) for user-facing. CLI resolves to org + slug for API calls. No backend changes needed. |

---

## Approval

**This plan is ready for your approval to begin execution.**

- [ ] Glossary definitions are clear
- [ ] Aggregate boundaries are acceptable for MVP
- [ ] Error taxonomy covers key cases
- [ ] Phase ordering is correct (SDK removal before draft)
- [ ] Ready to start Phase 1

**To approve**: Reply "Approved" or "Start Phase 1"

---

*Revised: 2026-02-01 (v3.1 - Qualified Slug Clarification)*
*Status: Awaiting approval*
