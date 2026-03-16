# Tasks: 20260316.02.java-sdk-codegen

**Created**: 2026-03-16

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: Add Java proto stub generation via Buf

**Status**: ✅ DONE
**Created**: 2026-03-16 12:10
**Completed**: 2026-03-16 12:39

### Subtasks
- [x] Create `apis/buf.gen.java.yaml` — protobuf-java v34.0 + grpc-java v1.79.0, managed mode with `java_multiple_files=true`, `java_package` disabled to prevent `com.` prefix
- [x] Add `java-stubs`, `java-stubs-clean`, `java-stubs-init` targets to `apis/Makefile`
- [x] Add `java-stubs` to the `build` target in `apis/Makefile`
- [x] Verify generated stubs compile — 676 files, `mvn clean compile` passes with zero warnings
- [x] Java package naming decided: direct mapping from proto packages (`ai.stigmer.agentic.agent.v1` → Java package `ai.stigmer.agentic.agent.v1`)

### Deliverables
- `apis/buf.gen.java.yaml` — Buf generation config
- `apis/stubs/java/pom.xml` — Maven project for compilation verification (protobuf-java 4.34.0, grpc-java 1.79.0, protovalidate 1.1.1)
- `apis/stubs/java/.gitignore` — Excludes `target/`
- `apis/stubs/java/src/main/java/` — 676 generated Java files (standard Maven layout)

### Surprises Resolved
1. Buf managed mode defaults `java_package_prefix` to `com.` — fixed by disabling `java_package`
2. Buf plugin version format is `v34.0` not `v4.34.0` (base protobuf version, not Maven artifact version)
3. 68 generated files reference `build.buf.validate.ValidateProto` in descriptor code — required `build.buf:protovalidate:1.1.1` Maven dependency

### Reference
- `apis/buf.gen.go.yaml` for plugin configuration pattern
- `apis/Makefile` for stub generation targets pattern

## Task 2: Create sdk_client_java.go codegen

**Status**: ✅ DONE
**Created**: 2026-03-16 12:10
**Completed**: 2026-03-16 13:28

### Subtasks
- [x] Create `tools/codegen/generator/sdk_client_java.go` following Go/TS generator patterns (~1,560 lines)
- [x] Generate per-resource client classes: `AgentClient.java`, `SkillClient.java`, etc. (17 clients)
- [x] Generate input types from spec schemas: `AgentInput.java` with `toProto()` conversion (builder pattern, 17 input types)
- [x] Generate shared types: `DeleteResourceInput.java`, `ResourceRef.java`, `Page.java`, `ListParams.java`, `ListResult.java`, `EnvVarInput.java`, `EnvSpecInput.java`, `StigmerStream.java`, `ProtoConvert.java`
- [x] Generate error types: `StigmerException.java` (unchecked RuntimeException), `ErrorCode.java` with sentinel check methods
- [x] Generate aggregate client: `GeneratedClient.java` with all 17 sub-client fields
- [x] Handle Java-specific edge cases: `google.protobuf.Empty`, `Timestamp`, `Struct`, enums, map fields (`putAll`), array fields (`addAll`)
- [x] Register `sdk-client-java` target in `tools/codegen/generator/main.go`
- [x] Verify compilation: all 46 generated Java files compile cleanly against proto stubs (`mvn compile` → BUILD SUCCESS)

### Deliverables
- `tools/codegen/generator/sdk_client_java.go` — Java SDK code generator (1,560 lines)
- `tools/codegen/generator/main.go` — Updated with `sdk-client-java` target
- `sdk/java/pom.xml` — Maven project for SDK compilation
- `sdk/java/src/main/java/ai/stigmer/sdk/internal/gen/` — 45 generated Java files (11 shared + 17 clients + 17 inputs)

### Design Decisions
1. **Stub variant**: `BlockingStub` (synchronous API, unchecked `StatusRuntimeException`)
2. **Exception strategy**: Unchecked `StigmerException extends RuntimeException` (AWS SDK v2 pattern)
3. **File organization**: One public class per `.java` file, nested input types as `public static inner class`
4. **Builder pattern**: Stripe-style immutable inputs (`AgentInput.builder().name("x").build()`)
5. **Streaming**: Generic `StigmerStream<T>` wrapping `Iterator<T>` with auto error wrapping
6. **Import derivation**: Proto package = Java package directly (since `java_package` disabled in Task 1)

