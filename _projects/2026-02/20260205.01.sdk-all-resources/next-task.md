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

**Phase**: T01 - Analysis & Planning
**Status**: PENDING REVIEW

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
       │                     ├── mcpserver-N.pb  ← NEW
       │                     ├── skill-N.pb      ← NEW
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

| Resource | Registered | Synthesized | Gap |
|----------|-----------|-------------|-----|
| Agent | ✅ Yes | ✅ Yes | None |
| Workflow | ✅ Yes | ✅ Yes | None |
| MCP Server | ❌ No | ❌ No | **Phase A** |
| Skill | ❌ No | ❌ No | **Phase B** |

---

## Implementation Phases

| Phase | Description | Effort |
|-------|-------------|--------|
| **A** | MCP Server Registration & Synthesis | ~3-4 hours |
| **B** | Skill FromDir & Synthesis | ~4-5 hours |
| **C** | Unified Synthesis & Dependencies | ~2-3 hours |
| **D** | Documentation & Examples | ~2 hours |

**Total**: ~1.5-2 days

---

## Key Files to Modify

1. **Context** (`sdk/go/stigmer/context.go`)
   - Add `mcpServers`, `skills` fields
   - Add `RegisterMCPServer()`, `RegisterSkill()`
   - Add `synthesizeMCPServers()`, `synthesizeSkills()`

2. **MCP Server** (`sdk/go/mcpserver/mcpserver.go`)
   - Verify/add `ToProto()` method
   - Auto-register with Context

3. **Skill** (`sdk/go/skill/skill.go`)
   - Add `Skill` struct (not just references)
   - Add `FromDir()` function
   - Add `ToProto()` method

---

## Task Plan

**Current Task**: T01_0_plan.md (PENDING REVIEW)
**Path**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260205.01.sdk-all-resources/tasks/T01_0_plan.md`

**Action Required**: Review and approve to begin Phase A.

---

## Project Folders

```
_projects/2026-02/20260205.01.sdk-all-resources/
├── README.md
├── next-task.md (this file)
├── tasks/
│   └── T01_0_plan.md
├── checkpoints/
├── design-decisions/
├── coding-guidelines/
├── wrong-assumptions/
└── dont-dos/
```

---

*Last Updated: 2026-02-05*
