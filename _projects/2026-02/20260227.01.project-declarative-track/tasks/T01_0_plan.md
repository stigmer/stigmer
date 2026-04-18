# Task T01: Redesign ProjectSpec to References + Declarative Directory Scanning

**Created**: 2026-02-27
**Status**: PENDING REVIEW
**Type**: Refactoring + Feature

⚠️ **This plan requires your review before execution**

## Objective

Transform the Project resource from a heavyweight container of full embedded objects into a lightweight membership tracker with references, and add a declarative directory-scanning track so users can manage groups of Stigmer resources from a folder.

## Architectural Decisions (from design discussion)

These decisions were reached through the analysis conversation that led to this project:

1. **`stigmer.yaml` is a marker file** — its only purpose is to identify a directory as a Stigmer project. The user writes the project name and optionally a description. Nothing else.

2. **Project stores references, not full objects** — the server-side `ProjectSpec` contains a list of `ApiResourceReference` members, not embedded Agent/Workflow/McpServer/Skill protos. Each resource has exactly one authoritative location (its own table).

3. **Members are discovered by directory scan, not declared by the user** — the CLI scans the directory containing `stigmer.yaml` for YAML resource files, applies each individually, and then sends the resulting references to the Project. The `members` field is server-side state derived from the scan.

4. **Orphan pruning is set-difference on references** — compare previous project membership with current membership. Resources in previous but not in current are orphans.

5. **`entry_point` is the single signal for SDK vs declarative** — if `entry_point` is set (e.g., `main.go`, `main.py`, `index.ts`), the CLI infers the SDK runtime from the file extension and runs synthesis. If `entry_point` is absent, it's a declarative project and the CLI scans for YAML files. The `runtime` field and `ProjectRuntime` enum are removed — they were redundant with the entry point's file extension and introduced cross-field validation issues.

6. **Three tracks converge on the same backend** —
   - Atomic: `stigmer apply -f file.yaml` (unchanged)
   - Declarative: `stigmer apply` in a directory with `stigmer.yaml` + YAML files (NEW)
   - SDK: `stigmer apply` in a directory with `stigmer.yaml` + `entry_point` + SDK code (existing, adapted)

## Task Breakdown

### Phase 1: Proto API Changes

**1.1 Redesign `ProjectSpec` (spec.proto)**
- [ ] Remove embedded `repeated Agent agents`, `repeated Workflow workflows`, `repeated McpServer mcp_servers`, `repeated Skill skills`
- [ ] Add `repeated ApiResourceReference members` — server-side membership list
- [ ] Remove `runtime` field and the `ProjectRuntime` enum entirely — redundant with `entry_point` file extension
- [ ] Remove `import` of `enum.proto` from `spec.proto`
- [ ] Keep `entry_point` (optional) — when set, CLI infers SDK runtime from extension (`.go` → Go, `.py` → Python, `.ts` → Node); when absent, project is declarative
- [ ] Keep `description`
- [ ] Update all proto comments to reflect new semantics

**1.2 Update `ProjectStatus` (status.proto)**
- [ ] Simplify `ReconciliationSummary` — reconciliation is now set-based, not spec-based
- [ ] `ResourceChangeRecord` stays as-is (kind + slug + resource_id) — still useful for reporting

**1.3 Regenerate stubs**
- [ ] Run proto generation (`cd apis && make build`)
- [ ] Verify generated Go/Python stubs compile

### Phase 2: Backend Reconciliation Simplification

**2.1 Simplify reconciliation service**
- [ ] Replace spec-level deep diff with set-difference on references
- [ ] Remove dependency graph / topological sort from reconciliation (resources are already applied individually by CLI)
- [ ] Reconciliation only handles orphan pruning now: previous members − current members = orphans to delete
- [ ] Keep `ReconciliationSummary` in the Apply response (still useful for CLI output)

**2.2 Update ProjectCommandController.Apply()**
- [ ] Accept Project with `members` field (references)
- [ ] Load previous Project from DB to get previous members
- [ ] Compute orphans = previous members − current members
- [ ] Delete orphaned resources (respecting `prune` flag)
- [ ] Store updated Project with new members
- [ ] Return reconciliation summary

**2.3 Remove delegation to individual controllers from reconciliation**
- [ ] Reconciliation no longer calls AgentController.Create/Update
- [ ] Individual resource lifecycle is handled by CLI before Project.Apply is called
- [ ] ExecutionEngine simplifies to orphan deletion only