### Bugs Fixed During Implementation
1. `emitJavaNestedToProtoField` had unreachable enum-string case (case ordering bug)
2. Missing `map` field handling in nested toProto — `putAll` was generated as `set`

### Notes
- Reuses Stage 1 output (service schema JSON from `proto2schema`) — only Stage 2 is new
- Java naming conventions: `client.agents().create(input)` (method-accessor pattern, lowercase plural)
- Generated code output to `sdk/java/src/main/java/ai/stigmer/sdk/internal/gen/`
- Builder pattern for input types: `AgentInput.builder().name("x").org("y").build()`

### API Surface Design
```java
StigmerClient client = StigmerClient.builder("sk_live_abc123").build();
Agent agent = client.agents().create(AgentInput.builder()
    .name("my-agent")
    .org("my-org")
    .instructions("You are a helpful assistant")
    .build());
Agent fetched = client.agents().get(agentId);
client.agents().delete(DeleteResourceInput.builder().resourceId(agentId).build());
```

### Reference
- `tools/codegen/generator/sdk_client.go` — Go generator (1,245 lines, the primary reference)
- `tools/codegen/generator/sdk_client_ts.go` — TypeScript generator (1,027 lines)
- Both share `ServiceSchemaFile`, `deriveResourceConfig()`, `loadSpecSchemaWithTypes()` from `sdk_client.go`

## Task 3: Scaffold sdk/java Maven project

**Status**: ✅ DONE
**Created**: 2026-03-16 12:10
**Completed**: 2026-03-16 13:56

### Subtasks
- [x] Update `sdk/java/pom.xml` — renamed artifactId to `stigmer-java`, added grpc-netty-shaded, JUnit 5, maven-compiler-plugin 3.13.0, maven-surefire-plugin 3.5.2
- [x] Create transport layer: `StigmerChannel.java` (gRPC channel factory with TLS via NettyChannelBuilder, insecure via plaintext)
- [x] Create `ApiKeyInterceptor.java` — gRPC `ClientInterceptor` adding `Authorization: Bearer <key>` via metadata
- [x] Create public API surface: `StigmerClient.java` (builder with required API key param, 17 sub-client accessors, AutoCloseable with graceful 5s shutdown)
- [x] Create `SearchClient.java` for cross-resource search (SearchParams builder, SearchResponse, wraps StigmerException)
- [x] Add `sdk/java/Makefile` with `codegen-clients`, `codegen`, `build`, `test`, `verify`, `codegen-verify`, `clean` targets
- [x] Write unit tests: `StigmerClientTest.java` (7 tests — builder validation, lifecycle, sub-client access)
- [x] Verify: `mvn compile` (50 files, BUILD SUCCESS) and `mvn test` (7 tests, 0 failures)

### Directory Structure
```
sdk/java/
├── pom.xml
├── Makefile
├── README.md
├── src/main/java/ai/stigmer/sdk/
│   ├── StigmerClient.java          (public entry point)
│   ├── StigmerClientOptions.java   (configuration)
│   ├── StigmerException.java       (error type)
│   ├── ErrorCode.java              (error codes)
│   ├── SearchClient.java           (cross-resource search)
│   └── internal/
│       ├── gen/                     (codegen output — wiped on regeneration)
│       │   ├── AgentClient.java
│       │   ├── AgentInput.java
│       │   ├── ...
│       │   └── SharedTypes.java
│       └── transport/
│           ├── StigmerChannel.java
│           └── ApiKeyInterceptor.java
├── src/test/java/ai/stigmer/sdk/
│   └── StigmerClientTest.java
└── examples/
    ├── BasicCrud.java
    └── StreamingExecution.java
```

### Notes
- Java version: 17+ (LTS, widely adopted, sealed classes optional but nice)
- gRPC-Java uses `ManagedChannel` + `ManagedChannelBuilder`, not raw `grpc.Dial` like Go
- Proto stubs dependency: either as a local Maven module or published separately
- Consider multi-module Maven project: `stigmer-java-stubs` + `stigmer-java` (or single module with stubs as dependency)

## Task 4: Wire codegen into build pipeline

**Status**: ✅ DONE
**Created**: 2026-03-16 12:10
**Completed**: 2026-03-16 14:19

