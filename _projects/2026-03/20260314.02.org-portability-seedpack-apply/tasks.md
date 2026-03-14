# Tasks: 20260314.02.org-portability-seedpack-apply

**Created**: 2026-03-14

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Architectural Context

**Core Principle:** Organization is a deployment context, not a resource identity field. Resources inherit org from their project manifest. Individual resources should be org-agnostic in their YAML.

**Org Resolution Hierarchy (highest precedence wins):**
1. CLI flag: `stigmer apply --org <slug>` (overrides project and context)
2. Project manifest: `stigmer.yaml` → `metadata.org`
3. Active context from `~/.stigmer/config` (or `backend.cloud.org_id`)
4. Error: "organization not set" (no silent fallback — explicit is safer)

**Key Decisions:**
- Seedpack system org: `stigmer` (same name OSS and Cloud — no migration needed)
- Agent-fleet org: `planton` (Planton-domain-specific resources)
- OSS bootstraps `stigmer` org instead of `default` — eliminates OSS→Cloud migration friction
- Cross-org references already supported via `ApiResourceReference.org` field — omit for same-org, set explicitly for cross-org

---

## Task 1: Rename default org to stigmer in seedpack

**Status**: ✅ DONE
**Created**: 2026-03-14 07:56
**Completed**: 2026-03-14 08:09

### Scope
Replace the `default` organization with `stigmer` as the system org in the seedpack. This is the foundational change that establishes naming consistency across OSS and Cloud.

### Subtasks
- [ ] Rename `seedpack/organizations/default.yaml` → `seedpack/organizations/stigmer.yaml`
- [ ] Update org YAML: slug `default` → `stigmer`, name `Default Organization` → `Stigmer`
- [ ] Update `seedpack/stigmer.yaml` project manifest: `metadata.org: default` → `metadata.org: stigmer`
- [ ] Remove any `org: default` from individual agent/mcp-server YAMLs in seedpack (if present)
- [ ] Update `seedpack/embed.go` if the embed directive references `organizations` by specific filenames
- [ ] Update server bootstrap code that references the `default` org slug
- [ ] Search for any hardcoded `"default"` org references in CLI/server Go code

### Files to Change
- `seedpack/organizations/default.yaml` → rename + content update
- `seedpack/stigmer.yaml` — org field
- `seedpack/embed.go` — verify embed directives still work
- Server bootstrap code — org reference updates
- Any CLI code referencing `org: "default"` as a fallback

### Notes
- The embed.go uses `//go:embed organizations` (directory glob), so renaming the file inside should be transparent
- Need to audit all Go code for hardcoded `"default"` org string

---

## Task 2: Implement org inheritance in apply flow

**Status**: ✅ DONE
**Created**: 2026-03-14 07:56
**Completed**: 2026-03-14

### Scope (Revised)
Deep codebase analysis revealed that the core org inheritance mechanism was already
implemented. The codebase was well-architected for this — `resolveApplyOrganization`
(flag > project > context > error), `--org` persistent flag, and per-resource org
injection in appliers were all in place. Task 2 was revised to add diagnostic
guardrails and seedpack org decoupling rather than re-implementing what existed.

### Already Implemented (pre-existing)
- [x] `--org` persistent flag on root command (`root.go:43`)
- [x] `resolveApplyOrganization` with precedence: flag > project > context > error (`apply.go:132`)
- [x] Resource appliers inject org when `metadata.org` is empty (`agent/applier.go:54`)
- [x] 14 tests covering org resolution precedence (`apply_org_test.go`)
- [x] Seedpack resources have no explicit `metadata.org`, inheriting from project manifest

### New Work (this session)
- [x] `warnOrgMismatch` helper warns when a resource has explicit `metadata.org` that
      differs from the resolved project/context org — catches accidental hardcoded orgs
      (`apply_file_handlers.go`)
- [x] Seedpack bootstrap Phase 2 now passes `--org` via `STIGMER_SEEDPACK_ORG` env var
      (default: `"stigmer"`), decoupling the bootstrap org from embedded YAML (`daemon.go`)
- [x] 5 new unit tests for `warnOrgMismatch` (`apply_org_test.go`)

