# Add Organization to CLI Apply Pipeline

**Date**: March 3, 2026

## Summary

Added Organization as a fully supported resource kind in the Stigmer CLI apply pipeline. Organizations can now be applied, retrieved, listed, and deleted through the CLI, with proper architectural boundaries that prevent Organization from being treated as a project member resource.

## Problem Statement

The CLI apply pipeline only supported 4 resource kinds (Agent, Workflow, McpServer, Skill). Organization — a critical infrastructure resource in the tenancy hierarchy — had no CLI support and was marked as `TIER_CLOUD_ONLY`, preventing OSS CLI visibility entirely.

### Pain Points

- Users could not manage Organization resources through the CLI
- Organization was invisible to the CLI due to its cloud-only tier classification
- No architectural boundary existed to distinguish project member kinds from infrastructure kinds
- The declarative apply flow would naively collect every applied resource as a project member

## Solution

Expanded the CLI apply pipeline with a new `organization` package following established patterns (loader, applier, Bazel build), registered Organization in the type system with appropriate verb support, and introduced an explicit `IsProjectMemberKind()` function to enforce the resource hierarchy boundary.

## Implementation Details

- **New package**: `client-apps/cli/internal/cli/organization/` with loader (YAML/JSON -> protobuf + protovalidate), applier (gRPC OrganizationCommandController), and BUILD.bazel
- **Type registry**: Organization added to `cliRelevantKinds` map with apply, get, list, delete verbs
- **Membership boundary**: New `types.IsProjectMemberKind()` function returns true only for agent, workflow, mcp_server, skill — Organization excluded
- **Declarative filter**: `apply_declarative.go` now uses `IsProjectMemberKind()` to gate `Project.Spec.Members` collection
- **Apply dispatch**: Organization case added to `applyResourceItem` switch and `applyOrganization` handler wired
- **Proto tier fix**: Organization changed from `TIER_CLOUD_ONLY` to `open_source`
- **Enum cleanup**: `ResourceTier` values renamed from SCREAMING_CASE to lowercase (cosmetic)

## Benefits

- Organization resources can now be managed through the CLI apply pipeline
- Explicit membership boundary prevents architectural violations (Organization is a parent of Project, not a child)
- Pattern consistency — Organization follows the same loader/applier/handler architecture as other resource kinds
- Test coverage for all new code paths and updated expectations for existing tests

## Impact

- **CLI users**: Can now apply Organization YAML manifests through `stigmer apply`
- **Declarative mode**: Organizations in project directories are applied without being tracked as project members
- **Architecture**: Clear separation between infrastructure kinds (Organization) and project member kinds (Agent, Workflow, etc.)
- **Proto contracts**: `ResourceTier` enum values now use lowercase naming convention across all resource kind definitions

## Related Work

- T01.1: Project proto migration to tenancy domain (prerequisite, completed in earlier sessions)
- T01.3 (upcoming): Make cross-references org-agnostic
- T01.5 (upcoming): Server-side Organization command/query controllers

---

**Status**: Production Ready
**Timeline**: Session 4 of org-tenancy-portable-resources project
