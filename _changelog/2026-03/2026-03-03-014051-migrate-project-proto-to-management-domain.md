# Migrate Project Proto from `agentic` to `management` Domain

**Date**: March 3, 2026

## Summary

Migrated the Project resource from `agentic.stigmer.ai/v1` to `management.stigmer.ai/v1`, correcting its domain classification. Project is a management-plane construct that groups resources of any kind -- placing it alongside Agent, Workflow, Skill, and McpServer in the `agentic` domain was a semantic mismatch. This is a clean break with no backward compatibility, updating proto definitions, generated stubs, all Go/Python consumers, codegen schemas, MCP server gen, seedpack, examples, and documentation atomically.

## Problem Statement

Project was classified under the `agentic` domain (`agentic.stigmer.ai/v1`) alongside AI agent orchestration primitives. This coupling violated ubiquitous language: Project is a generic organizational concept that groups and tracks membership of any resource kind, not an agent-specific construct.

### Pain Points

- Proto package `ai.stigmer.agentic.project.v1` implied Project was an agentic concept
- `apiVersion: agentic.stigmer.ai/v1` on Project YAML resources was misleading
- Future non-agentic resource kinds managed by Project (e.g., Organization) would inherit an incorrect domain association
- The namespace pollution prevented clean domain separation as the platform scales

## Solution

Relocated the entire Project proto package to `ai.stigmer.management.project.v1` with `apiVersion: management.stigmer.ai/v1`. All consumers updated atomically -- no transition period, no backward compatibility shim.

## Implementation Details

### Proto Migration (6 files)
- Created `apis/ai/stigmer/management/project/v1/`
- Moved `api.proto`, `command.proto`, `query.proto`, `spec.proto`, `status.proto`, `io.proto`
- Updated `package` declarations, internal import paths, and `buf.validate` `string.const` on `api_version`
- Deleted old `apis/ai/stigmer/agentic/project/v1/` directory
- buf lint passes clean

### Stub Regeneration
- `make protos` regenerated Go stubs at `apis/stubs/go/ai/stigmer/management/project/v1/` (9 files)
- Python stubs regenerated at `apis/stubs/python/stigmer/ai/stigmer/management/project/v1/`
- Old stubs auto-cleaned by `go-stubs-clean` target

### Go Import Path Updates (33 hand-written files)
- 15 backend files: server.go, all project controller source + test files, reconcile package
- 18 CLI + test files: project package (loader, detect, validator, display, applier, delete, get), apply command, test helpers, e2e tests
- Mechanical `agentic/project/v1` to `management/project/v1` replacement

### apiVersion String Literal Updates (15 files)
- Backend project test fixtures and assertions
- CLI project test fixtures, YAML string literals, error messages (`loader.go`)
- Careful scoping: only Project-context occurrences changed; Agent/Workflow/McpServer/Skill references preserved

### MCP Server Codegen
- Moved `tools/codegen/schemas/agentic/project/` to `management/project/` (schema + 35 type files)
- Updated `project.json` with new `protoType` and `protoFile`
- Regenerated `mcp-server/gen/management/project/project_gen.go` via comprehensive MCP codegen
- Old `mcp-server/gen/agentic/project/` deleted

### Seedpack + Examples
- `seedpack/stigmer.yaml`: `apiVersion: management.stigmer.ai/v1`
- `seedpack/seedpack_test.go`: assertion updated
- 3 example YAMLs + `README.md` + `TEST-RESULTS.md` updated (Agent examples preserved as `agentic.stigmer.ai/v1`)

## Benefits

- **Correct domain modeling**: Project now lives in the `management` namespace, accurately reflecting its role as a management-plane construct
- **Clean namespace separation**: `agentic` domain is exclusively for AI agent primitives; `management` domain for organizational constructs
- **Platform scalability**: Future management resources (Release, Template, etc.) have a clear home
- **Zero ambiguity**: No transition period or dual-apiVersion confusion

## Impact

- **Proto API**: Breaking change -- `apiVersion` is now `management.stigmer.ai/v1` exclusively for Project resources
- **All Go consumers**: Import paths updated across CLI, backend server, MCP server, e2e tests
- **Seedpack**: Default Project resource now uses new apiVersion
- **stigmer-cloud**: Not modified -- cloud team regenerates stubs on next proto tag bump
- **End users**: Any existing `stigmer.yaml` with `apiVersion: agentic.stigmer.ai/v1` and `kind: Project` must be updated

## Related Work

- Part of project `20260302.01.org-tenancy-portable-resources` (T01.1)
- Prerequisite for T01.2 (Organization resource kind in apply pipeline)
- Enables T01.3+ (org-agnostic cross-references, real Organization bootstrapping)

---

**Status**: Production Ready
**Timeline**: Single session
**Files Changed**: 145 (166 insertions, 4,758 deletions)
