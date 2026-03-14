# Next Task: 20260314.02.org-portability-seedpack-apply

## Current State
- **Status**: in-progress
- **Last Session**: 2026-03-14 — Completed Task 4 (agent-fleet org portability)
- **Active Task**: Task 5 — End-to-end validation

## Session Progress (2026-03-14)

### Task 1 (completed earlier)
- Renamed default org to stigmer in seedpack
- 4 files changed, 0 lines of Go logic modified (purely data + docs)

### Task 2 (completed earlier)
- Deep analysis revealed core org inheritance was already implemented (`resolveApplyOrganization`,
  `--org` flag, per-resource org injection in appliers, 14 existing tests)
- Revised scope: added diagnostic guardrails instead of re-implementing existing logic
- Added `warnOrgMismatch` helper to detect accidental hardcoded orgs in resource YAMLs
- Decoupled seedpack bootstrap org from embedded YAML via `STIGMER_SEEDPACK_ORG` env var
- Added 5 new unit tests for `warnOrgMismatch`

### Task 4 (completed this session)
- Added `metadata.org: planton` to `agent-fleet/stigmer.yaml` project manifest
- Removed `org: default` from `agents/infra-chart-composer.yaml` and `mcp-servers/mcp-server-planton.yaml`
- Verified no cross-org refs needed (agent-fleet agents only reference `mcp-server-planton`, no seedpack resources)
- Updated all 7 draft script prompts with `== ORG PORTABILITY ==` instruction to prevent regenerated YAMLs from hardcoding org
- Updated `tools/rules/generate-stigmer-draft-scripts.mdc` to codify the pattern for future scripts
- 11 files changed across `plantonhq/agent-fleet`

## Files Changed in Task 4 (agent-fleet repo)
- `stigmer.yaml` — added `metadata.org: planton`
- `agents/infra-chart-composer.yaml` — removed `org: default`
- `mcp-servers/mcp-server-planton.yaml` — removed `org: default`
- `tools/00_onboard-planton-mcp-server.sh` — org portability instruction
- `tools/01_generate-approval-policy.sh` — org portability instruction
- `tools/04_draft-infra-chart-composer-agent.sh` — org portability section
- `tools/06_draft-cloud-resource-assistant-agent.sh` — org portability section
- `tools/08_draft-stack-job-troubleshooter-agent.sh` — org portability section
- `tools/10_draft-planton-onboarding-guide-agent.sh` — org portability section
- `tools/12_draft-service-pipeline-debugger-agent.sh` — org portability section
- `tools/rules/generate-stigmer-draft-scripts.mdc` — codified org portability rule

## Next Steps
1. ~~Task 2~~: ✅ DONE
2. ~~Task 3~~: ✅ DONE (already existed)
3. ~~Task 4~~: ✅ DONE
4. **Task 5**: End-to-end validation
   - Start fresh local Stigmer server — verify it bootstraps `stigmer` org
   - Apply agent-fleet project — verify resources land in `planton` org
   - Test `--org` override
   - Verify `stigmer get` round-trip

## Context for Resume
- `resolveApplyOrganization` in `apply.go:132` — priority: `--org` flag > project `metadata.org` > CLI context > error
- `warnOrgMismatch` in `apply_file_handlers.go` — warns when resource has explicit org different from resolved org
- Seedpack bootstrap Phase 2 in `daemon.go` now passes `--org` sourced from `STIGMER_SEEDPACK_ORG` (default: `"stigmer"`)
- Agent-fleet project manifest now has `metadata.org: planton`, individual resources have no `metadata.org` (inherit from project)
- All draft scripts instruct the AI agent to omit `metadata.org` when regenerating resources

## Blockers
None.

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260314.02.org-portability-seedpack-apply/next-task.md`

---

## Project Overview

**Name**: 20260314.02.org-portability-seedpack-apply  
**Description**: Replace the default org with stigmer in the seedpack, implement org inheritance from project manifests in the apply flow, and update agent-fleet to use planton org. Enables resource portability across OSS and Cloud without org-level YAML edits.  
**Goal**: Make seedpack and agent-fleet resources portable across OSS and Cloud by using consistent org names (stigmer for seedpack, planton for agent-fleet) and implementing org inheritance so individual resources never hardcode org.  
**Tech Stack**: Go, YAML, Proto/Buf  
**Components**: seedpack, CLI apply flow, agent-fleet, proto resource schemas, server bootstrap

**Created**: 2026-03-14  
**Type**: ⚡ Quick Project (1-2 sessions)

---

## Project Location

**Project Root**: 
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.02.org-portability-seedpack-apply
```

---

## Essential Files

### Tasks (Check current progress here)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.02.org-portability-seedpack-apply/tasks.md
```

### Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.02.org-portability-seedpack-apply/README.md
```

### Quick Notes
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.02.org-portability-seedpack-apply/notes.md
```

---

## Architectural Context

**Core Principle:** Org is a deployment context, not a resource identity field.
Resources inherit org from their project manifest. `stigmer` is the system org (replaces `default`).

**Org Resolution Hierarchy:** CLI flag (`--org`) > Project manifest (`stigmer.yaml metadata.org`) > Context config > Error (no silent fallback)

**Key repos involved:**
- `stigmer/stigmer` — seedpack, CLI apply flow, proto schemas
- `plantonhq/agent-fleet` — Planton-specific agents (target org: `planton`)

---

## Quick Commands

After loading this file into chat, you can say:

- **"Show current status"** - Get overview of all tasks and progress
- **"Continue with current task"** - Resume work on in-progress task
- **"What's next?"** - Move to next task
- **"Update task X to done"** - Mark a task complete
- **"Add a note"** - Capture a quick learning or decision
- **"Complete project"** - Final wrap-up when all tasks done
