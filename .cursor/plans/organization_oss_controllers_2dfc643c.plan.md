---
name: Organization OSS Controllers
overview: Implement Organization command and query controllers in the OSS server following the established McpServer controller pattern. This enables the CLI apply pipeline (built in T01.2) to successfully create, read, update, and delete Organization resources against the local server.
todos:
  - id: controller-struct
    content: Create organization_controller.go with struct, constructor, and embedded Unimplemented servers
    status: completed
  - id: command-ops
    content: "Implement command operations: create.go, update.go, delete.go, apply.go (pipeline pattern)"
    status: completed
  - id: query-ops
    content: "Implement query operations: get.go, find.go, find_my_organizations.go (pipeline + domain steps)"
    status: completed
  - id: search-extractor
    content: Create OrganizationExtractor in query/search/extractor/ (FTS5 indexing support)
    status: completed
  - id: build-bazel
    content: Create BUILD.bazel for the organization controller package
    status: completed
  - id: register-server
    content: Register Organization controllers in server.go (imports + registration block)
    status: completed
  - id: tests
    content: Write organization_controller_test.go covering all CRUD operations
    status: completed
  - id: verify-build
    content: Verify go build and go test pass, confirm CLI apply works end-to-end
    status: completed
isProject: false
---

# T01.5: Organization Command/Query Controllers in OSS Server

## Context

The Organization proto is fully defined (`apis/ai/stigmer/tenancy/organization/v1/`) with gRPC service definitions for both command (apply, create, update, delete) and query (get, find, findMyOrganizations, getByExternalOrgId). Go stubs are generated. The CLI apply pipeline (T01.2) already calls `OrganizationCommandController.Apply` via gRPC. The missing piece is the server-side implementation.

## Reference Pattern: McpServer Controller

The Organization controller follows the [McpServer controller](backend/services/stigmer-server/pkg/domain/mcpserver/controller/) pattern — the simplest existing controller with no reconciliation, no extra dependencies, just CRUD via pipeline steps + store.

## Files to Create

All new files go under a new package:

```
backend/services/stigmer-server/pkg/domain/organization/controller/
```

### 1. `organization_controller.go` — Struct + Constructor

Struct embeds both `Unimplemented*Server` interfaces, holds `store.Store`. Constructor: `NewOrganizationController(store store.Store)`.

Import path for generated stubs:

```go
organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
```

### 2. `create.go` — Create Pipeline

Pipeline: ValidateProto -> ResolveSlug -> CheckDuplicate -> BuildNewState -> Persist -> IndexSearch

Follows the McpServer `create.go` pattern exactly. Uses `OrganizationExtractor` for search indexing.

### 3. `update.go` — Update Pipeline

Pipeline: ValidateProto -> ResolveSlug -> LoadExisting -> BuildUpdateState -> Persist -> IndexSearch

Follows McpServer `update.go` pattern exactly. No immutability enforcement for now (deferred).

### 4. `delete.go` — Delete Pipeline

Pipeline: ValidateProto -> ExtractResourceId -> LoadExistingForDelete -> DeleteResource -> DeleteSearchIndex

Follows the **Project** `delete.go` pattern (not McpServer), because Organization uses `OrganizationId` with `GetValue()` (same as `ProjectId`), not `ApiResourceDeleteInput`. This means `ExtractResourceIdStep` works natively — no manual resource ID extraction needed.

Key type parameters:

```go
pipeline.NewPipeline[*organizationv1.OrganizationId]("organization-delete")
steps.NewExtractResourceIdStep[*organizationv1.OrganizationId]()
steps.NewLoadExistingForDeleteStep[*organizationv1.OrganizationId, *organizationv1.Organization](c.store)
steps.NewDeleteResourceStep[*organizationv1.OrganizationId](c.store)
```

### 5. `apply.go` — Apply (Create-or-Update)

Pipeline: ValidateProto -> ResolveSlug -> LoadForApply -> delegate to Create or Update.

Follows McpServer `apply.go` pattern exactly.

### 6. `get.go` — Get by ID

Pipeline: ValidateProto -> LoadTarget

Input type is `OrganizationId` (has `GetValue() string`). LoadTargetStep resolves the ID and loads the Organization.

Key type parameters:

```go
steps.NewLoadTargetStep[*organizationv1.OrganizationId, *organizationv1.Organization](c.store)
```

### 7. `find.go` — Find with Pagination

No generic pipeline step exists for listing. Follow the [session/controller/list.go](backend/services/stigmer-server/pkg/domain/session/controller/list.go) pattern with a domain-specific step:

