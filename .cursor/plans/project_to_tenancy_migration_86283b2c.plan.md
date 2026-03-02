---
name: Project to Tenancy Migration
overview: Migrate the Project resource from the `management` domain to the `tenancy` domain, consolidating resource hierarchy (Organization, Platform, Project) into a single bounded context. Eliminate the `management` domain entirely.
todos:
  - id: phase-1-proto
    content: Move 6 proto files from management/project/v1/ to tenancy/project/v1/, update packages, imports, and apiVersion const
    status: completed
  - id: phase-2-enum
    content: "Update ApiResourceKind enum: change project group from agentic to tenancy, update ApiResourceGroup tenancy comment"
    status: completed
  - id: phase-3-stubs
    content: Delete old management stubs (Go + Python), regenerate via buf generate
    status: completed
  - id: phase-4-schemas
    content: Move codegen schemas from management/project/ to tenancy/project/, update protoType and protoFile references
    status: completed
  - id: phase-5-mcp
    content: Delete mcp-server/gen/management/, regenerate MCP codegen via make codegen
    status: completed
  - id: phase-6-go-imports
    content: "Update ~36 hand-written Go files: import paths and management.stigmer.ai/v1 string literals"
    status: completed
  - id: phase-7-yaml
    content: Update apiVersion in seedpack/stigmer.yaml and 3 example project YAML files
    status: completed
  - id: phase-8-verify
    content: Run buf lint, go build, go test, grep for any remaining management references
    status: completed
  - id: phase-9-docs
    content: Update example README, TEST-RESULTS, changelog, and project tracking docs
    status: in_progress
isProject: false
---

# Migrate Project from `management` to `tenancy` Domain

## Context

T01.1 moved Project from `agentic.stigmer.ai/v1` to `management.stigmer.ai/v1`. This migration continues that trajectory — moving Project into the `tenancy` domain where it belongs alongside Organization and Platform (the resource hierarchy bounded context). The `management` domain will cease to exist.

## Key Observations (discovered during analysis)

- **The `ApiResourceGroup` enum never got a `management` entry** — it still only has `agentic`, `iam`, `tenancy`. The `management` domain exists only at the proto path and package level, not in the enum infrastructure. This means the domain model was already resisting the split.
- **Project's `group` in `ApiResourceKind` still says `agentic`** (line 365 of `api_resource_kind.proto`), not `management`. This needs to change to `tenancy`.
- **The `proto2schema` tool doesn't scan `management/`** — it only scans `agentic`, `iam`, `tenancy` ([tools/codegen/proto2schema/main.go:272-276](tools/codegen/proto2schema/main.go)). Moving to `tenancy` naturally fixes this gap since `tenancy` is already in the scan list with `flatScan: true`.
- **Import alias `projectv1` stays the same** — all Go files use explicit aliases, so only the import path string changes. No type name changes.

## Scope

- **~71 files** total (6 proto source, ~9 Go stubs, ~18 Python stubs, ~36 hand-written Go, 4 YAML configs, 1 codegen schema root + 37 type schemas, 1 MCP generated, docs)
- This mirrors the T01.1 pattern (agentic->management) but in reverse (management->tenancy), and is simpler because the target domain already exists

## Migration Steps

### Phase 1: Proto Source Files (6 files move + 1 file edit)

Move `apis/ai/stigmer/management/project/v1/*.proto` to `apis/ai/stigmer/tenancy/project/v1/`:

Files: `api.proto`, `command.proto`, `io.proto`, `query.proto`, `spec.proto`, `status.proto`

In each file, update:

- **Package**: `ai.stigmer.management.project.v1` -> `ai.stigmer.tenancy.project.v1`
- **Imports**: `ai/stigmer/management/project/v1/...` -> `ai/stigmer/tenancy/project/v1/...`
- **apiVersion const** (in `api.proto`): `management.stigmer.ai/v1` -> `tenancy.stigmer.ai/v1`

Delete the empty `apis/ai/stigmer/management/` directory tree.

### Phase 2: Update `ApiResourceKind` Enum

In [apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto](apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto):

- Change `project = 60`'s `group` from `agentic` to `tenancy` (line 366)
- Update the comment from "Agentic - Project management" to "Tenancy - Project management" (line 364)

