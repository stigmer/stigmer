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

**Last Updated**: 2026-03-16 14:10 — Tasks 1, 2, 3 complete + package rename done, ready for Task 4
**Current Focus**: Task 4 (Wire codegen into build pipeline) is next

---

## Session Progress (2026-03-16, Session 4)

- Performed architectural review of `internal.gen` package naming across all SDKs
- Renamed Java generated package from `ai.stigmer.sdk.internal.gen` to `ai.stigmer.sdk.gen`
- Changed `javaGenPackage` constant in `tools/codegen/generator/sdk_client_java.go`
- Updated `SDK_GEN_DIR` in `sdk/java/Makefile`
- Updated imports in `StigmerClient.java` (18 imports) and `SearchClient.java` (2 imports)
- Deleted old `internal/gen/` directory, regenerated 46 files into `gen/`
- Added `target/` to root `.gitignore` (Java/Maven build output was not ignored)
- Clean compile (50 files) and all 7 tests pass
- Committed: `e2cb987a`

### Design Decisions Made (Session 4)

- **Package `ai.stigmer.sdk.gen`** (not flat `ai.stigmer.sdk`) — keeps generated code in a dedicated directory that can be safely `rm -rf`'d during codegen without deleting hand-written sources
- **`internal/transport/` unchanged** — `StigmerChannel` and `ApiKeyInterceptor` are genuinely internal (users should never instantiate these)
- **Go, Python, TypeScript SDKs unchanged** — Go's `internal/` is compiler-enforced + has a public facade; Python re-exports via `__init__.py`; TypeScript re-exports via barrel `index.ts`

## Session Progress (2026-03-16, Session 3)

- Completed Task 3: Scaffolded handwritten public API layer for Java SDK
- Created transport layer: `ApiKeyInterceptor.java`, `StigmerChannel.java`
- Created `StigmerClient.java` with builder pattern, 17 sub-client accessors, `AutoCloseable`
- Created `SearchClient.java` for cross-resource search
- Created `sdk/java/Makefile` with codegen, build, test, codegen-verify targets
- Created `StigmerClientTest.java` with 7 unit tests (all pass)
- Committed: `92aa5047`

## Next Steps

1. **Task 4**: Wire codegen into build pipeline (`make protos` chains Java SDK)
   - Update root `Makefile` `protos` target to chain `make -C sdk/java codegen`
   - Test full pipeline: `make protos` generates all stubs and SDKs
2. **Task 5**: Maven Central publishing setup

## Context for Resume

### Codegen Pipeline Architecture

The Java SDK reuses the same two-stage codegen pipeline as Go and TypeScript:

1. **Stage 1 (shared)**: `proto2schema` extracts service schemas from proto definitions -> JSON at `tools/codegen/schemas/`
2. **Stage 2 (per-language)**: Generator reads JSON schemas -> emits language-specific SDK code
   - Go: `tools/codegen/generator/sdk_client.go` -> `sdk/go/internal/gen/`
   - TS: `tools/codegen/generator/sdk_client_ts.go` -> `sdk/typescript/src/gen/`
   - Java: `tools/codegen/generator/sdk_client_java.go` -> `sdk/java/src/main/java/.../gen/`

### Generated Code Structure

```
sdk/java/src/main/java/ai/stigmer/sdk/gen/
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
- `_changelog/2026-03/2026-03-16-140949-java-sdk-remove-internal-from-generated-package.md`

---

## Quick Commands

After loading this file into chat, you can say:

- **"Continue with Task 4"** — Wire codegen into `make protos` pipeline
- **"Show current status"** — Get overview of all tasks and progress
- **"What's next?"** — Move to next task

---

*Quick Project Framework: Minimal overhead, maximum focus.*
