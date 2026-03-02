# Migrate Project Resource to Tenancy Domain

**Date**: March 3, 2026

## Summary

Completed the full migration of the Project API resource from the `management` domain to the `tenancy` domain (`tenancy.stigmer.ai/v1`), establishing the correct bounded context where Organization, Platform, and Project form the resource hierarchy. This is a clean break with no backward compatibility for the old apiVersion.

## Problem Statement

The Project resource was originally in the `agentic` domain, then moved to `management` as an intermediate step. Neither location was semantically correct — Project belongs in the tenancy bounded context alongside Organization and Platform, since these three resources define the multi-tenant resource hierarchy.

### Pain Points

- Project proto living in `management` domain was a semantic mismatch — it's a tenancy concern, not a management concern
- Documentation still referenced the original `agentic.stigmer.ai/v1` apiVersion for Project across 9+ files
- Project docs physically lived under `apis/ai/stigmer/agentic/project/docs/` despite the proto being elsewhere
- File discovery rules in docs only mentioned `agentic.stigmer.ai/v1`, ignoring that Project now uses a different apiVersion

## Solution

Two-phase migration:
1. **Session 1**: Migrated all proto definitions, generated stubs (Go, Python), MCP codegen, codegen schemas, backend server, CLI, seedpack, e2e tests, and examples from `management.stigmer.ai/v1` to `tenancy.stigmer.ai/v1`
2. **Session 2**: Thorough gap analysis across both repos, followed by documentation migration and test fixture cleanup

## Implementation Details

### Proto Migration (150 files, ~5800 lines changed)
- Proto package: `ai.stigmer.management.project.v1` → `ai.stigmer.tenancy.project.v1`
- apiVersion constant: `management.stigmer.ai/v1` → `tenancy.stigmer.ai/v1`
- Go import path: `github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/project/v1`
- API Resource Kind enum updated: `project = 60` now references `group: tenancy`
- Old `management/project` directories fully removed (proto, Go stubs, Python stubs, codegen schemas, MCP gen)

### Consumer Updates
- Backend server: All domain controllers and reconciliation service import tenancy stubs
- CLI: All project subcommands (apply, delete, detect, display, get, load, validate) import tenancy stubs
- Server registration: `server.go` registers project controllers via tenancy package
- Seedpack: `stigmer.yaml` uses `tenancy.stigmer.ai/v1`
- E2E tests and examples: All use `tenancy.stigmer.ai/v1`

### Documentation Cleanup
- Moved `apis/ai/stigmer/agentic/project/docs/` → `apis/ai/stigmer/tenancy/project/docs/` (6 files)
- Updated Project apiVersion in: README, project-resource-guide, sdk-track, declarative-track, examples, validation-checklist
- Updated file discovery rules to reference both `agentic.stigmer.ai/v1` and `tenancy.stigmer.ai/v1` as valid apiVersions
- Fixed `docs/guides/stigmer-projects.md` (7 stale refs)
- Fixed `docs/product/what-is-project.md` (3 apiVersion refs + 4 doc links)
- Fixed `detect_test.go` TestDetect_Project test fixture

## Benefits

- **Correct domain modeling**: Project sits in the tenancy bounded context with Organization and Platform — the three resources that define the multi-tenant hierarchy
- **Clean codebase**: Zero remaining references to `management/project` or `agentic/project` in any non-historical file
- **Consistent documentation**: All user-facing docs, examples, and guides reference the correct `tenancy.stigmer.ai/v1` apiVersion
- **Foundation for T01.2+**: With Project in the right domain, the next tasks (Organization apply pipeline, org-agnostic cross-refs) build naturally on this foundation

## Impact

- All existing Project YAML files need `apiVersion: tenancy.stigmer.ai/v1` (clean break — old versions will fail validation)
- No changes to `stigmer-cloud` repo — cloud team handles proto bump separately
- Agent, Skill, McpServer, Workflow resources are unaffected — they remain in `agentic.stigmer.ai/v1`

## Related Work

- Previous: `2026-03-03-014051-migrate-project-proto-to-management-domain.md` (intermediate step)
- Next: T01.2 — Add Organization as supported resource kind in apply pipeline

---

**Status**: ✅ Production Ready
**Timeline**: 2 sessions (~3 hours total)