### Phase 3: CLI — Declarative Track

**3.1 Add `TrackDeclarative` to track detection**
- [ ] In `detect.go`: when `stigmer.yaml` found with no `entry_point` → `TrackDeclarative`
- [ ] When `stigmer.yaml` found with `entry_point` set (e.g., `main.go`) → `TrackProject` (SDK, existing)
- [ ] When no `stigmer.yaml` found → `TrackAtomic` (existing)
- [ ] Add CLI-side runtime inference from `entry_point` extension: `.go` → Go, `.py` → Python, `.ts`/`.js` → Node
- [ ] Error on unrecognized extension with clear message listing supported extensions

**3.2 Implement declarative apply flow (`apply_declarative.go`)**
- [ ] Scan directory for `.yaml`/`.yml` files (reuse `resolveApplyFiles` from `apply_file.go`)
- [ ] Detect and validate resource kinds (reuse `detectApplyItems`)
- [ ] Apply each resource individually via existing file-apply logic (reuse `applyResourceItem`)
- [ ] Collect resulting resource references (kind + slug from each successful apply)
- [ ] Build Project proto with discovered members
- [ ] Call `ProjectCommandController.Apply()` with the reference-only Project
- [ ] Display reconciliation summary (created, orphaned, etc.)

**3.3 Wire up in `apply.go`**
- [ ] Route: `TrackDeclarative` → `executeDeclarativeApply()`
- [ ] Route: `TrackProject` (SDK) → adapt `executeProjectApply()` to apply resources first, then send references

### Phase 4: Adapt SDK Track

**4.1 Update `executeProjectApply` for reference model**
- [ ] After SDK synthesis: apply each synthesized resource individually (Agent, Workflow, McpServer)
- [ ] Collect resulting references
- [ ] Send Project with references (not embedded full objects)
- [ ] SDK user code is unchanged — only CLI orchestration changes

**4.2 Handle skills in SDK track**
- [ ] Skills still require push before project apply (existing behavior)
- [ ] Skill references collected from successful pushes
- [ ] Include skill references in Project members

### Phase 5: Testing and Validation

- [ ] Unit tests for new set-based reconciliation logic
- [ ] Unit tests for declarative track detection
- [ ] Integration test: create directory with YAMLs → `stigmer apply` → verify resources + project
- [ ] Integration test: remove a YAML file → `stigmer apply --prune` → verify orphan deletion
- [ ] Integration test: SDK flow still works end-to-end
- [ ] Verify atomic apply (`stigmer apply -f`) is completely unchanged

## What the User Experience Looks Like

### Declarative (NEW)
```bash
mkdir planton-agents && cd planton-agents

# Minimal marker file — no entry_point means declarative
cat > stigmer.yaml <<EOF
apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: planton-agents
spec:
  description: Planton agent fleet
EOF

# Drop in resource YAMLs
# (agent.yaml, mcp-server.yaml, etc.)

stigmer apply          # scans, applies resources, updates project
stigmer apply --prune  # also deletes orphaned resources
```

### SDK (Existing, Adapted)
```bash
# stigmer.yaml with entry_point: main.go
# main.go with SDK code
stigmer apply  # infers Go from .go extension, synthesizes, applies resources individually, updates project
```

### Atomic (Unchanged)
```bash
stigmer apply -f agent.yaml  # single resource, no project
```

## Success Criteria for T01

- [ ] Proto redesign complete and stubs generated
- [ ] Backend reconciliation simplified to reference-based orphan pruning
- [ ] CLI declarative track implemented and working
- [ ] SDK track adapted to reference model
- [ ] All three tracks tested
- [ ] Existing atomic apply unchanged

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Existing SDK projects break | SDK flow is adapted, not removed. User code unchanged. |
| Reconciliation loses spec-diffing capability | Individual resource Apply RPCs already handle idempotent upserts |
| Orphan pruning too aggressive | `--prune` flag controls deletion, disabled by default |

## Next Task Preview

**T02**: Update README.md and documentation to reflect the new declarative workflow as the primary getting-started path.

## Review Process

**What happens next**:
1. **You review this plan** — consider the phasing, scope, and approach
2. **Provide feedback** — any concerns, reordering, or scope changes
3. **I'll revise** — create T01_2_revised_plan.md if needed
4. **You approve** — explicit go-ahead
5. **Execution begins** — tracked in T01_3_execution.md
