# Go SDK: All-Resource Code Generation

**Date**: March 16, 2026

## Summary

Extended the Go SDK code generation pipeline from 5 hardcoded resources to all 17 API resources across the agentic, IAM, and tenancy namespaces. Removed three artificial limitations (hardcoded maps in proto2schema and the generator, plus hand-written client/types files) and replaced them with auto-discovery and auto-derivation. Adding new API resources to the SDK now requires zero hand-written code.

## Problem Statement

The Go SDK restructure from Pulumi-style to Stripe-style (completed earlier today) was limited to only 5 resources despite the codegen being fully generic.

### Pain Points

- Three hardcoded lists (`sdkResources`, `resourceConfig`, `protoPackageToImport`) artificially gated which resources got SDK clients
- `sdk/go/client.go` manually listed each resource sub-client and had to be updated per resource
- `sdk/go/types.go` manually declared type aliases for each generated type
- `apiVersion` was hardcoded to `agentic.stigmer.ai/v1`, making it wrong for IAM and tenancy resources
- 12 resources with identical patterns (CommandController + QueryController + ApiResourceMetadata + Spec) had no SDK coverage

## Solution

Made the entire codegen pipeline data-driven by auto-discovering resources from proto definitions and auto-deriving all configuration from service schema JSON.

## Implementation Details

### Stage 1: proto2schema auto-discovery

- Removed `sdkResources` hardcoded map from `tools/codegen/proto2schema/main.go`
- Rewrote `generateSDKServiceSchemas` to scan all namespaces (`agentic/`, `iam/`, `tenancy/`) for subdirectories containing gRPC services
- Removed `session` from the skip list (it has valid command/query controllers)
- Added directory cleaning before schema generation to prevent stale files from previous runs
- Kept a minimal `searchListResources` allowlist for SearchService-backed listing (server-side indexing concern)

### Stage 2: sdk_client.go auto-derivation

- Removed `resourceConfig` and `protoPackageToImport` hardcoded maps from `tools/codegen/generator/sdk_client.go`
- Added `deriveResourceConfig()` that auto-derives client name, proto type, ID type, spec schema path, and API version from the service schema JSON
- Added `deriveApiVersion()` to produce namespace-specific API versions (`agentic.stigmer.ai/v1`, `tenancy.stigmer.ai/v1`, `iam.stigmer.ai/v1`)
- Added `deriveGoImportPath()` to compute Go import paths from proto package names
- Generalized `protoKindName` via `pascalToSnake()` instead of a hardcoded switch

### Edge cases handled for new resources

- `google.protobuf.Empty` input/output types: methods with Empty input take only `ctx`, methods with Empty output return only `error`
- `google.protobuf.Timestamp` fields: RFC3339 string parsing in `toProto()` with `timestamppb.New()`
- `google.protobuf.Struct` fields: conversion via `structpb.NewStruct()`
- Proto enum fields: use the proto enum Go type directly in input structs
- `ApiResourceReference` value-type nil checks: use zero-value check instead of nil check
- `EnvironmentValue` map fields: explicit field construction alongside `ExecutionValue` handling
- Stream type name collisions: prefixed with resource type (e.g., `AgentExecutionSubscribeStream`)

### Generated client.go and types.go

- `internal/gen/client.go` is now generated with a `Client` struct aggregating all 17 sub-clients and a `NewClient()` constructor
- `sdk/go/types.go` is now generated with type aliases for all client types, input types, streaming types, and shared types
- `sdk/go/client.go` embeds `*gen.Client` instead of listing resources individually, making it permanently stable

## Resources Now Covered

| Namespace | Resources |
|-----------|-----------|
| **Agentic** | agent, agentexecution, agentinstance, environment, executioncontext, mcpserver, session, skill, workflow, workflowexecution, workflowinstance |
| **IAM** | apikey, iampolicy, identityaccount, identityprovider |
| **Tenancy** | organization, project |

## Benefits

- **Zero-effort resource additions**: new proto resources automatically get SDK clients on next `make codegen`
- **Eliminated 3 hardcoded lists** that required manual updates
- **Generated 2 previously hand-written files** (`client.go`, `types.go`)
- **Net reduction of ~5,000 lines**: removed stale schemas, hand-written code, and unused rule files
- **Correct API versioning** for all namespaces (was previously wrong for non-agentic resources)
- **Robust edge-case handling** for Empty, Timestamp, Struct, enum, and value-type message fields

## Impact

- SDK users can now access all Stigmer API resources through a single client
- Platform team no longer needs to touch SDK code when adding new API resources
- The `make codegen-verify` pipeline (codegen + build + test) passes cleanly

## Related Work

- [Go SDK Stripe-Style Restructure](2026-03-16-112653-go-sdk-stripe-style-restructure.md) - initial restructure that this change extends

---

**Status**: Production Ready
