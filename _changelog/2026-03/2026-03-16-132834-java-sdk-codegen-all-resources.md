# Java SDK Code Generator for All 17 API Resources

**Date**: March 16, 2026

## Summary

Created a complete Java SDK code generator (`sdk_client_java.go`, ~1,560 lines) that reads Stage 1 service schema JSON and emits a full Java SDK client layer — 45 generated Java files covering all 17 Stigmer API resources, with Stripe-style builders, unchecked exception wrapping, and streaming support. All generated code compiles cleanly against the Java proto stubs.

## Problem Statement

The Stigmer platform has Go and TypeScript SDKs generated from a shared codegen pipeline, but Java developers had no ergonomic SDK. They would need to work directly with raw gRPC stubs, manually constructing protobuf messages and handling `StatusRuntimeException` — a poor developer experience for the most popular enterprise language.

### Pain Points

- Java developers forced to use raw gRPC stubs (verbose, error-prone)
- No builder pattern for input construction — must use protobuf's `newBuilder()` chains directly
- No unified exception handling — `StatusRuntimeException` is untyped
- No consistent naming conventions — proto snake_case vs Java camelCase mismatch
- No streaming ergonomics — raw `Iterator<T>` with no error wrapping

## Solution

Extended the existing Go-based codegen pipeline with a new `sdk_client_java.go` generator that mirrors the Go and TypeScript generators' architecture but emits idiomatic Java code following enterprise SDK patterns (AWS SDK v2, Stripe Java).

## Implementation Details

### Generator Architecture (`sdk_client_java.go`)

The generator follows the same function decomposition as the Go/TS generators:

- `runSDKClientJavaGeneration()` — entry point, iterates schemas, orchestrates generation
- `generateJavaClientClass()` — per-resource client with `BlockingStub` fields and method dispatch
- `generateJavaMethod()` / `generateJavaStreamingMethod()` — handles all method signatures (unary, ID-input, delete-input, resource-input, empty-input/output, streaming)
- `generateJavaSearchList()` — list via SearchService with `ApiResourceKind` enum
- `generateJavaInputClass()` — input types with Builder pattern and `toProto()` conversion
- `emitJavaToProtoField()` / `emitJavaNestedToProtoField()` — field-level proto conversion for all type kinds
- `generateJavaClientFile()` — aggregate `GeneratedClient` wiring all 17 sub-clients

### Java-Specific Infrastructure

- **`javaImportSet`**: Tracks and deduplicates Java imports, filters `java.lang.*`, emits sorted import block
- **Naming helpers**: `javaCapCamel()`, `javaCamel()`, `javaSetterName()`, `javaAddAllName()`, `javaPutAllName()` — converts proto snake_case to Java conventions
- **Type mapping**: `javaTypeForTypeSpec()` maps proto types to Java types (`string` -> `String`, `int32` -> `int`, `timestamp` -> `String`, `struct` -> `Map<String, Object>`, message -> `XxxInput`)
- **Import resolution**: `resolveJavaFQCN()` derives Java class paths directly from proto packages (since `java_package` managed mode was disabled in Task 1)

### Generated Output (45 files)

**Shared Types (11)**:
- `StigmerException.java` — unchecked exception wrapping `StatusRuntimeException` with sentinel methods (`isNotFound()`, `isRetryable()`)
- `ErrorCode.java` — enum mapping gRPC status codes
- `DeleteResourceInput.java`, `ResourceRef.java` — shared input types with builders
- `Page.java`, `ListParams.java`, `ListResult.java` — pagination
- `EnvVarInput.java`, `EnvSpecInput.java` — environment configuration
- `StigmerStream.java` — generic `Iterator<T>` wrapper with auto error wrapping
- `ProtoConvert.java` — `Map<String, Object>` to `Struct`/`Value` conversion

**Per-Resource (34)**: 17 clients + 17 inputs, each with nested `public static` inner classes for sub-message types and Builder pattern.

**Aggregate (1)**: `GeneratedClient.java` — wires all 17 resource sub-clients from a single `Channel`.

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| gRPC Stub | `BlockingStub` | Synchronous, `Iterator<T>` for streaming, unchecked exceptions |
| Exception | `StigmerException extends RuntimeException` | Modern SDK pattern (AWS v2, Google Cloud), no forced `throws` |
| Builders | Stripe-style immutable inputs | `AgentInput.builder().name("x").build()` |
| Nested types | `public static inner class` | Groups related types, prevents file explosion |
| Streaming | Generic `StigmerStream<T>` | Single class, auto error wrapping |

## Benefits

- **Developer ergonomics**: Java developers get a clean, builder-based API instead of raw protobuf
- **Consistency**: Same API surface patterns as Go and TypeScript SDKs
- **Type safety**: Compile-time checking for all inputs; no stringly-typed proto construction
- **Error handling**: Structured `StigmerException` with semantic checks (`isNotFound()`, `isRetryable()`)
- **Maintainability**: Fully generated from schemas — proto changes automatically propagate to Java SDK

## Impact

- **Java ecosystem**: Enables first-class Stigmer SDK for Java/Kotlin/JVM developers
- **Codegen pipeline**: Third language target added to the shared generator infrastructure
- **17 resources covered**: agent, agentexecution, agentinstance, apikey, environment, executioncontext, iampolicy, identityaccount, identityprovider, mcpserver, organization, project, session, skill, workflow, workflowexecution, workflowinstance

## Related Work

- `2026-03-16-112653-go-sdk-stripe-style-restructure.md` — Go SDK restructure (established the codegen patterns)
- `2026-03-16-115418-go-sdk-all-resource-codegen.md` — Go SDK resource codegen (17 resources)
- Task 1 of this project (Java proto stub generation via Buf) — prerequisite

---

**Status**: Production Ready (codegen layer complete; handwritten public API layer is Task 3)
**Timeline**: ~2 hours (planning + implementation + verification)
