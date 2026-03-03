# Organization Command/Query Controllers in OSS Server

**Date**: March 3, 2026

## Summary

Implemented the full Organization CRUD controller in the Stigmer OSS server, enabling the CLI apply pipeline (built in T01.2) to create, read, update, and delete Organization resources against the local server. This is T01.5 of the org-tenancy-portable-resources project, completing the server-side counterpart to the CLI Organization support.

## Problem Statement

The Organization proto was fully defined with gRPC service definitions for both command (apply, create, update, delete) and query (get, find, findMyOrganizations, getByExternalOrgId), and the CLI apply pipeline already called `OrganizationCommandController.Apply` via gRPC. However, no server-side implementation existed — every `stigmer apply -f organization.yaml` would fail with an unimplemented RPC error.

### Pain Points

- CLI Organization apply built in T01.2 had no server to talk to
- No Organization persistence in the OSS SQLite store
- No search indexing for Organization resources
- Blocked T01.6 (seedpack Organization bootstrap) and T01.7 (CLI org commands)

## Solution

Implemented the Organization controller following the established McpServer controller pattern — the simplest existing controller with no reconciliation, just CRUD via the pipeline framework and SQLite store. Added a search extractor following the existing pattern and registered both controllers in the server.

## Implementation Details

### Controller Package (8 files)

`backend/services/stigmer-server/pkg/domain/organization/controller/`

| File | Pipeline | Pattern Source |
|------|----------|---------------|
| `organization_controller.go` | Struct + constructor | McpServer |
| `create.go` | Validate -> Slug -> Duplicate -> NewState -> Persist -> IndexSearch | McpServer |
| `update.go` | Validate -> Slug -> LoadExisting -> UpdateState -> Persist -> IndexSearch | McpServer |
| `delete.go` | Validate -> ExtractId -> LoadForDelete -> Delete -> DeleteIndex | Project (OrganizationId has GetValue()) |
| `apply.go` | Validate -> Slug -> LoadForApply -> delegate Create/Update | McpServer |
| `get.go` | Validate -> LoadTarget (by OrganizationId) | Project |
| `find.go` | Validate -> ListAllOrganizations (domain step with pagination) | Session |
| `find_my_organizations.go` | Direct store access (no pipeline needed for Empty input) | Custom |

### Search Extractor

`organization_extractor.go` follows the McpServerExtractor pattern: extracts `spec.description` for search summary, builds FTS5 index entries, registers via `init()`. Organization is NOT added to `ValidateExpectedKinds` (administrative resource, not primary searchable entity).

### Key Design Decisions

- **Delete uses Project pattern** (not McpServer): `OrganizationId` has `GetValue()` like `ProjectId`, unlike `ApiResourceDeleteInput` which requires manual ID extraction.
- **`getByExternalOrgId` left unimplemented**: Cloud-only IdentityProvider feature. The embedded `UnimplementedOrganizationQueryControllerServer` returns `codes.Unimplemented` automatically.
- **`FindApiResourcesRequest.org` ignored**: Organizations are the top-level scope; filtering by org is semantically circular.
- **Organization slug is required in input**: Proto CEL rules enforce 2-15 chars, specific pattern. Unlike other resources where slug auto-derives from name, org slugs must be deliberately chosen.
- **Slug uniqueness is global**: `CheckDuplicateStep` scans all resources of the kind — correct for Organization since org slugs must be globally unique.

### Test Coverage

20 test cases covering all operations: create (5), get (3), update (3), delete (4), apply (3), find (4), findMyOrganizations (2). Integration-style tests using real SQLite store.

## Benefits

- Organization CRUD is fully operational in the OSS server
- `stigmer apply -f organizations/default.yaml` now works end-to-end
- Search indexing for Organization resources is wired up
- Unblocks T01.6 (seedpack Organization bootstrap) and T01.7 (CLI org commands)
- Zero impact on existing controllers — no behavioral changes to any other resource type

## Impact

- **CLI users**: Can now apply Organization YAML files against the local server
- **Seedpack bootstrap**: Can create the default Organization resource at server startup (T01.6)
- **Platform portability**: Organizations created locally will be recognized by Stigmer Cloud

## Related Work

- T01.2: Organization CLI apply pipeline (prerequisite — already completed)
- T01.4: Server-side org resolution for cross-references (parallel work, separate conversation)
- T01.6: Seedpack updates with Organization resource (next task)
- T01.7: CLI defaults and org context commands (depends on T01.5 and T01.6)

---

**Status**: Production Ready
**Timeline**: Single session (~1 hour)