- Pipeline: ValidateProto -> ListAllOrganizations (domain step)
- The domain step calls `store.ListResources`, unmarshals each `[]byte` into `*organizationv1.Organization`, applies basic pagination from `FindApiResourcesRequest.PageNumber`/`PageSize`, and builds `OrganizationList`.
- `FindApiResourcesRequest.org` is accepted but ignored for Organization find (orgs are the top-level scope; filtering by org is semantically circular).

### 8. `find_my_organizations.go` — FindMyOrganizations

In OSS (single user, no IAM), this returns all organizations. Implementation:

- Call `store.ListResources` for `ApiResourceKind_organization`
- Unmarshal all entries
- Return `Organizations{Entries: entries}`

This can bypass the pipeline entirely (direct store access) since the input is `google.protobuf.Empty` — no validation needed.

### 9. `get_by_external_org_id.go` — Stub (NOT implemented)

`getByExternalOrgId` is a cloud-only feature (IdentityProvider integration). In OSS, the `UnimplementedOrganizationQueryControllerServer` embedded in the struct already returns `codes.Unimplemented`. We do **NOT** override this method — no file needed. The unimplemented behavior is correct.

### 10. `BUILD.bazel`

Bazel build file following McpServer controller's BUILD pattern. Dependencies:

- Organization v1 stubs
- Commons apiresource stubs
- Pipeline and steps libraries
- Store library
- Organization search extractor

## Files to Create (Search Infrastructure)

### 11. `backend/services/stigmer-server/pkg/query/search/extractor/organization_extractor.go`

Follows the [McpServerExtractor](backend/services/stigmer-server/pkg/query/search/extractor/mcpserver_extractor.go) pattern exactly:

- `Kind()` returns `ApiResourceKind_organization`
- `GetSearchSummary()` returns `spec.description`
- `ToSearchResult()` extracts metadata, description, timestamps
- `GetSearchIndexEntry()` builds the FTS5 index entry
- `init()` calls `Register(&OrganizationExtractor{})`

Note: Do NOT add `organization` to `ValidateExpectedKinds` — Organization is an administrative resource, not a primary searchable entity like agents/skills. The extractor exists for completeness and `IndexSearchStep` usage, but the search service doesn't need to warn about its absence.

## Files to Modify

### 12. [server.go](backend/services/stigmer-server/pkg/server/server.go) — Register Organization Controllers

Two changes:

- **Imports**: Add `organizationv1` (stubs) and `organizationcontroller` (domain controller)
- **Registration**: After the Project controller block (~line 302), add:

```go
organizationController := organizationcontroller.NewOrganizationController(store)
organizationv1.RegisterOrganizationCommandControllerServer(grpcServer, organizationController)
organizationv1.RegisterOrganizationQueryControllerServer(grpcServer, organizationController)
log.Info().Msg("Registered Organization controllers")
```

## Tests

### 13. `organization_controller_test.go`

Integration-style tests using a real SQLite store (same pattern as [mcpserver_controller_test.go](backend/services/stigmer-server/pkg/domain/mcpserver/controller/mcpserver_controller_test.go)):

- **Create**: happy path, duplicate slug error, validation error
- **Update**: happy path, not found
- **Delete**: happy path, not found
- **Apply**: creates when new, updates when existing
- **Get**: happy path, not found
- **Find**: returns paginated results
- **FindMyOrganizations**: returns all orgs

## Design Decisions

- **No `getByExternalOrgId` implementation**: Dead code in OSS. The embedded `Unimplemented` stub is correct.
- **No immutability enforcement**: Deferred per discussion. `management_mode` and `identity_provider_ref` are only relevant for cloud.
- `**CheckDuplicateStep` slug uniqueness is global** (not org-scoped): This is correct for Organization — org slugs must be globally unique. Verified by reading `duplicate.go` which scans all resources of the kind.
- **Search extractor included**: Follows the established pattern. Every resource type that uses `IndexSearchStep` needs an extractor. Omitting it would be technical debt.

## Known Gap for T01.7

The Organization query proto has no `getBySlug` or `getByReference` RPC. When T01.7 implements `stigmer org get <slug>`, the CLI will need to either: (a) add a `getBySlug` RPC to the Organization query proto, or (b) call `findMyOrganizations` and filter client-side. This is a T01.7 design decision, not a T01.5 concern.

## Verification

After implementation:

- `go build ./backend/services/stigmer-server/...` compiles
- `go test ./backend/services/stigmer-server/pkg/domain/organization/...` passes
- `stigmer apply -f organizations/default.yaml` succeeds against local server (end-to-end proof)

