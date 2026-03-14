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
1. CLI flag: `stigmer apply --org <slug>` (overrides everything)
2. Project manifest: `stigmer.yaml` → `metadata.org`
3. Explicit `metadata.org` on individual resource YAML (author intent, rare)
4. Active context from `~/.stigmer/config`
5. Fallback: `"stigmer"` (replaces old `"default"`)

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

**Status**: ⏸️ TODO
**Created**: 2026-03-14 07:56

### Scope
Resources without `metadata.org` should inherit org from the project-level `stigmer.yaml`. Add `--org` CLI flag as an override. This is the core infrastructure work that makes org a contextual concern.

### Subtasks
- [ ] Locate the `stigmer apply` code path that processes resources
- [ ] Add `resolveOrg()` function implementing the precedence hierarchy
- [ ] When a resource has no `metadata.org`, inject it from the project manifest before persistence
- [ ] Add `--org` flag to `stigmer apply` cobra command
- [ ] Add `--force-org` flag that overrides even explicit `metadata.org` on resources
- [ ] Update the seedpack bootstrap call to pass org as a parameter (not hardcoded in YAML)
- [ ] Add unit tests for org resolution precedence

### Org Resolution Logic (pseudocode)
```
resolveOrg(resource, project, cliFlags):
  if cliFlags.ForceOrg != "":  return cliFlags.ForceOrg
  if resource.Metadata.Org != "":  return resource.Metadata.Org
  if cliFlags.Org != "":  return cliFlags.Org
  if project.Metadata.Org != "":  return project.Metadata.Org
  if activeContext.Org != "":  return activeContext.Org
  return "stigmer"
```

### Notes
- The seedpack is embedded and immutable — org override MUST come from outside the embedded files
- Server bootstrap should call apply with `Org: server.Config.SeedpackOrg` (defaults to "stigmer")

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

**Status**: ⏸️ TODO
**Created**: 2026-03-14 07:56

### Scope
Set `planton` as the org in the agent-fleet project manifest. Remove hardcoded `org: default` from individual resources so they inherit from the project.

### Subtasks
- [ ] Update `agent-fleet/stigmer.yaml`: add `metadata.org: planton`
- [ ] Remove `org: default` from `agents/infra-chart-composer.yaml`
- [ ] Remove `org: default` from `mcp-servers/mcp-server-planton.yaml`
- [ ] If infra-chart-composer references `mcp-server-stigmer` (from seedpack), add cross-org ref with `org: stigmer`
- [ ] Verify all `mcp_server_ref` and `skill_refs` use correct org context after inheritance

### Files to Change
- `agent-fleet/stigmer.yaml` — add org
- `agent-fleet/agents/infra-chart-composer.yaml` — remove org, verify refs
- `agent-fleet/mcp-servers/mcp-server-planton.yaml` — remove org

### Notes
- infra-chart-composer uses `mcp-server-planton` which is in the same project (planton org) — no cross-org ref needed
- If any agent-fleet agent references seedpack resources (mcp-server-stigmer), that IS a cross-org ref

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

