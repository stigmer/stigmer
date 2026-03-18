# Fix TypeScript SDK Codegen Cross-Package Proto Imports

**Date**: March 18, 2026

## Summary

Fixed a build-breaking bug in the TypeScript SDK code generator that produced incorrect imports and duplicate exports when a proto spec references message types from a different proto package. The session SDK was importing `McpServerUsageSchema` and `ToolApprovalOverrideSchema` from the session spec_pb, but these schemas are defined in the agent spec_pb.

## Problem Statement

After adding `mcp_server_usages` and `skill_refs` fields to `SessionSpec` (which reuse `McpServerUsage` from the agent proto package), the Next.js web build failed with 6 Turbopack errors:

### Pain Points

- `McpServerUsageSchema` and `ToolApprovalOverrideSchema` were imported from `@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb`, where they don't exist
- `McpServerUsageInput` and `ToolApprovalOverrideInput` were re-exported from both `./agent` and `./session` in `client.ts`, causing "exported multiple times" errors
- The web console (`client-apps/web`) could not build at all

## Solution

Fixed the codegen template (`sdk_client_ts.go`) to correctly handle cross-package proto type references, and applied the corresponding fixes to the generated output files.

## Implementation Details

### Root Cause 1: `tsAddSchemaImport` used wrong import base

The `tsAddSchemaImport` function always used the current resource's proto package as the import base. When session's spec references `McpServerUsage` (defined in the agent package), the import was generated as:

```typescript
import { McpServerUsageSchema } from "@stigmer/protos/.../session/v1/spec_pb"; // wrong
```

**Fix**: When a `TypeSchema` has a `ProtoType` field, derive the import base from the type's own proto package:

```typescript
import { McpServerUsageSchema } from "@stigmer/protos/.../agent/v1/spec_pb"; // correct
```

### Root Cause 2: `generateTSClientFile` emitted duplicate exports

The `client.ts` re-export loop iterated all resources and dumped their `inputTypes` without deduplication. Both agent and session generated `McpServerUsageInput` and `ToolApprovalOverrideInput`, producing:

```typescript
export { type McpServerUsageInput } from "./agent";
export { type McpServerUsageInput } from "./session"; // duplicate!
```

**Fix**: Track already-exported type names in a `map[string]bool` and skip duplicates.

### Files Changed

- `tools/codegen/generator/sdk_client_ts.go` — codegen template (both fixes)
- `sdk/typescript/src/gen/session.ts` — regenerated with correct imports
- `sdk/typescript/src/gen/client.ts` — restored to non-duplicate state

## Benefits

- Web console builds successfully again
- Future codegen runs for any resource that references cross-package proto types will produce correct imports
- No manual fixups needed when proto messages are shared across packages

## Impact

- **TypeScript SDK**: All consumers of the generated session client now get correct imports
- **Web Console**: Unblocked from building
- **Developer Experience**: Codegen is now robust against cross-package message reuse, which is a common proto pattern

## Related Work

- `feat(apis/session): add mcp_server_usages and skill_refs to SessionSpec` — the commit that introduced the cross-package references
- `fix(sdk,codegen): emit proper protobuf-es builders for nested message types in TS SDK` — prior codegen fix for nested types

---

**Status**: Production Ready
