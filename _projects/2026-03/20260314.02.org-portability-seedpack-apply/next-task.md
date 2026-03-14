# Next Task: 20260314.02.org-portability-seedpack-apply

## Current State
- **Status**: in-progress
- **Last Session**: 2026-03-14 — Completed Task 1 (seedpack org rename)
- **Active Task**: Task 2 — Implement org inheritance in apply flow

## Session Progress (2026-03-14)
- Completed Task 1: Renamed default org to stigmer in seedpack
- 4 files changed, 0 lines of Go logic modified (purely data + docs)
- Key finding: the codebase was already well-architected for this change — no hardcoded "default" in Go org-resolution logic
- All seedpack tests pass (4/4), all CLI project tests pass (105/105)
- Decision: left doc examples and test fixtures using "default" as arbitrary test data unchanged — these are not system org references

## Files Changed in Task 1
- `seedpack/organizations/default.yaml` → renamed to `stigmer.yaml`, slug/name/description updated
- `seedpack/stigmer.yaml` — `org: default` → `org: stigmer`, description "Default" → "System"
- `seedpack/seedpack_test.go` — expected path updated
- `apis/ai/stigmer/commons/apiresource/metadata.proto` — org field comment corrected

## Next Steps
1. **Task 2**: Implement org inheritance in apply flow
   - Add `resolveOrg()` function with precedence hierarchy
   - Add `--org` and `--force-org` CLI flags
   - Inject org from project manifest when resource has no `metadata.org`
   - Unit tests for org resolution precedence
2. **Task 3**: Add optional org field to cross-resource reference schemas
3. **Task 4**: Update agent-fleet to use planton org
4. **Task 5**: End-to-end validation

## Context for Resume
- The apply flow already has `resolveApplyOrganization` in `client-apps/cli/cmd/stigmer/root/apply.go` (line 132) — this is the function to extend for Task 2
- The seedpack bootstrap in `daemon.go` runs two phases: Phase 1 applies orgs via `apply -f`, Phase 2 applies project via `apply --config`
- `resolveApplyOrganization` priority: `--org` flag > `metadata.org` in stigmer.yaml > CLI context > error (no fallback)
- Individual resources get org injected via `fctx.orgID` — not read from YAML
- The `validator.go` already has "stigmer" in reserved project names

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

**Org Resolution Hierarchy:** CLI flag > Project manifest > Resource metadata > Context config > `"stigmer"` fallback

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