### Decisions
- **Skipped `--force-org`**: Premature. The only use case (agent-fleet's `org: default`)
  is better fixed by removing the hardcoded org in Task 4. Adding a nuclear override
  that silently misplaces resources is risky.
- **Skipped `"stigmer"` fallback**: Error on missing org is safer than silent default.
  In local mode, `EnsureOrgContext()` auto-sets context after bootstrap. In cloud mode,
  a `"stigmer"` fallback would be wrong.
- **Kept resource-level org precedence**: If a resource has explicit `metadata.org`, it
  is preserved (author intent). The new `warnOrgMismatch` surfaces this visibly instead
  of letting it pass silently.

### Files Changed
- `client-apps/cli/cmd/stigmer/root/apply_file_handlers.go` — `warnOrgMismatch` + calls
- `client-apps/cli/internal/cli/daemon/daemon.go` — `STIGMER_SEEDPACK_ORG` env var
- `client-apps/cli/cmd/stigmer/root/apply_org_test.go` — 5 new tests

---

## ~~Task 3: Add optional org field to cross-resource reference schemas~~

**Status**: ✅ DONE (already exists)
**Created**: 2026-03-14 07:56

### Resolution
`ApiResourceReference` in `apis/ai/stigmer/commons/apiresource/io.proto` already has
the `org` field with the exact semantics needed:
- Empty org = same-org reference (server resolves to parent's org at write time)
- Explicit org = cross-org reference (e.g., marketplace resources)
- All stored references are absolute (org always populated after write)
- Validation regex: `^$|^[a-z][a-z0-9-]*$` (empty or valid slug)

The cross-org YAML pattern is already documented in `spec.proto` with the `org: acme-corp` example.
No work required — the convention is to omit `org` when ref and owning resource share the same org.

---

## Task 4: Update agent-fleet to use planton org

**Status**: ✅ DONE
**Created**: 2026-03-14 07:56
**Completed**: 2026-03-14

### Scope
Set `planton` as the org in the agent-fleet project manifest. Remove hardcoded `org: default` from individual resources so they inherit from the project. Update all `tools/` draft scripts to ensure regenerated resources also omit hardcoded org.

### Subtasks
- [x] Update `agent-fleet/stigmer.yaml`: add `metadata.org: planton`
- [x] Remove `org: default` from `agents/infra-chart-composer.yaml`
- [x] Remove `org: default` from `mcp-servers/mcp-server-planton.yaml`
- [x] Verified: no cross-org refs needed — agent-fleet agents only reference `mcp-server-planton` (same project), no seedpack resources
- [x] Verified: `mcp_server_ref` and `skill_refs` use slug-only references — correct under org inheritance
- [x] Updated all 7 draft script prompts (`00`, `01`, `04`, `06`, `08`, `10`, `12`) with `== ORG PORTABILITY ==` section
- [x] Updated `tools/rules/generate-stigmer-draft-scripts.mdc` to codify the pattern for future scripts

### Files Changed
- `agent-fleet/stigmer.yaml` — added `metadata.org: planton`
- `agent-fleet/agents/infra-chart-composer.yaml` — removed `org: default`
- `agent-fleet/mcp-servers/mcp-server-planton.yaml` — removed `org: default`
- `agent-fleet/tools/00_onboard-planton-mcp-server.sh` — added org portability instruction
- `agent-fleet/tools/01_generate-approval-policy.sh` — added org portability instruction
- `agent-fleet/tools/04_draft-infra-chart-composer-agent.sh` — added org portability section
- `agent-fleet/tools/06_draft-cloud-resource-assistant-agent.sh` — added org portability section
- `agent-fleet/tools/08_draft-stack-job-troubleshooter-agent.sh` — added org portability section
- `agent-fleet/tools/10_draft-planton-onboarding-guide-agent.sh` — added org portability section
- `agent-fleet/tools/12_draft-service-pipeline-debugger-agent.sh` — added org portability section
- `agent-fleet/tools/rules/generate-stigmer-draft-scripts.mdc` — codified org portability in DO NOT list

### Notes
- No cross-org refs needed: agent-fleet agents only reference `mcp-server-planton` (same project)
- Skill draft scripts (03, 05, 07, 09, 11) generate SKILL.md files, not resource YAML — no org field to omit
- The `01_generate-approval-policy.sh` preserves existing metadata, so after removing org from the base YAML, regeneration stays clean

---

## Task 5: Validate end-to-end

**Status**: ⏸️ TODO
**Created**: 2026-03-14 07:56

### Scope
Apply seedpack locally with `stigmer` org, apply agent-fleet with `planton` org, verify cross-org references resolve correctly.

### Subtasks
- [ ] Start fresh local Stigmer server — verify it bootstraps `stigmer` org (not `default`)
- [ ] Verify seedpack agents (agent-creator, skill-creator, mcp-server-creator) land in `stigmer` org
- [ ] Apply agent-fleet project — verify resources land in `planton` org
- [ ] Test `stigmer apply --org custom-org` override on seedpack — verify all resources get `custom-org`
- [ ] Test cross-org reference resolution (if applicable)
- [ ] Verify `stigmer get` round-trip: applied resource shows correct org

### Notes
- This is the smoke test, not exhaustive. Core concern is org binding correctness.

---

## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Seedpack bootstraps `stigmer` org (not `default`)
- [ ] Agent-fleet deploys to `planton` org
- [ ] `--org` CLI flag works with correct precedence
- [ ] Cross-org references resolve (if implemented)
- [ ] No hardcoded `"default"` org strings remain in Go code
- [ ] Code reviewed/validated

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

