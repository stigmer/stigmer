# Clickable Output Types in SDK Reference Docs

**Date**: April 4, 2026

## Summary

Extended the SDK reference documentation to make return types clickable. Every method that returns a resource (e.g., `Agent`, `McpServer`, `Skill`) now links to a `### ResourceName` section showing the KRM envelope fields, with the spec field linking to the existing Input type and the status field linking to a new status type section documenting system-managed state. Server streaming methods also received the same treatment, rendering `Stream<ResourceType>` with the inner type as a clickable link.

## Problem Statement

After the initial clickable-proto-types work, only method *parameter* types were rendered as clickable links. Return types like `Returns: Agent` remained as plain backtick text, creating an inconsistency: users could click input types to see their fields, but had no way to navigate to the structure of what they get back from API calls.

### Pain Points

- SDK users calling `get()`, `create()`, or `apply()` had no documentation of the response shape
- Status fields (e.g., `default_instance_id`, `discovered_capabilities`, `version_hash`) were completely undocumented in SDK reference pages
- Server streaming methods rendered `Stream<AgentExecution>` without any link to the streamed type
- Inconsistent UX: input types were clickable but output types were not

## Solution

Extended both stages of the codegen pipeline to extract, emit, and render resource response types and their status sub-types as documented, clickable type sections.

## Implementation Details

### Stage 1: Schema Extraction (`proto2schema/main.go`)

- Added `ResourceDescription` and `StatusType` fields to `ServiceSchemaFile`
- Added `extractResourceAndStatusSchemas()` which looks up the resource message descriptor for its proto comment and parses the status message's fields via the existing `parseSharedType()` function
- Status types are only emitted when they contain fields beyond the shared `audit` field (audit-only statuses like `IamPolicyStatus` are omitted to avoid noise)

### Stage 2: Doc Generation (`sdk_docs.go` + `sdk_client.go`)

- Added `docResponseTypeString()` — identical to `docTypeString()` except message types use their raw proto name (e.g., `ApiResourceAudit`) instead of appending `Input`
- Added `docWriteResponseTypeField()` — renders TypeTable fields using response-oriented type names
- Added `docWriteResourceAndStatusTypes()` — renders a `### ResourceName` section with the 5 hardcoded KRM fields (apiVersion, kind, metadata, spec, status) and a `### ResourceStatus` section with resource-specific status fields
- Updated `docBuildDocumentedTypeSet()` to include the resource type name and status type name
- Fixed server streaming return types to pass through `docTypeRef()` inside a `Stream<...>` wrapper

### Design Decisions

- **Hardcoded KRM structure**: The resource type section uses a fixed 5-field layout rather than generic parsing, since every resource shares the same KRM envelope (apiVersion, kind, metadata, spec, status). This avoids the `docTypeString()` `Input`-suffix problem entirely.
- **Metadata described inline**: `ApiResourceMetadata` is summarized in the field description rather than getting its own section. It is identical across all 17 resources — documenting it per-page would add repetition without information.
- **Audit included but not expanded**: The `audit` field appears in status TypeTables with a descriptive summary, but `ApiResourceAudit` does not get its own section (same reasoning as metadata).
- **Status omitted when audit-only**: Resources with audit-only status types (e.g., IamPolicy, Environment) render the status reference as plain backticks, avoiding empty or trivial sections.
- **Ordering**: Resource and status type sections appear at the end of the Types block, after input types and method parameter types, since input types are more actionable for the most common SDK workflows.

## Benefits

- SDK users can now click any return type to see the response structure
- Status fields like `default_instance_id`, `discovered_capabilities`, `version_hash`, and `git_provenance` are now discoverable directly in SDK docs
- Server streaming methods show clickable inner types within `Stream<...>`
- Consistent UX: both input and output type references are navigable

## Impact

- **17 SDK reference pages** updated with clickable return types and resource/status sections
- **17 service schema JSON files** enriched with `resourceDescription` and `statusType` (where applicable)
- **3 source files** modified in the codegen pipeline
- **7 resources** gained documented status sections (Agent, ApiKey, McpServer, Project, Skill, Workflow, WorkflowExecution)
- **2 streaming methods** (AgentExecution.subscribe, WorkflowExecution.subscribe) now have clickable stream types

## Related Work

- Builds directly on [Clickable Proto Types in SDK Docs](2026-04-04-095410-clickable-proto-types-in-sdk-docs.md) which handled input/parameter types

---

**Status**: ✅ Production Ready