No changes needed to `api_resource_group.proto` — the `tenancy` group already exists.

### Phase 3: Regenerate Stubs

- Delete old Go stubs: `apis/stubs/go/ai/stigmer/management/`
- Delete old Python stubs: `apis/stubs/python/stigmer/ai/stigmer/management/`
- Regenerate via buf:
  - `buf generate --template buf.gen.go.yaml` (from `apis/`)
  - `buf generate --template buf.gen.python.yaml` (from `apis/`)

### Phase 4: Move Codegen Schemas

- Move `tools/codegen/schemas/management/project/` -> `tools/codegen/schemas/tenancy/project/`
- Update [tools/codegen/schemas/management/project/project.json](tools/codegen/schemas/management/project/project.json):
  - `protoType`: `ai.stigmer.management.project.v1.ProjectSpec` -> `ai.stigmer.tenancy.project.v1.ProjectSpec`
  - `protoFile`: `apis/ai/stigmer/management/project/v1/spec.proto` -> `apis/ai/stigmer/tenancy/project/v1/spec.proto`
- Delete empty `tools/codegen/schemas/management/` directory

### Phase 5: Regenerate MCP Codegen

- Delete `mcp-server/gen/management/`
- Run `make codegen` from `mcp-server/` to regenerate into `mcp-server/gen/tenancy/project/`

### Phase 6: Update Hand-Written Go Imports (~36 files)

Mechanical find-replace across all hand-written Go files:

**Import path change** (in ~36 files):
`github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/management/project/v1`
-> `github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/project/v1`

Key directories:

- `client-apps/cli/cmd/stigmer/root/` (5 files)
- `client-apps/cli/internal/cli/project/` (12 files)
- `backend/services/stigmer-server/pkg/domain/project/controller/` (12 files)
- `backend/services/stigmer-server/pkg/domain/project/reconcile/` (1 file)
- `backend/services/stigmer-server/pkg/server/` (1 file)
- `test/e2e/` (2 files)
- `seedpack/` (1 file)

**String literal change** (in ~10 files):
`"management.stigmer.ai/v1"` -> `"tenancy.stigmer.ai/v1"`

These appear in `loader.go` (error message), test files (expected apiVersion strings), and `seedpack_test.go`.

### Phase 7: Update YAML Configs & Examples

- [seedpack/stigmer.yaml](seedpack/stigmer.yaml): `apiVersion: management.stigmer.ai/v1` -> `apiVersion: tenancy.stigmer.ai/v1`
- [examples/project/minimal-go.yaml](examples/project/minimal-go.yaml): same change
- [examples/project/python-data-pipeline.yaml](examples/project/python-data-pipeline.yaml): same change
- [examples/project/node-api-service.yaml](examples/project/node-api-service.yaml): same change

### Phase 8: Verification

- `buf lint` from `apis/` — must be clean
- `go build ./...` from repo root — all modules must compile
- `go test ./...` from repo root — all tests must pass
- Verify no remaining `management.stigmer.ai` or `ai.stigmer.management` references in hand-written code (grep check)

### Phase 9: Documentation Updates

- Update [examples/project/README.md](examples/project/README.md) and [examples/project/TEST-RESULTS.md](examples/project/TEST-RESULTS.md) with new apiVersion
- Update project tracking docs (`_projects/`, `_changelog/`)

## What NOT to Change

- `stigmer-cloud` repo — cloud team handles proto bump separately (same decision as T01.1)
- No backward compatibility for `management.stigmer.ai/v1` — clean break (same decision as T01.1)
- The `tenancy` group comment in `api_resource_group.proto` should be updated from "Platform and organizational resources" to something that also includes Project, e.g. "Resource hierarchy — platform, organizations, and projects"

## Potential Surprises to Watch For

1. **MCP server references**: The `mcp-server/gen/management/project/project_gen.go` file is imported somewhere — need to verify all MCP consumers update correctly after regeneration
2. **go.sum changes**: Moving import paths within the same module shouldn't affect `go.sum`, but verify
3. **Any external consumers of the `management` proto package**: We confirmed `stigmer-cloud` consumes from `buf.build/stigmer/stigmer` — they will need to update after this is pushed to the buf registry

