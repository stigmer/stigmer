# T01: Architecture Review — Declarative Track, Workspace Provisioning, Platform File Isolation

**Created**: 2026-02-28
**Status**: In Progress

## Objective

Thorough end-to-end review of three recently merged projects as a unified system. Identify all gaps, verify integration correctness, and produce a prioritized enhancement roadmap.

## Projects Under Review

| # | Project | Branch | Merged To Main |
|---|---------|--------|----------------|
| 1 | Declarative Track | `feat/improve-readme-and-onboarding-exp` | Yes (PR #53) |
| 2 | Workspace Provisioning | `feat/workspace-provisioning` | Yes (PR #54) |
| 3 | Platform File Isolation | (same as #2, sub-project) | Yes (PR #54) |

All three are on `main` as of commit `edb8926a`.

---

## 1. Integration Surface Audit

### 1.1 Proto Changes — No Conflicts

All proto changes compose cleanly:

| File | Project | Change |
|------|---------|--------|
| `apis/ai/stigmer/agentic/project/v1/spec.proto` | Declarative Track | Redesigned to reference-based members |
| `apis/ai/stigmer/agentic/session/v1/workspace.proto` | Workspace Provisioning | NEW: WorkspaceSource, GitRepoSource, LocalPathSource |
| `apis/ai/stigmer/agentic/session/v1/spec.proto` | Workspace Provisioning | Added workspace_source field (position 6) |
| `apis/ai/stigmer/agentic/agentexecution/v1/spec.proto` | Workspace Provisioning (Phase 6) | Added local_path to Attachment |

No field number conflicts. Each proto file was touched by exactly one project.

### 1.2 Backend Changes — Properly Composed

| Component | Files | Status |
|-----------|-------|--------|
| Workspace module | `worker/workspace/__init__.py`, `backend.py`, `local.py`, `daytona.py`, `provisioner.py`, `platform_mount.py` | All new, no conflicts |
| Source handlers | `worker/workspace/sources/git.py`, `local_path.py`, `empty.py` | All new |
| Main integration | `execute_graphton.py` | Modified by both workspace provisioning and platform file isolation — changes compose correctly |
| Project reconciliation | `stigmer-server/pkg/project/` | Rewritten by declarative track — independent of backend changes |

### 1.3 CLI Changes — Independent

| Component | Files | Project |
|-----------|-------|---------|
| Declarative apply | `apply_declarative.go`, `apply_declarative_test.go` | Declarative Track |
| SDK track adaptation | `apply_project.go`, `runtime.go` | Declarative Track |
| Track detection | `detect.go`, `loader.go` | Declarative Track |
| Attachment local_path | `run_attachments.go` | Workspace Provisioning (Phase 6) |

No cross-contamination between CLI changes.

**Verdict: All three projects compose cleanly. No integration conflicts.**

---

## 2. Gap Analysis

### 2.1 CRITICAL — Blocks End-to-End Testing

| # | Gap | Impact | Fix Effort |
|---|-----|--------|------------|
| G1 | **CLI has no `--workspace` flag** | Cannot specify workspace source when running agents. Proto field exists (`SessionSpec.workspace_source`), CLI doesn't populate it. | Medium — add flag to `run.go`, wire to session creation |
| G2 | **Declarative track: no skill directory support** | `stigmer apply` in a project with skills does nothing with them. Skills are directories (SKILL.md), scanner only reads YAML files. | Medium — add `scanSkillDirectories()`, push via `skill.Push()` |
| G3 | **Declarative track: no subdirectory scanning** | Seedpack has `agents/` and `mcp-servers/` subdirs. Scanner only reads top-level YAML. | Small — modify `scanResourceFiles()` to scan one level deep |
| G4 | **Feature flag defaults to disabled** | `STIGMER_WORKSPACE_PROVISIONING_ENABLED` defaults to off. Even with CLI flag, provisioning won't run. | Trivial — set in server config or document how to enable |

### 2.2 IMPORTANT — Needed for Customer-Ready State

| # | Gap | Impact | Fix Effort |
|---|-----|--------|------------|
| G5 | **No `stigmer draft mcp-server` CLI command** | Cannot draft MCP server YAMLs from CLI. Commented as "Future" in `draft.go`. Seedpack tools work around this by using `stigmer draft skill` and `stigmer draft agent`. | Medium — follow existing pattern from `draft_skill.go` |
| G6 | **Seedpack has no `stigmer.yaml`** | Seedpack cannot be applied as a project. No marker file. | Trivial — add file |
| G7 | **Missing `06_draft-agent-creator-agent.sh`** | No script to regenerate agent-creator agent YAML. Scripts 02-05 exist but the agent-creator agent has no regeneration script. | Small — follow pattern of `05_draft-mcp-server-creator-agent.sh` |
| G8 | **No orchestration script** | No `regenerate_all.sh` to run all seedpack tools in dependency order. | Small |
| G9 | **No customer documentation** | Zero documentation for declarative workflow, workspace provisioning, or the project format. | Large — multiple documents needed |

### 2.3 MINOR — Cleanup

| # | Gap | Impact | Fix Effort |
|---|-----|--------|------------|
| G10 | **Old path references in comments/docs** | Comments reference `bin/skills` and `.stigmer-inputs` (old paths). Non-functional but confusing. | Trivial — find-and-replace |
| G11 | **Daytona `platform_dir` returns None** | Cloud mode virtual mount deferred. Comment says "Phase B". | Deferred — acceptable for now |
| G12 | **Session platform_dir cleanup** | `~/.stigmer/sessions/{session_id}/platform/` has no cleanup lifecycle. | Small — add cleanup hook or document manual cleanup |
| G13 | **Git diff fallback for old paths** | When `platform_dir` is None, git diff excludes `.stigmer`, `.stigmer-inputs`, `bin/skills`. This is backward compat. | Acceptable — will be removed when platform_dir is always set |

---

## 3. Dependency Chain Verification

### 3.1 Server Bootstrap → Seedpack

```
stigmer server start
  → Bootstrapper.Run()
    → seedpack.DiscoverManifest()     ✅ discovers 3 skills, 3 agents, 1 MCP server
    → Content hash comparison         ✅ idempotent, skips if unchanged
    → bootstrapSkill() x 3            ✅ ZIP creation + Push API
    → bootstrapAgent() x 3            ✅ YAML load + Apply API
    → bootstrapMcpServer() x 1        ✅ YAML load + Apply API
```

**Status: WORKING** — The bootstrap chain from `embed.go` through `seedpack.go` to `bootstrap.go` is complete and tested.

### 3.2 Draft Commands → System Agents

```
stigmer draft skill -m "..."
  → Resolve agent "skill-creator" by slug  ✅ (requires bootstrap)
  → Create execution with message           ✅
  → Stream output, download artifacts       ✅

stigmer draft agent -m "..."
  → Resolve agent "agent-creator" by slug   ✅ (requires bootstrap)
  → Same execution flow                     ✅
```

**Status: WORKING** — Both `draft skill` and `draft agent` CLI commands exist and are wired.

**Gap: `draft mcp-server` does NOT exist.** The MCP-server-creator agent exists in seedpack but has no CLI draft command. Seedpack regeneration scripts use `stigmer draft skill` and `stigmer draft agent` only, so this doesn't block seedpack regeneration.

### 3.3 Declarative Apply → Project Membership

```
stigmer apply (in directory with stigmer.yaml, no entry_point)
  → DetectTrack()                           ✅ returns TrackDeclarative
  → scanResourceFiles()                     ⚠️  top-level YAML only (G2, G3)
  → detectResourceItems()                   ✅ detects Agent, Workflow, McpServer
  → applyResourceItem() per resource        ✅ individual Apply RPCs
  → Collect ApiResourceReference            ✅ from each apply response
  → project.Apply() with members            ✅ reconciliation + optional prune
```

**Status: PARTIALLY WORKING** — Works for flat projects with only YAML resources at top level. Fails for:
- Projects with skill directories (G2)
- Projects with subdirectory organization like seedpack (G3)

### 3.4 Agent Execution → Workspace Provisioning

```
stigmer run agent my-agent -m "..."
  → CLI creates AgentExecution              ✅
  → CLI does NOT set workspace_source       ❌ (G1 — no --workspace flag)
  → Backend receives execution
  → initialize_workspace()                  ✅ creates WorkspaceBackend + platform_dir
  → Feature flag check                      ⚠️  disabled by default (G4)
  → WorkspaceProvisioner.provision()        ✅ wired correctly
  → Credential stripping                    ✅ consumed_keys removed
  → System prompt injection                 ✅ ## Workspace section
  → Agent executes                          ✅
  → Git diff artifact (if git workspace)    ✅
```

**Status: BACKEND READY, CLI INCOMPLETE** — The entire workspace provisioning pipeline is wired in `execute_graphton.py`. It will work correctly once:
1. CLI sends `workspace_source` on `SessionSpec` (G1)
2. Feature flag is enabled (G4)

### 3.5 Platform File Isolation

```
Local mode:
  → initialize_workspace()                   ✅ computes platform_dir
  → LocalWorkspaceBackend(platform_dir=...)  ✅ stores platform root
  → _resolve() routes .stigmer/* paths       ✅ classify_platform_path()
  → _resolve_platform() with containment     ✅ prevents escape
  → Skills written to platform_dir           ✅ .stigmer/skills
  → Inputs written to platform_dir           ✅ .stigmer/inputs
  → $STIGMER_PLATFORM_DIR env var            ✅ set for shell access
  → Git diff excludes platform files         ✅ clean diffs

Cloud mode (Daytona):
  → platform_dir returns None                ⚠️  deferred (G11)
  → Falls back to in-workspace .stigmer/     ✅ acceptable for disposable sandboxes
```

**Status: WORKING (local mode), DEFERRED (cloud mode)** — Local mode correctly isolates platform files. Cloud mode uses in-workspace paths, which is acceptable since Daytona sandboxes are disposable.

---

## 4. End-to-End Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SERVER BOOTSTRAP                             │
│                                                                     │
│  stigmer server start                                               │
│    └→ Bootstrapper.Run()                                            │
│       └→ seedpack embedded content → Push skills, Apply agents/MCP  │
│          └→ skill-creator, agent-creator, mcp-server-creator ready  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      RESOURCE CREATION                              │
│                                                                     │
│  stigmer draft skill -m "..."  → uses skill-creator agent           │
│  stigmer draft agent -m "..."  → uses agent-creator agent           │
│  (stigmer draft mcp-server)    → NOT YET IMPLEMENTED (G5)           │
│                                                                     │
│  Output: SKILL.md dirs, agent.yaml files, mcp-server.yaml files     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      PROJECT APPLY                                  │
│                                                                     │
│  Directory with stigmer.yaml (no entry_point → declarative track)   │
│                                                                     │
│  stigmer apply                                                      │
│    ├→ Detect TrackDeclarative                                       │
│    ├→ Scan YAML files (top-level only)  ← NEEDS: subdirs (G3)      │
│    ├→ (Scan skill directories)          ← NEEDS: skill push (G2)    │
│    ├→ Apply each resource individually                              │
│    ├→ Collect ApiResourceReferences                                 │
│    └→ Apply project with member list                                │
│                                                                     │
│  stigmer apply --prune  → also deletes orphaned resources           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      AGENT EXECUTION                                │
│                                                                     │
│  stigmer run agent my-agent -m "..."                                │
│    ├→ (--workspace git://repo)          ← NEEDS: CLI flag (G1)      │
│    ├→ Create session + execution                                    │
│    └→ Stream results                                                │
│                                                                     │
│  Backend (execute_graphton.py):                                     │
│    ├→ initialize_workspace() → WorkspaceBackend + platform_dir      │
│    ├→ [Feature flag] provision_workspace() → git clone / local path │
│    ├→ Inject skills to .stigmer/skills/ (via platform_dir)          │
│    ├→ Inject inputs to .stigmer/inputs/ (via platform_dir)          │
│    ├→ Build system prompt (## Workspace section)                    │
│    ├→ Execute agent (zero local/cloud branches)                     │
│    └→ Post-execution: git diff artifact (clean, no platform noise)  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Prioritized Enhancement Roadmap

Based on the gap analysis, here is the recommended execution order:

| Priority | Task | Gap(s) | Rationale |
|----------|------|--------|-----------|
| **P0** | T02: Enhance declarative track (skill dirs + subdirs) | G2, G3 | Unblocks seedpack as project and customer projects with skills |
| **P1** | T03: Seedpack as project | G6, G7, G8 | Uses T02 output; becomes the reference project for customers |
| **P2** | T04: CLI `--workspace` flag | G1, G4 | Enables end-to-end workspace provisioning testing |
| **P3** | T06: Documentation | G9 | Continuous alongside T02-T05 |
| **P4** | T05: End-to-end testing | All | Validates everything works together |
| **Deferred** | `stigmer draft mcp-server` CLI | G5 | Not blocking; MCP server YAMLs can be authored manually |
| **Deferred** | Cloud platform_dir | G11 | Acceptable for disposable sandboxes |
| **Deferred** | Session cleanup lifecycle | G12 | Document manual cleanup for now |

---

## 6. Architecture Assessment

### What's Working Well

1. **Clean separation of concerns** — WorkspaceBackend protocol eliminates all mode-branching from agent code
2. **Reference-based Project model** — Projects as membership trackers, not containers. Clean set-based reconciliation.
3. **Virtual platform mount** — Zero-pollution file isolation with dual-scope path resolution
4. **Content-addressed bootstrap** — Idempotent, offline-first, with provenance tracking
5. **Three-track convergence** — Atomic, declarative, and SDK tracks all converge on the same backend

### Concerns

1. **Declarative track is incomplete for real-world projects** — Skills (the most common resource after agents) aren't supported. This must be fixed before customers use it.
2. **Workspace provisioning is unreachable from CLI** — Complete backend implementation with no way to invoke it. High-value feature locked behind a missing CLI flag.
3. **Documentation debt** — Three major features with zero customer-facing documentation. The declarative workflow should be the primary getting-started path, but there's nothing to point customers to.
4. **Seedpack is hidden** — The best reference project for customers is buried at `backend/services/stigmer-server/pkg/seedpack/`. It should be prominently documented and serve as the canonical example.

### Recommendations

1. Fix declarative track (T02) first — it unblocks everything else
2. Make seedpack a project (T03) immediately after — it validates T02 and becomes the reference
3. CLI workspace flag (T04) can be done in parallel — independent code path
4. Document everything as you go (T06) — not as afterthought
5. End-to-end test (T05) validates the full stack once T02-T04 are done