### Subtasks
- [x] Add `sdk-client-java` target to `tools/codegen/generator/main.go` dispatch (done in Task 2, session 2)
- [x] Add `sdk/java/Makefile` with `codegen` target that calls the generator (done in Task 3, session 3)
- [x] Update root `Makefile` `protos` target to chain Java SDK codegen: `$(MAKE) -C sdk/java codegen`
- [x] Add `codegen-verify` target in `sdk/java/Makefile`: codegen + mvn compile + mvn test (done in Task 3, session 3)
- [x] Add `sdk/java/.gitignore` to exclude `target/` and IDE files (was missing, ~90 stale `.class` files polluting git status)
- [x] Test pipeline: `make -C sdk/java codegen-verify` passes (46 generated files, 50 total compile, 7 tests pass)
- [x] Test full SDK codegen chain: Go → TS → Python → Java all regenerate successfully in sequence

### Notes
- Pattern follows Go SDK: root `make protos` → `make -C apis build` → `make -C sdk/go codegen` → ... → `make -C sdk/java codegen`
- `codegen-verify` = regenerate + build + test (catches drift)
- Most subtasks were already completed in Tasks 2 and 3; this session wired the root Makefile and added the missing `.gitignore`
- Pre-existing `make protos` issue: `apis build` fails at Bazel/Gazelle step because `sdk/go/BUILD.bazel` was deleted in a prior session (unrelated to Java SDK)

## Task 5: Maven Central publishing setup (covers Maven + Gradle + all Java consumers)

**Status**: ✅ DONE
**Created**: 2026-03-16 12:10
**Completed**: 2026-03-16 15:04

### Subtasks
- [x] Configure `pom.xml` with required Maven Central metadata (name, description, url, licenses, developers, scm) — both `apis/stubs/java/pom.xml` and `sdk/java/pom.xml`
- [x] Add `maven-gpg-plugin` 3.2.8 for artifact signing (with `--pinentry-mode loopback` for CI)
- [x] Add `maven-source-plugin` 3.3.1 and `maven-javadoc-plugin` 3.11.2 (required for Central)
- [x] Add `central-publishing-maven-plugin` 0.9.0 with `autoPublish=true`, `waitUntil=published`
- [x] Create `.github/workflows/release.maven.yaml` — three-job workflow: determine-version → publish-stubs → publish-sdk
- [x] Version tagging: uses existing `v*` tag pattern (lockstep with all other SDKs)
- [x] Add SDK README (`sdk/java/README.md`) with Maven + Gradle (Groovy) + Gradle (Kotlin DSL) install snippets

### Owner Action Items (one-time setup) — all completed
- [x] Created Central Portal account at https://central.sonatype.com (GitHub sign-in)
- [x] Verified namespace `ai.stigmer` via DNS TXT record on `stigmer.ai` (migrated DNS from GoDaddy to Cloudflare)
- [x] Generated GPG key: RSA 4096-bit, key ID `29D50099`
- [x] Published GPG public key to `keyserver.ubuntu.com`
- [x] GitHub Secret `GPG_PRIVATE_KEY` set on `stigmer/stigmer`
- [x] GitHub Secret `GPG_PASSPHRASE` set on `stigmer/stigmer`
- [x] GitHub Secrets `MAVEN_CENTRAL_USERNAME` + `MAVEN_CENTRAL_PASSWORD` set on `stigmer/stigmer`

### Deliverables
- `apis/stubs/java/pom.xml` — Central metadata + release profile
- `sdk/java/pom.xml` — Central metadata + release profile + `stigmer-stubs.version` property
- `.github/workflows/release.maven.yaml` — Three-job release workflow
- `sdk/java/README.md` — Full SDK documentation following Python/Go/TS pattern

### Key Design Decisions
- **Release profile** (`-P release`): Signing and publishing plugins isolated from development builds
- **Stubs published separately**: `ai.stigmer:stigmer-java-stubs` published before `ai.stigmer:stigmer-java` (matching Python and TypeScript patterns)
- **Local stubs install**: SDK build installs stubs into local Maven cache to avoid Central propagation delay
- **`ai.stigmer` namespace**: Verified via DNS TXT record rather than using `io.github.stigmer` fallback

### Committed
- `951c3613`

## Project Completion Checklist

When all tasks are done:
- [x] All tasks marked ✅ DONE
- [x] Final testing completed
- [x] Documentation updated (if applicable)
- [x] Code reviewed/validated
- [x] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

