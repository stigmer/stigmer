# Task T01: CLI Unified Architecture - Revised Implementation Plan v4

**Created**: 2026-02-03
**Status**: PROPOSED
**Type**: Architecture Revision
**Supersedes**: T01_3_revised_plan.md (YAML-First approach)
**Based On**: ADR-005 (Unified Resource Management & Project-Based Reconciliation)

---

## Executive Summary

This plan adopts **ADR-005's Dual-Track Interface** architecture, replacing the previous "Agent YAML-only" approach with a unified model where:

1. **Atomic Track** (Kubernetes-style): Quick experiments via YAML for ALL resources
2. **Project Track** (Pulumi-style): Production lifecycle with SDK synthesis and reconciliation

**Key Changes from Previous Plan:**
- ❌ **CANCELLED**: "Remove Agent from SDK" (Phase 3 of old plan)
- ✅ **NEW**: Add Workflow YAML support (consistency with Agent/MCP Server)
- ✅ **NEW**: Implement Project entity for reconciliation
- ✅ **PRESERVED**: Phase 1-2 work (Agent YAML + Workflow commands) = Atomic Track foundation

---

## Architecture Overview

```
                              stigmer CLI
                                   │
             ┌─────────────────────┴─────────────────────┐
             │                                           │
     ATOMIC TRACK                               PROJECT TRACK
     (Quick experiments)                        (Production lifecycle)
             │                                           │
     ┌───────┴────────┐                         ┌───────┴────────┐
     │                │                         │                │
     │ Resource YAML  │                         │ stigmer apply  │
     │ Commands:      │                         │                │
     │                │                         │ Reads:         │
     │ agent apply    │                         │ stigmer.yaml   │
     │ workflow apply │ ◄─── NEW                │                │
     │ mcpserver apply│                         │ Runs:          │
     │ skill push     │                         │ SDK entrypoint │
     │                │                         │ (main.go)      │
     │ No state       │                         │                │
     │ No pruning     │                         │ Synthesizes    │
     │                │                         │ Diffs state    │
     └────────────────┘                         │ Reconciles     │
                                                │ PRUNES orphans │
                                                └────────────────┘
```

---

## Glossary (Updated Ubiquitous Language)

| Term | Definition |
|------|------------|
| **Atomic Track** | Kubernetes-style imperative commands for individual resources. No state tracking. Fast experiments. |
| **Project Track** | Pulumi-style declarative management. SDK synthesis with state reconciliation. Production use. |
| **Project** | Aggregate root entity representing a collection of managed resources. Owns the reconciliation boundary. |
| **Synthesis** | Running SDK code to generate the Desired State Graph of all resources. |
| **Reconciliation** | Comparing Desired State vs Actual State and applying changes (create/update/delete). |
| **Pruning** | Automatic deletion of orphaned resources that were removed from the Project. |
| **Desired State Graph** | The complete set of resources defined in SDK code after synthesis. |
| **Artifact Resolution** | Automatic handling of local references (e.g., `Skill.FromDir("./docs")`) during synthesis. |

---

## Current Progress Assessment

| Phase | Old Plan | Status | ADR-005 Impact |
|-------|----------|--------|----------------|
| **1** | Agent YAML-First | ✅ DONE | **PRESERVED** - This IS the Atomic Track |
| **2** | Workflow Commands | ✅ DONE | **PRESERVED** - Commands work for both tracks |
| **3** | Remove Agent from SDK | ⏸️ PENDING | **CANCELLED** - SDK is Universal |
| **4** | Search & Discovery | ⏸️ PENDING | **DEFERRED** - Lower priority |
| **5** | Platform Capabilities | ⏸️ PENDING | **DEFERRED** - Lower priority |
| **6** | Cleanup | ⏸️ PENDING | **REVISED** - Different scope |

---

## Revised Phase Structure

### Phase Overview

| Phase | Description | Priority | Dependencies |
|-------|-------------|----------|--------------|
| **3** | Workflow YAML-First (Atomic Track completion) | HIGH | Phase 2 |
| **4** | Project Entity & stigmer.yaml | HIGH | Phase 3 |
| **5** | SDK Unification (All resources in SDK) | HIGH | Phase 4 |
| **6** | Project Reconciliation (Pruning) | HIGH | Phase 5 |
| **7** | Search & Discovery | MEDIUM | None (parallelizable) |
| **8** | Platform Capabilities (Draft) | MEDIUM | Phase 6 |
| **9** | Documentation & Cleanup | LOW | All phases |

