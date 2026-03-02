# Task T01: Portable Org Tenancy — Full Implementation Plan

**Created**: 2026-03-02
**Updated**: 2026-03-02
**Status**: PENDING REVIEW
**Type**: Refactoring
**Scope**: Project Domain Migration + Relative References + Real Default Org

⚠️ **This plan requires your review before execution**

---

## Objective

Three interconnected changes that make Stigmer OSS resources portable to Cloud:

1. **Migrate Project** from `agentic.stigmer.ai/v1` to `management.stigmer.ai/v1` and expand its apply pipeline to support non-agentic resource kinds (Organization, etc.)
2. **Make cross-references org-agnostic** — empty `org` in `mcp_server_ref`, `skill_refs` resolves to parent resource's org
3. **Bootstrap a real Organization resource** in seedpack with slug `default`, replace all hardcoded `"local"` org defaults

After this work, resources authored locally work on Stigmer Cloud without rewriting.

---

## Architecture Decisions

### AD-01: Project moves from `agentic` to `management` domain
Project is a generic resource grouping mechanism, not an agentic concept. It belongs in the `management` domain alongside future resources like Release or Template. The apiVersion becomes `management.stigmer.ai/v1`, proto path becomes `apis/ai/stigmer/management/project/v1/`.

### AD-02: Project apply pipeline supports any resource kind
The hardcoded 4-kind restriction (Agent, Workflow, McpServer, Skill) is expanded. Organization is the first non-agentic kind added. The apply file handler, CLI type registry, verb support, and backend reconciliation service all gain Organization support.

### AD-03: Empty org in cross-references means "same org as parent"
When `ApiResourceReference.org` is empty, the server resolves it to the parent resource's `metadata.org` at write time. Explicit org is still supported for cross-org references (marketplace).

### AD-04: Default org slug is `default`, not `local`
The magic string `local` is replaced everywhere with `default`. Seedpack creates a real Organization resource with this slug. The name is neutral and doesn't imply deployment mode.

### AD-05: Seedpack Project creates the Organization resource
The seedpack `stigmer.yaml` uses `apiVersion: management.stigmer.ai/v1` and the seedpack directory includes `organizations/default.yaml`. The bootstrap apply creates the Organization alongside agents, skills, and MCP servers.

### AD-06: Backward compatibility — `org: local` and old apiVersion still work
Resources with explicit `org: local` continue to function. The CLI parser accepts both `agentic.stigmer.ai/v1` and `management.stigmer.ai/v1` for `kind: Project` during a transition period.

---

## Task Breakdown

### T01.1 — Migrate Project proto from `agentic` to `management`

**What**:
1. Create new proto directory: `apis/ai/stigmer/management/project/v1/`
2. Move all proto files from `apis/ai/stigmer/agentic/project/v1/`:
   - `api.proto`, `command.proto`, `query.proto`, `spec.proto`, `status.proto`, `io.proto`
3. Update proto `package` declarations: `ai.stigmer.agentic.project.v1` → `ai.stigmer.management.project.v1`
4. Update all proto `import` paths referencing the old location
5. Regenerate stubs: Go, Python (check if Java stubs exist in OSS)
6. Update all Go imports in CLI and server that reference the old generated package
7. Update the CLI YAML parser to recognize `management.stigmer.ai/v1` as the apiVersion for Project
8. Add backward compat: CLI also accepts `agentic.stigmer.ai/v1` with `kind: Project` (maps to the new package)
9. Remove old proto files from `apis/ai/stigmer/agentic/project/v1/` (clean break — no one is using this yet)

**Files affected** (non-exhaustive — search for all imports):
- `apis/ai/stigmer/agentic/project/v1/*.proto` → `apis/ai/stigmer/management/project/v1/*.proto`
- `client-apps/cli/cmd/stigmer/root/apply_project.go` — import path
- `client-apps/cli/cmd/stigmer/root/apply_declarative.go` — import path
- `client-apps/cli/internal/cli/project/applier.go` — import path
- `backend/services/stigmer-server/pkg/domain/project/` — import paths
- `backend/services/stigmer-server/pkg/server/server.go` — controller registration
- CLI type registry and apiVersion → kind mapping

**Risk**: Medium. Many files to update, but all mechanical (find/replace import paths). No behavioral change.

---

### T01.2 — Expand Project apply pipeline to support Organization

**Files to modify** (5 surgical changes):

| File | Change |
|------|--------|
| `client-apps/cli/cmd/stigmer/root/apply_file.go` | Add `case apiresourcekind.ApiResourceKind_organization: return applyOrganization(item, fctx)` to the switch |
| `client-apps/cli/cmd/stigmer/root/apply_file_handlers.go` | Add `applyOrganization` handler function (follows same pattern as `applyAgent`) |
| `client-apps/cli/internal/cli/types/registry.go` | Add `apiresourcekind.ApiResourceKind_organization: true` to `cliRelevantKinds` |
| `client-apps/cli/internal/cli/types/verb_support.go` | Add Organization to Apply verb support |
| `backend/services/stigmer-server/pkg/domain/project/reconcile/service.go` | Add `case apiresourcekind.ApiResourceKind_organization: return &orgv1.Organization{}, nil` to `newProtoForKind` |

