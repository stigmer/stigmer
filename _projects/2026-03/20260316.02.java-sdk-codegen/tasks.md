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

**Status**: ⏸️ TODO
**Created**: 2026-03-16 12:10

### Subtasks
- [ ] Create `tools/codegen/generator/sdk_client_java.go` following Go/TS generator patterns
- [ ] Generate per-resource client classes: `AgentClient.java`, `SkillClient.java`, etc.
- [ ] Generate input types from spec schemas: `AgentInput.java` with `toProto()` conversion (builder pattern)
- [ ] Generate shared types: `DeleteResourceInput.java`, `ResourceRef.java`, `Page.java`, `ListParams.java`, `ListResult.java`
- [ ] Generate error types: `StigmerException.java`, `ErrorCode.java`, sentinel check methods
- [ ] Generate aggregate client: `StigmerClient.java` with all sub-client fields
- [ ] Handle Java-specific edge cases: `google.protobuf.Empty`, `Timestamp`, `Struct`, enums
- [ ] Register `sdk-java` target in `tools/codegen/generator/main.go`

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

**Status**: ⏸️ TODO
**Created**: 2026-03-16 12:10

### Subtasks
- [ ] Create `sdk/java/pom.xml` with groupId `ai.stigmer`, artifactId `stigmer-java`
- [ ] Add dependencies: grpc-netty-shaded, grpc-protobuf, grpc-stub, protobuf-java, proto stubs module
- [ ] Create transport layer: `StigmerChannel.java` (gRPC channel factory with TLS + API key interceptor)
- [ ] Create `ApiKeyInterceptor.java` — gRPC `ClientInterceptor` adding `authorization: Bearer <key>` header
- [ ] Create `StigmerException.java` + `ErrorCode.java` (handwritten or use generated version)
- [ ] Create public API surface: `StigmerClient.java` (builder, sub-client accessors, close)
- [ ] Create `StigmerClientOptions.java` — baseUrl, insecure mode, custom channel options
- [ ] Create `SearchClient.java` for cross-resource search queries
- [ ] Add `sdk/java/Makefile` with `codegen`, `codegen-verify`, `build`, `test` targets
- [ ] Write basic unit tests

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

**Status**: ⏸️ TODO
**Created**: 2026-03-16 12:10

### Subtasks
- [ ] Add `sdk-java` target to `tools/codegen/generator/main.go` dispatch
- [ ] Add `sdk/java/Makefile` with `codegen` target that calls the generator
- [ ] Update root `Makefile` `protos` target to chain Java SDK codegen: `$(MAKE) -C sdk/java codegen`
- [ ] Add `codegen-verify` target in `sdk/java/Makefile`: codegen + mvn compile + mvn test
- [ ] Test full pipeline: `make protos` generates Go stubs, TS stubs, Java stubs, Go SDK, TS SDK, Java SDK

### Notes
- Pattern follows Go SDK: root `make protos` → `make -C apis build` → `make -C sdk/go codegen` → NEW: `make -C sdk/java codegen`
- `codegen-verify` = regenerate + build + test (catches drift)

## Task 5: Maven Central publishing setup (covers Maven + Gradle + all Java consumers)

**Status**: ⏸️ TODO
**Created**: 2026-03-16 12:10

### Key Insight: One Repository Serves All

**Maven Central is the single repository for all Java libraries.** JCenter shut down permanently in August 2024. Publishing to Maven Central automatically makes the library available to:
- Maven users (`<dependency>` in pom.xml)
- Gradle Groovy DSL users (`implementation "ai.stigmer:stigmer-java:0.1.0"`)
- Gradle Kotlin DSL users (`implementation("ai.stigmer:stigmer-java:0.1.0")`)
- Manual JAR download from Maven Central's web UI
- Any JVM build tool (sbt, Leiningen, Bazel, etc.)

There is **no separate Gradle repository** to publish to. This is unlike npm/PyPI — Java has one central place.

### Subtasks
- [ ] Configure `pom.xml` with required Maven Central metadata (name, description, url, licenses, developers, scm)
- [ ] Add `maven-gpg-plugin` for artifact signing
- [ ] Add `maven-source-plugin` and `maven-javadoc-plugin` (required for Central)
- [ ] Add `central-publishing-maven-plugin` (new Sonatype Central Portal plugin, replaces deprecated nexus-staging-maven-plugin)
- [ ] Create `.github/workflows/release.maven.yaml` — triggered by version tags, builds + signs + publishes
- [ ] Document version tagging strategy: `sdk/java/v0.1.0` tag format
- [ ] Add SDK README with both Maven and Gradle installation snippets (like Stripe does)

### Owner Action Items (one-time setup)
- [ ] Create Central Portal account at https://central.sonatype.com (GitHub sign-in)
- [ ] Verify namespace: `io.github.stigmer` (auto via GitHub org) or `ai.stigmer` (DNS TXT record on stigmer.ai)
- [ ] Generate GPG key: `gpg --full-generate-key` (RSA 4096-bit)
- [ ] Publish GPG public key: `gpg --keyserver keyserver.ubuntu.com --send-keys <KEY_ID>`
- [ ] Export GPG private key → GitHub Secret `GPG_PRIVATE_KEY`
- [ ] Store GPG passphrase → GitHub Secret `GPG_PASSPHRASE`
- [ ] Generate Central Portal API token → GitHub Secrets `MAVEN_CENTRAL_USERNAME` + `MAVEN_CENTRAL_PASSWORD`

### Maven Central Validation Checklist (auto-checked on upload)
- [ ] `stigmer-java-<version>.jar` — the library
- [ ] `stigmer-java-<version>-sources.jar` — source code
- [ ] `stigmer-java-<version>-javadoc.jar` — javadoc
- [ ] `stigmer-java-<version>.pom` — POM with name, description, url, license, developers, scm
- [ ] `*.asc` — GPG signature for each file
- [ ] `*.md5`, `*.sha1` — checksums (auto-generated by Maven)

### SDK README Installation Section (template)

```markdown
### Maven
<dependency>
  <groupId>ai.stigmer</groupId>
  <artifactId>stigmer-java</artifactId>
  <version>0.1.0</version>
</dependency>

### Gradle (Groovy)
implementation "ai.stigmer:stigmer-java:0.1.0"

### Gradle (Kotlin DSL)
implementation("ai.stigmer:stigmer-java:0.1.0")
```

### Notes
- The old OSSRH publishing pipeline is deprecated as of June 2025 — use `central-publishing-maven-plugin` instead
- GroupId `ai.stigmer` requires DNS TXT record verification; `io.github.stigmer` is auto-verified via GitHub org
- Recommendation: start with `io.github.stigmer` for speed, migrate to `ai.stigmer` after DNS verification
- Reference: Stripe publishes `com.stripe:stripe-java` to Maven Central only, documents both Maven and Gradle install snippets


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