---

## Phase 3: Workflow YAML-First (NEW)

**Goal**: Complete the Atomic Track by adding YAML support for Workflows.

**Rationale**: ADR-005's Dual-Track model requires consistent UX across all resources. Currently, Workflow is the only resource without YAML support, creating fragmented developer experience.

### Workflow YAML Schema

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: Code Review Pipeline        # Display name
  # slug: code-review-pipeline      # Auto-generated
  org: my-org
  visibility: PRIVATE
  description: Automated code review workflow
  tags:
    - code-review
    - automation

spec:
  # Input parameters for the workflow
  inputs:
    - name: repo
      type: string
      description: Repository name (owner/repo)
      required: true
    - name: pr_number
      type: integer
      description: Pull request number
      required: true

  # Environment variables required at runtime
  envSpec:
    required:
      - name: GITHUB_TOKEN
        description: GitHub API token

  # Task definitions with explicit dependencies
  tasks:
    - name: fetch-pr-details
      type: http_get
      config:
        url: "https://api.github.com/repos/{{ inputs.repo }}/pulls/{{ inputs.pr_number }}"
        headers:
          Authorization: "Bearer {{ env.GITHUB_TOKEN }}"

    - name: fetch-pr-files
      type: http_get
      dependsOn: [fetch-pr-details]
      config:
        url: "{{ tasks.fetch-pr-details.output.body._links.self.href }}/files"
        headers:
          Authorization: "Bearer {{ env.GITHUB_TOKEN }}"

    - name: analyze-code
      type: agent_call
      dependsOn: [fetch-pr-files]
      config:
        agent: stigmer/code-reviewer    # Qualified slug reference
        message: |
          Review the following PR files for security and code quality:
          {{ tasks.fetch-pr-files.output.body | json }}

    - name: post-review
      type: http_post
      dependsOn: [analyze-code]
      config:
        url: "https://api.github.com/repos/{{ inputs.repo }}/pulls/{{ inputs.pr_number }}/reviews"
        headers:
          Authorization: "Bearer {{ env.GITHUB_TOKEN }}"
        body:
          event: "COMMENT"
          body: "{{ tasks.analyze-code.output.response }}"

  # Output mapping
  outputs:
    - name: review_id
      value: "{{ tasks.post-review.output.body.id }}"
    - name: analysis
      value: "{{ tasks.analyze-code.output.response }}"
```

### Task Types (Initial Set)

| Type | Description | Config Fields |
|------|-------------|---------------|
| `http_get` | HTTP GET request | url, headers, query |
| `http_post` | HTTP POST request | url, headers, body |
| `agent_call` | Invoke an agent | agent (slug), message, env |
| `workflow_call` | Invoke another workflow | workflow (slug), inputs |
| `set` | Set a value | value (expression) |
| `condition` | Conditional branching | if, then, else |

### Expression Syntax

```
{{ inputs.param_name }}           # Input parameter
{{ env.VAR_NAME }}                # Environment variable
{{ tasks.task_name.output.* }}    # Task output reference
{{ tasks.task_name.status }}      # Task status (success/failed)
```

### Sub-tasks

#### T03.1: Workflow YAML Schema Definition
- [ ] Define workflow YAML schema in proto (if needed) or as JSON schema
- [ ] Document task types and their configurations
- [ ] Document expression syntax and available variables
- [ ] Add proto validation rules for workflow YAML

#### T03.2: Workflow YAML Loader
- [ ] Create `internal/cli/workflow/loader.go` (mirror agent loader pattern)
- [ ] Implement `LoadWorkflowFromFile()` function
- [ ] Support auto-discovery of `workflow.yaml` or `WORKFLOW.yaml`
- [ ] Parse to appropriate proto message
- [ ] Validate task dependencies form a DAG (no cycles)
- [ ] Resolve qualified slugs in agent/workflow references

#### T03.3: Workflow YAML Validator
- [ ] Create `internal/cli/workflow/validator.go`
- [ ] Validate task dependency graph (topological sort)
- [ ] Validate expression syntax
- [ ] Validate referenced agents exist (at apply time)
- [ ] Validate referenced workflows exist (at apply time)
- [ ] Cross-field validation (inputs used correctly, etc.)

#### T03.4: Workflow Apply Command (YAML)
- [ ] Create `cmd/stigmer/root/workflow_apply.go`
- [ ] Implement `stigmer workflow apply <file.yaml>`
- [ ] Use existing workflow internal package infrastructure
- [ ] Match agent apply UX exactly
- [ ] Add `--dry-run` flag for validation only

#### T03.5: Workflow Validate Command
- [ ] Create `cmd/stigmer/root/workflow_validate.go`
- [ ] Implement `stigmer workflow validate <file.yaml>`
- [ ] Same validation as apply, no deployment
- [ ] CI-friendly exit codes

#### T03.6: Backend Support (If Needed)
- [ ] Assess if existing `WorkflowCommandController.Apply` can accept YAML-derived workflows
- [ ] If not, add support for declarative workflow definitions
- [ ] Ensure YAML-defined workflows can be executed via `stigmer workflow run`

**Deliverable**: `stigmer workflow apply workflow.yaml` works, completing Atomic Track parity.

---

## Phase 4: Project Entity & stigmer.yaml

**Goal**: Introduce the Project aggregate root for resource lifecycle management.

### The stigmer.yaml Manifest

```yaml
apiVersion: v1
kind: Project
metadata:
  name: my-super-app              # Project name (reconciliation namespace)
  org: my-org                     # Organization