**Also needed**: CLI Organization applier at `client-apps/cli/internal/cli/organization/applier.go` (new file, follows pattern of agent/applier.go).

**Why**: Without this, seedpack's Project cannot manage Organization resources. The apply would fail with "apply not implemented for organization".

---

### T01.3 — Proto: Make `org` optional in `ApiResourceReference`

**File**: `apis/ai/stigmer/commons/apiresource/io.proto` (lines 50–65)

**Change**:
- Remove `(buf.validate.field).required = true` from the `org` field
- Keep the pattern validation (when org IS provided, it must be valid)
- Regenerate proto stubs

**Why**: Allows YAML authors to omit `org` in same-org cross-references. The server fills it.

**Risk**: Low. Server-side appliers already handle empty org.

---

### T01.4 — Server: Resolve empty org in cross-references at write time

**What**: When a resource is being created/updated and its cross-references (`mcp_server_usages[].mcp_server_ref.org`, `skill_refs[].org`, etc.) have an empty `org`, fill from the resource's own `metadata.org`.

**Where**: Server-side normalization at the API boundary. By the time the resource is stored, all orgs are resolved. Query responses always have explicit org.

**Pattern**: Check if this should be in the CLI appliers (already partially done for `metadata.org`) or in the server command controllers. Server is cleaner (single enforcement point).

---

### T01.5 — Organization proto service + OSS server controller

**Proto files** (already exist):
- `apis/ai/stigmer/tenancy/organization/v1/api.proto`
- `apis/ai/stigmer/tenancy/organization/v1/spec.proto`
- `apis/ai/stigmer/tenancy/organization/v1/io.proto`

**What**:
1. Check if gRPC service definitions for Organization already exist in the protos (command + query)
2. Implement minimal Organization CRUD in the OSS server:
   - `Create` / `Apply` — stores Organization in SQLite
   - `Get` / `GetBySlug` — retrieve by ID or slug
   - `List` — list all organizations
   - `Update` — update org metadata
   - `Delete` — delete org
3. Register the controllers in `server.go`

**Scope**: Minimal implementation. No IAM enforcement (single-user OSS). Just CRUD using the generic SQLite store pattern.

---

### T01.6 — Seedpack: Add Organization, update apiVersion, remove `org: local`

**New file**: `seedpack/organizations/default.yaml`

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Default Organization
  slug: default
  labels:
    stigmer.ai/system: "true"
spec:
  description: "Default organization for local Stigmer installations"
  management_mode: self_managed
```

**Updated**: `seedpack/stigmer.yaml`

```yaml
apiVersion: management.stigmer.ai/v1
kind: Project
metadata:
  name: stigmer-seedpack
spec:
  description: >
    Default skills, agents, and MCP servers bootstrapped with every Stigmer server.
    This project serves as both the server's bootstrap content and a reference
    example for creating your own Stigmer projects.
```

**Modified files** (remove `org: local` from metadata and cross-refs):

| File | Changes |
|------|---------|
| `seedpack/agents/agent-creator.yaml` | Remove `org: local` from metadata (line 5). Remove `org: local` from `mcp_server_ref` (line 141) and `skill_refs` (line 151). |
| `seedpack/agents/mcp-server-creator.yaml` | Remove `org: local` from metadata (line 5). Remove `org: local` from `mcp_server_ref` (line 158) and `skill_refs` (line 168). |
| `seedpack/agents/skill-creator.yaml` | Remove `org: local` from `skill_refs` (line 133). |

**Embed update**: `seedpack/embed.go` — add `//go:embed organizations` to include the new directory.

---

### T01.7 — CLI: Replace `"local"` default with `"default"`, add org context

**Files with hardcoded `"local"` org**:

| File | Line | Current | Change to |
|------|------|---------|-----------|
| `client-apps/cli/cmd/stigmer/root/apply.go` | 156 | `return "local", nil` | `return "default", nil` |
| `client-apps/cli/cmd/stigmer/root/server.go` | 302 | `orgID := "local"` | `orgID := "default"` |
| `client-apps/cli/cmd/stigmer/root/verb_helpers.go` | 66 | `orgID := "local"` | `orgID := "default"` |
| `client-apps/cli/cmd/stigmer/root/run_resolve.go` | 52 | `return "local"` | `return "default"` |

**New CLI commands**:
- `stigmer org use <slug>` — stores active org in `~/.stigmer/config.yaml`
- `stigmer org list` — calls Organization query controller
- `stigmer org get <slug>` — calls Organization query controller

**Config change**: `resolveApplyOrganization()` reads active org from config when no flag/yaml override. Falls back to `"default"` when no config exists.

---

### T01.8 — Seedpack skill docs: Update examples to use relative refs

**12 files** in `seedpack/skills/` reference `org: local` in examples and documentation.

