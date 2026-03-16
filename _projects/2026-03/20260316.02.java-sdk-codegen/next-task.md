# Next Task: 20260316.02.java-sdk-codegen

## Quick Resume Instructions

**Simply drop this file into your conversation to quickly resume work on this project.**

All the context you need is right here with absolute paths to project files.

---

## Project Overview

**Name**: 20260316.02.java-sdk-codegen  
**Description**: Generate a Stripe-style Java SDK for all Stigmer API resources using the same codegen pipeline as the Go and TypeScript SDKs. Publish to Maven Central.  
**Goal**: Java SDK with Stripe-style API surface (StigmerClient -> client.agents().create(input)) for all 17 resources, driven by the existing proto2schema + generator codegen pipeline, published as ai.stigmer:stigmer-java to Maven Central  
**Tech Stack**: Java 17+, gRPC-Java, Maven, Go codegen tooling, Buf, GitHub Actions  
**Components**: tools/codegen/generator (new sdk_client_java.go), sdk/java (Maven project), apis (Java proto stubs via buf.gen.java.yaml), .github/workflows (Maven publishing)

**Created**: 2026-03-16  
**Type**: Quick Project (1-2 sessions)

---

## Project Location

**Project Root**: 
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.02.java-sdk-codegen
```

---

## Essential Files

### Tasks (Check current progress here)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.02.java-sdk-codegen/tasks.md
```
All tasks are tracked in this single file. Check status and continue where you left off.

### Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.02.java-sdk-codegen/README.md
```
Project overview, goals, and success criteria.

### Quick Notes
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.02.java-sdk-codegen/notes.md
```
Important decisions, learnings, and gotchas captured during development.

---

## Current Status

**Last Updated**: 2026-03-16 13:28 — Tasks 1 and 2 complete, ready for Task 3
**Current Focus**: Task 3 (Scaffold sdk/java Maven project) is next

---

## Session Progress (2026-03-16, Session 2)

- Completed Task 2: Created `tools/codegen/generator/sdk_client_java.go` (~1,560 lines)
- Generated 45 Java files across 17 resources (11 shared types + 17 clients + 17 inputs)
- All 46 source files compile cleanly against Java proto stubs (`mvn compile` -> BUILD SUCCESS)
- Registered `sdk-client-java` target in generator dispatch
- Created `sdk/java/pom.xml` for compilation verification
- Fixed 2 bugs: case ordering in nested toProto field dispatch, missing map field handling

## Next Steps

1. **Task 3**: Scaffold `sdk/java` Maven project — handwritten public API layer
   - `StigmerClient.java` (builder, sub-client accessors, close)
   - `StigmerChannel.java` (gRPC channel factory with TLS + API key interceptor)
   - `ApiKeyInterceptor.java` (gRPC `ClientInterceptor`)
   - `StigmerClientOptions.java` (configuration)
   - `SearchClient.java` (cross-resource search)
   - `sdk/java/Makefile` with codegen targets
2. **Task 4**: Wire codegen into build pipeline (`make protos` chains Java SDK)
3. **Task 5**: Maven Central publishing setup

## Context for Resume

### Codegen Pipeline Architecture

The Java SDK reuses the same two-stage codegen pipeline as Go and TypeScript:

1. **Stage 1 (shared)**: `proto2schema` extracts service schemas from proto definitions -> JSON at `tools/codegen/schemas/`
2. **Stage 2 (per-language)**: Generator reads JSON schemas -> emits language-specific SDK code
   - Go: `tools/codegen/generator/sdk_client.go` -> `sdk/go/internal/gen/`
   - TS: `tools/codegen/generator/sdk_client_ts.go` -> `sdk/typescript/src/gen/`
   - Java: `tools/codegen/generator/sdk_client_java.go` -> `sdk/java/src/main/java/.../internal/gen/`

### Generated Code Structure

```
sdk/java/src/main/java/ai/stigmer/sdk/internal/gen/
  StigmerException.java          -- error type (extends RuntimeException)
  ErrorCode.java                 -- error code enum
  DeleteResourceInput.java       -- shared delete input
  ResourceRef.java               -- shared resource reference
  Page.java                      -- pagination
  ListParams.java                -- search list params
  ListResult.java                -- search list result
  EnvVarInput.java               -- environment variable input
  EnvSpecInput.java              -- environment spec input
  StigmerStream.java             -- streaming iterator wrapper
  ProtoConvert.java              -- Struct/Value conversion utility
  GeneratedClient.java           -- aggregate client (wires all sub-clients)
  AgentClient.java               -- per-resource client (x17)
  AgentInput.java                -- per-resource input with Builder (x17)
```

### Key Design Decisions (from planning session)

- **Stub variant**: `BlockingStub` (synchronous, `Iterator<T>` for streaming)
- **Exception**: Unchecked `StigmerException extends RuntimeException`
- **Builders**: Stripe-style `AgentInput.builder().name("x").build()`
- **Nested types**: `public static inner class` (e.g., `AgentInput.McpServerUsageInput`)
- **Streaming**: `StigmerStream<T>` wraps `Iterator<T>` with auto error wrapping

### Predecessor Changelogs

- `_changelog/2026-03/2026-03-16-112653-go-sdk-stripe-style-restructure.md`
- `_changelog/2026-03/2026-03-16-115418-go-sdk-all-resource-codegen.md`

---

## Quick Commands

After loading this file into chat, you can say:

- **"Continue with Task 3"** — Start handwritten SDK layer (StigmerClient, transport, etc.)
- **"Show current status"** — Get overview of all tasks and progress
- **"What's next?"** — Move to next task

---

*Quick Project Framework: Minimal overhead, maximum focus.*