spec:
  runtime: go                     # go | python | node
  entryPoint: main.go             # SDK entry point for synthesis
  
  # Optional: explicit resource includes (if not using SDK synthesis)
  resources:
    - path: ./agents/*.yaml
    - path: ./workflows/*.yaml
    - path: ./mcpservers/*.yaml
```

### Sub-tasks

#### T04.1: Project Proto Definition
- [ ] Create `apis/ai/stigmer/agentic/project/v1/spec.proto`
- [ ] Define Project message with name, org, runtime, entryPoint
- [ ] Add validation rules

#### T04.2: stigmer.yaml Loader
- [ ] Create `internal/cli/project/loader.go`
- [ ] Implement `LoadProjectFromFile()` function
- [ ] Auto-discovery from current directory (walk up tree)
- [ ] Validate runtime is supported

#### T04.3: Project Detection in CLI
- [ ] Modify `stigmer apply` to detect `stigmer.yaml` presence
- [ ] If present: Project Track (synthesis)
- [ ] If absent with `.stigmer/` dir: Legacy synthesis mode
- [ ] If absent with YAML file arg: Atomic Track (resource apply)

#### T04.4: Project Registry (Backend)
- [ ] Design Project storage in backend
- [ ] Track which resources belong to which Project
- [ ] Enable querying resources by Project name

**Deliverable**: `stigmer.yaml` detected and parsed, Project entity exists.

---

## Phase 5: SDK Unification

**Goal**: Ensure SDK supports ALL resources (Agent, Workflow, Skill, MCP Server) for Project Track.

### SDK Resource Definitions

```go
// main.go - Example Project SDK code
package main

import "github.com/stigmer/stigmer/sdk/go/stigmer"

func main() {
    // Define a skill from local directory
    codingSkill := stigmer.NewSkillFromDir("coding-best-practices", "./skills/coding")
    
    // Define an MCP server
    githubMCP := stigmer.NewMCPServer("github", stigmer.MCPServerSpec{
        Tools: []string{"search_code", "create_pr", "get_file_contents"},
    })
    
    // Define an agent (KEPT IN SDK - not removed!)
    reviewer := stigmer.NewAgent("code-reviewer", stigmer.AgentSpec{
        Instructions: "You are a code reviewer...",
        Skills:       []stigmer.Skill{codingSkill},
        MCPServers:   []stigmer.MCPServerUsage{{Server: githubMCP, Tools: []string{"search_code"}}},
    })
    
    // Define a workflow
    reviewPipeline := stigmer.NewWorkflow("review-pipeline", stigmer.WorkflowSpec{
        Tasks: []stigmer.Task{
            stigmer.AgentCallTask("analyze", reviewer, "Review this code: {{ inputs.code }}"),
        },
    })
    
    // Apply all resources under this Project
    stigmer.Apply("my-project", codingSkill, githubMCP, reviewer, reviewPipeline)
}
```

### Sub-tasks

#### T05.1: Keep Agent in SDK (Reversal)
- [ ] Remove deprecation notices from `sdk/go/agent/`
- [ ] Update SDK Agent to match YAML schema capabilities
- [ ] Ensure parity between YAML Agent and SDK Agent

#### T05.2: Add Workflow to SDK
- [ ] Create `sdk/go/workflow/workflow.go`
- [ ] Implement `NewWorkflow()` with task definitions
- [ ] Support same task types as YAML (http_get, agent_call, etc.)
- [ ] Type-safe task references (compile-time dependency checking)

#### T05.3: Add MCP Server to SDK
- [ ] Create `sdk/go/mcpserver/mcpserver.go` (if not exists)
- [ ] Implement `NewMCPServer()` with tool definitions
- [ ] Type-safe references from Agent

#### T05.4: Skill Local Reference Support
- [ ] Implement `NewSkillFromDir(name, path)` in SDK
- [ ] SDK handles artifact resolution during synthesis
- [ ] Auto-zip and upload local skill directories

#### T05.5: Synthesis Output
- [ ] Modify `stigmer.Apply()` to output Desired State Graph as JSON
- [ ] Include all resources with their resolved references
- [ ] Include artifact hashes for uploaded skills

**Deliverable**: SDK can define all resource types, synthesis outputs complete state graph.

---

## Phase 6: Project Reconciliation (Pruning)

**Goal**: Implement state diffing and automatic orphan cleanup.

### Reconciliation Flow

```
1. SYNTHESIZE
   Run SDK code → Generate Desired State Graph
   
2. RESOLVE ARTIFACTS
   For each local skill reference:
   - Zip directory
   - Upload to artifact storage
   - Replace local path with artifact hash

3. FETCH ACTUAL STATE
   Query backend for all resources owned by this Project
   
4. DIFF
   Compare Desired vs Actual:
   - NEW: In Desired, not in Actual → Create
   - CHANGED: In both, different → Update
   - ORPHAN: In Actual, not in Desired → Delete (PRUNE)

5. APPLY
   Execute changes in dependency order
   
6. REPORT
   Display summary of changes
```

### Sub-tasks

#### T06.1: Desired State Graph Structure
- [ ] Define graph data structure (resources + edges)
- [ ] Include resource kind, spec, and dependencies
- [ ] Include artifact references (hashes)

#### T06.2: Actual State Fetcher
- [ ] Implement `FetchProjectResources(projectName)` 
- [ ] Query all resource types filtered by Project
- [ ] Return as comparable graph structure

#### T06.3: State Differ
- [ ] Implement `DiffStates(desired, actual)` function
- [ ] Categorize changes: creates, updates, deletes
- [ ] Handle renamed resources (same content, different name)

#### T06.4: Reconciler
- [ ] Implement `Reconcile(diff)` function
- [ ] Apply changes in topological order (dependencies first)
- [ ] Delete orphans in reverse dependency order
- [ ] Provide `--prune=false` flag to disable deletion

#### T06.5: CLI Integration
- [ ] Modify `stigmer apply` to use full reconciliation loop
- [ ] Display diff before applying (unless `--yes`)
- [ ] Show pruning warnings prominently

**Deliverable**: `stigmer apply` performs full reconciliation with orphan pruning.

---

## Phase 7: Search & Discovery (Unchanged)

**Goal**: Enable resource discovery across the platform.

*Content unchanged from T01_3_revised_plan.md Phase 4*

### Sub-tasks
- [ ] T07.1: Backend Search RPC Implementation
- [ ] T07.2: Per-Resource Search Commands
- [ ] T07.3: Cross-Cutting Discovery Command (`stigmer discover`)

**Deliverable**: Users can search and discover resources.

---

## Phase 8: Platform Capabilities (Draft Commands)

**Goal**: Agent-assisted resource authoring.

*Content unchanged from T01_3_revised_plan.md Phase 5*

### Sub-tasks
- [ ] T08.1: Platform Capabilities Architecture
- [ ] T08.2: Embedded Capability Definitions
- [ ] T08.3: Draft Commands Implementation
- [ ] T08.4: Draft Command UX Polish

**Deliverable**: `stigmer <resource> draft` works for all resource types.

---

## Phase 9: Documentation & Cleanup

**Goal**: Finalize documentation and remove deprecated code.

### Sub-tasks

#### T09.1: Documentation Updates
- [ ] Create "Dual-Track Interface" user guide
- [ ] Document Atomic Track (YAML commands)
- [ ] Document Project Track (SDK + stigmer.yaml)
- [ ] Update CLI README with new architecture
- [ ] Update SDK README (all resources, not workflow-only)

#### T09.2: Migration Guides
- [ ] Migration: Old `stigmer apply` (no project) → New Project-based apply
- [ ] Migration: SDK-only workflows → YAML workflows (for simple cases)

#### T09.3: Deprecated Code Removal
- [ ] Remove `stigmer new` command (replaced by `draft`)
- [ ] Remove old templates infrastructure
- [ ] Clean up any legacy synthesis code

#### T09.4: Final Testing
- [ ] E2E tests for Atomic Track (all resource types)
- [ ] E2E tests for Project Track (synthesis + reconciliation)
- [ ] E2E tests for pruning behavior

**Deliverable**: Complete documentation, clean codebase.

---

## Updated CLI Command Structure

```
stigmer
├── skill
│   ├── push <directory>              # Atomic: Push skill artifact
│   ├── get <qualified-slug>
│   ├── list
│   ├── delete <qualified-slug>
│   ├── search <query>
│   └── draft                         # Agent-assisted authoring
│
├── mcpserver (alias: mcp)
│   ├── apply <file.yaml>             # Atomic: Apply from YAML
│   ├── get <qualified-slug>
│   ├── list
│   ├── delete <qualified-slug>
│   ├── search <query>
│   ├── validate <file.yaml>
│   └── draft
│
├── agent (alias: agt)
│   ├── apply <file.yaml>             # Atomic: Apply from YAML ✅ DONE
│   ├── get <qualified-slug>          # ✅ DONE
│   ├── list                          # ✅ DONE
│   ├── delete <qualified-slug>       # ✅ DONE
│   ├── search <query>                # ✅ DONE (via discover)
│   ├── run <qualified-slug>          # ✅ DONE
│   ├── validate <file.yaml>          # ✅ DONE
│   └── draft
│
├── workflow (alias: wf)
│   ├── apply <file.yaml>             # Atomic: Apply from YAML ✨ NEW (Phase 3)
│   ├── get <qualified-slug>          # ✅ DONE
│   ├── list                          # ✅ DONE
│   ├── delete <qualified-slug>       # ✅ DONE
│   ├── search <query>                # ✅ DONE
│   ├── run <qualified-slug>          # ✅ DONE
│   ├── validate <file.yaml>          # ✨ NEW (Phase 3)
│   └── draft
│
├── apply                             # Project Track: SDK synthesis + reconciliation
│   # Detects stigmer.yaml, runs SDK, reconciles state
│
├── discover <query>                  # Cross-cutting resource discovery
│
├── config                            # Configuration management
├── backend                           # Backend selection
└── server                            # Server management
```

---

## Success Criteria

| Criterion | Phase | Validation |
|-----------|-------|------------|
| Workflow YAML apply works | 3 | `stigmer workflow apply wf.yaml` creates workflow |
| Workflow validate works | 3 | `stigmer workflow validate wf.yaml` checks syntax |
| stigmer.yaml detected | 4 | `stigmer apply` in project dir uses Project Track |
| SDK defines all resources | 5 | Agent, Workflow, Skill, MCP Server all in SDK |
| Synthesis outputs graph | 5 | JSON graph includes all resources |
| Reconciliation works | 6 | Creates/updates/deletes as needed |
| Pruning works | 6 | Orphaned resources deleted |
| Search works | 7 | `stigmer <resource> search` returns results |
| Draft works | 8 | `stigmer <resource> draft` generates YAML |
| Dual-track documented | 9 | Clear user guides for both tracks |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Workflow YAML complexity | Start with simple task types, expand iteratively |
| Expression syntax confusion | Use familiar Jinja2/GitHub Actions style |
| Project state drift | Clear reconciliation output, `--prune=false` option |
| SDK maintenance burden | Focus on Go first, other languages later |
| Migration friction | Preserve Atomic Track for existing users |

---

## Open Questions

| Question | Proposed Answer |
|----------|-----------------|
| Expression engine for Workflow YAML? | Use Go template syntax or Jinja2-style |
| Where to store Project state? | Backend tracks resource→project mapping |
| Skill versioning in SDK? | `NewSkillFromDir` auto-versions via content hash |
| Cross-project references? | Allow qualified slugs to other orgs (read-only) |

---

## Approval

**This plan is ready for your approval to begin execution.**

- [ ] Dual-Track architecture is acceptable
- [ ] Workflow YAML support is desired (Phase 3)
- [ ] Project entity design is acceptable (Phase 4)
- [ ] SDK keeping Agent (not removing) is correct (Phase 5)
- [ ] Reconciliation with pruning is desired (Phase 6)
- [ ] Ready to start Phase 3

**To approve**: Reply "Approved" or "Start Phase 3"

---

*Created: 2026-02-03*
*Status: Awaiting approval*
*Supersedes: T01_3_revised_plan.md*