**Approach**:
- Primary examples show relative refs (no org in cross-references)
- Add a "Cross-org references" section showing explicit org for marketplace
- Replace `org: local` in metadata examples with `org: default` or omit entirely
- Update checklist text: "defaults to local" → "defaults to default"

**Files** (grouped by skill):

| Skill | Files |
|-------|-------|
| agent-creator | `SKILL.md`, `references/schema.md`, `references/examples.md`, `references/validation-rules.md` |
| mcp-server-creator | `SKILL.md`, `references/schema.md`, `references/examples.md`, `references/agent-integration.md`, `references/validation-checklist.md` |
| skill-creator | `SKILL.md` (check for any `org: local` references) |

---

### T01.9 — Product docs: Update for new patterns

**Files** in `docs/product/`:

| File | What changes |
|------|-------------|
| `what-is-organization.md` | Update "Local Mode" section — `default` not `local`. Mention real Org resource in OSS. |
| `what-is-agent.md` | Update getting-started example from `org: local` to omitting org. |
| `what-is-project.md` | Update apiVersion to `management.stigmer.ai/v1`. Update getting-started examples. |
| `what-is-seedpack.md` | Mention that seedpack now bootstraps Organization. Update apiVersion reference. |

---

### T01.10 — Tests: Update and verify backward compatibility

**What**:
1. Update test expectations from `"local"` to `"default"` where applicable
2. Update test imports from `agentic/project` to `management/project`
3. Add test: resource with `org: local` explicitly set still works (backward compat)
4. Add test: cross-reference with empty `org` resolves to parent's org
5. Add test: cross-reference with explicit `org` is preserved (cross-org case)
6. Add test: seedpack bootstrap creates Organization resource
7. Add test: `apiVersion: agentic.stigmer.ai/v1` with `kind: Project` still parses (backward compat)

---

## Execution Order

```
T01.1  Migrate Project proto (agentic → management)
  │
  └── T01.2  Expand apply pipeline (+ Organization kind)
        │
        ├── T01.3  Make org optional in ApiResourceReference proto
        │     │
        │     └── T01.4  Server-side org resolution for cross-refs
        │
        └── T01.5  Organization controller in OSS server
              │
              └── T01.6  Seedpack updates (new Org, new apiVersion, remove org: local)
                    │
                    └── T01.7  CLI defaults + org context commands
                          │
                          ├── T01.8  Skill docs (can parallel)
                          ├── T01.9  Product docs (can parallel)
                          │
                          └── T01.10  Tests (final — verify everything)
```

**Critical path**: T01.1 → T01.2 → T01.5 → T01.6 → T01.7 → T01.10
**Parallel work**: T01.3/T01.4 can run alongside T01.2. T01.8/T01.9 can run alongside T01.7.

---

## Success Criteria

- [ ] Project proto lives at `apis/ai/stigmer/management/project/v1/`
- [ ] `apiVersion: management.stigmer.ai/v1` accepted for `kind: Project`
- [ ] Backward compat: `apiVersion: agentic.stigmer.ai/v1` still accepted for Project
- [ ] Project apply pipeline handles Organization resources
- [ ] Zero `org: local` in seedpack YAML resource files
- [ ] Cross-references with empty org resolve to parent resource's org
- [ ] Seedpack bootstraps a real Organization resource with slug `default`
- [ ] Seedpack `stigmer.yaml` uses `management.stigmer.ai/v1`
- [ ] CLI defaults to `default` org (not `local`) for local backend
- [ ] `stigmer org use <slug>` sets active org in CLI config
- [ ] `stigmer org list` and `stigmer org get` work
- [ ] Existing resources with explicit `org: local` continue to work
- [ ] All tests pass (with updated expectations and imports)
- [ ] Skill reference docs show relative refs as the default pattern
- [ ] Product docs updated with new apiVersion and patterns

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Proto migration breaks imports across codebase | No external users yet. Mechanical find/replace. Run `go build` after every file to catch misses. |
| Cloud service imports old proto path | Cloud imports via git tag. Next tag bump includes new path. Cloud team updates imports when bumping. |
| Existing user YAML with `org: local` breaks | Backward compat: explicit org is always preserved. Only *empty* org gets resolved. |
| Old `apiVersion: agentic.stigmer.ai/v1` for Project breaks | CLI accepts both old and new apiVersion during transition. |
| Seedpack content hash changes → forced re-bootstrap | Expected and acceptable. Document in release notes. |
| Cross-org marketplace references break | Explicit org is preserved. Only *empty* org is resolved. |

---

## Stretch Goal: Multi-Org OSS

If time permits:
- Allow creating additional orgs (`stigmer org create`)
- Query controllers scope to active org context
- Nearly free since T01.5 adds Organization controller and T01.7 adds CLI context

---

## Review Process

**What happens next**:
1. **You review this plan** — confirm the approach, flag concerns
2. **Provide feedback** — any changes to scope, ordering, or decisions
3. **I'll revise** — incorporate feedback into a revised plan
4. **You approve** — explicit go-ahead
5. **Execution begins** — tracked in T01_3_execution.md
