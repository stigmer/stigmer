# Notes: 20260316.02.java-sdk-codegen

**Created**: 2026-03-16

## Purpose

Use this file to capture important information as you work:

- 🎯 **Decisions**: Why you chose approach A over B
- 🐛 **Gotchas**: Issues discovered and how you solved them
- 💡 **Learnings**: Insights that might help later
- 📝 **Commands**: Useful commands or snippets
- 🔗 **References**: Links to docs, Stack Overflow, etc.

Keep entries **timestamped** and **concise**. This isn't a novel - just enough context to remember later.

---

## 2026-03-16 — Project Context and Design Notes

### Relationship to Go SDK Codegen

This project extends the same codegen pipeline used for Go and TypeScript SDKs:

```
Proto files (apis/)
    ↓
proto2schema (Stage 1) → JSON service schemas + spec schemas
    ↓
sdk_client.go (Stage 2, Go)       → sdk/go/internal/gen/
sdk_client_ts.go (Stage 2, TS)    → sdk/typescript/src/gen/
sdk_client_java.go (Stage 2, Java) → sdk/java/src/main/java/.../internal/gen/   ← NEW
```

Stage 1 is shared. Only Stage 2 (the language-specific generator) is new for Java.

### Key Design Decisions from Go SDK (carry forward)

- **Domain naming**: `client.agentExecution()` not `client.execution()` — respect ubiquitous language
- **Singular accessors in Go/TS, but Java convention may differ**: Go uses `client.Agent`, TS uses `client.agent`, Java should use `client.agents()` (plural method accessor — idiomatic Java, follows Stripe SDK pattern)
- **Input type naming**: `AgentInput` (not `CreateAgentInput`) — same input for Create, Update, Apply
- **Builder pattern for Java inputs**: Java doesn't have struct literals — use builder pattern
- **Hybrid types**: Proto types for responses, custom Java types for inputs (ergonomic + clean)

### Java SDK API Surface Comparison

| Go SDK | TypeScript SDK | Java SDK (proposed) |
|--------|---------------|-------------------|
| `stigmer.NewClient(apiKey)` | `new StigmerClient(apiKey)` | `StigmerClient.builder(apiKey).build()` |
| `client.Agent.Create(ctx, input)` | `client.agent.create(input)` | `client.agents().create(input)` |
| `client.AgentExecution.Subscribe(ctx, id)` | `client.agentExecution.subscribe(id)` | `client.agentExecutions().subscribe(id)` |
| `*stigmer.Error` | `StigmerError` | `StigmerException` |
| `stigmer.IsNotFound(err)` | `isNotFound(err)` | `StigmerException.isNotFound(e)` |

### Java Package Distribution — How It Works

**There is only one repository: Maven Central.** Unlike npm (npmjs.com) or PyPI (pypi.org) where there's one obvious place, Java historically had two — Maven Central and JCenter. JCenter was permanently shut down in August 2024 and now redirects to Maven Central. So there is exactly one place to publish.

**Both Maven and Gradle users consume from Maven Central.** Publishing to Maven Central automatically makes the library available to:
- **Maven users**: `<dependency><groupId>ai.stigmer</groupId><artifactId>stigmer-java</artifactId></dependency>`
- **Gradle users**: `implementation "ai.stigmer:stigmer-java:0.1.0"`
- **Gradle Kotlin DSL users**: `implementation("ai.stigmer:stigmer-java:0.1.0")`
- **Manual JAR download**: also available from Maven Central's UI

There is no separate "publish to Gradle" step. Maven Central is the universal source.

**Stripe's approach (our model)**: Stripe's `stripe-java` SDK (`com.stripe:stripe-java`) is published to Maven Central only. Their README shows both Maven `<dependency>` and Gradle `implementation` snippets. They build with Gradle but publish to Maven Central — the build tool used to *create* the library is independent of how consumers *use* it.

### Build Tool Decision: Maven vs Gradle for Building the SDK

**Option A: Maven (pom.xml)**
- Simpler, more declarative, less magic
- Standard for Java library publishing
- Well-supported by Central Portal publishing plugins
- Pro: easier for codegen to generate `pom.xml` (XML is simpler to template than Groovy/Kotlin DSL)
- Con: more verbose

**Option B: Gradle (build.gradle.kts)**
- Modern, flexible, faster builds
- Kotlin DSL is type-safe
- `vanniktech/gradle-maven-publish-plugin` simplifies Central Portal publishing
- Con: Gradle version management adds complexity

**Recommendation**: Use **Maven** for building. It's simpler for a codegen-driven project, and the publishing pipeline is more straightforward with `maven-gpg-plugin` + `central-publishing-maven-plugin`. This is the build tool choice — it has zero effect on consumers who can use either Maven or Gradle.

### Publishing to Maven Central — What the Owner Needs to Do

**One-time account setup:**

1. **Create account**: https://central.sonatype.com (sign in with GitHub)
2. **Verify namespace** (choose one):
   - `io.github.stigmer` — automatic via GitHub org ownership (create a public repo named after the verification key). Fast, recommended to start.
   - `ai.stigmer` — requires DNS TXT record on `stigmer.ai` domain. Cleaner, but takes longer to verify.
3. **Generate GPG key**: 
   ```bash
   gpg --full-generate-key  # RSA 4096-bit, no expiration or long expiration
   gpg --list-keys --keyid-format short  # note the KEY_ID
   ```
4. **Publish public key to keyserver**:
   ```bash
   gpg --keyserver keyserver.ubuntu.com --send-keys <KEY_ID>
   ```
5. **Export private key for CI**:
   ```bash
   gpg --export-secret-keys --armor <KEY_ID> > private-key.asc
   # Store contents as GitHub Secret: GPG_PRIVATE_KEY
   # Store passphrase as GitHub Secret: GPG_PASSPHRASE
   ```
6. **Generate Central Portal token**: 
   - Central Portal → Settings → API Tokens → Generate
   - Store as GitHub Secrets: `MAVEN_CENTRAL_USERNAME` + `MAVEN_CENTRAL_PASSWORD`

**What gets published per release:**

| File | Purpose |
|------|---------|
| `stigmer-java-0.1.0.jar` | The SDK library |
| `stigmer-java-0.1.0-sources.jar` | Source code (required by Central) |
| `stigmer-java-0.1.0-javadoc.jar` | Javadoc (required by Central) |
| `stigmer-java-0.1.0.pom` | POM with metadata |
| `*.asc` | GPG signature for each file above |
| `*.md5`, `*.sha1` | Checksums (auto-generated) |

**POM metadata requirements** (Central Portal validates these):
- `<name>`, `<description>`, `<url>`
- `<licenses>` (Apache-2.0)
- `<developers>` (at least one with name + email)
- `<scm>` (GitHub repo URL)
- Valid GAV (groupId + artifactId + version)

### Proto Stubs for Java — Options

**Option A: Generated stubs as Maven module in-repo**
- `apis/stubs/java/` with its own `pom.xml`
- SDK depends on it via `<dependency>` with relative path or installed to local Maven repo
- Pro: simple, no separate publishing
- Con: users who want just the SDK need stubs too

**Option B: Separate published artifact**
- `ai.stigmer:stigmer-java-stubs` published to Maven Central alongside the SDK
- Pro: clean separation, users can use stubs directly for custom gRPC clients
- Con: two artifacts to maintain and version

**Recommendation**: Start with Option A (in-repo module), migrate to Option B when publishing is set up.

### Reference Files

- Go codegen: `tools/codegen/generator/sdk_client.go` (1,245 lines)
- TS codegen: `tools/codegen/generator/sdk_client_ts.go` (1,027 lines)
- Go SDK public surface: `sdk/go/client.go`, `sdk/go/options.go`, `sdk/go/search.go`, `sdk/go/errors.go`, `sdk/go/types.go`
- Go SDK generated code: `sdk/go/internal/gen/*.go` (17 resource files + client.go + types.go + errors.go)
- Service schemas: `tools/codegen/schemas/services/*.json`
- Spec schemas: `tools/codegen/schemas/<namespace>/<resource>/<resource>.json`
- Proto definitions: `apis/ai/stigmer/` (agentic/, iam/, tenancy/ namespaces)

---

## 2026-03-16 — Task 1 Implementation Notes

### Buf Managed Mode: `java_package` Must Be Disabled

Buf's managed mode with `enabled: true` automatically sets `java_package_prefix` to `com.`, causing packages like `com.ai.stigmer.agentic.agent.v1`. This is wrong for our case — we want the proto package to map directly.

Fix: `disable: [{file_option: java_package}]` in `buf.gen.java.yaml`.

### Buf Plugin Version Format

Buf remote plugin versions don't match Maven artifact versions:
- Buf plugin: `buf.build/protocolbuffers/java:v34.0` (base protobuf version)
- Maven artifact: `com.google.protobuf:protobuf-java:4.34.0` (Java-specific version with `4.` prefix)

### protovalidate Dependency Is Required

68 generated `*Proto.java` files (file descriptor classes) reference `build.buf.validate.ValidateProto.getDescriptor()` and `.field`. This is actual code, not just comments. The `build.buf:protovalidate:1.1.1` Maven dependency provides these classes.

### Java Stubs Pinned Versions

| Component | Version |
|-----------|---------|
| Buf protobuf-java plugin | v34.0 |
| Buf grpc-java plugin | v1.79.0 |
| protobuf-java Maven | 4.34.0 |
| grpc-java Maven | 1.79.0 |
| protovalidate Maven | 1.1.1 |

### Generated Output Stats

- 676 Java files
- Covers: agentic (11 resources), iam (4 resources), tenancy (2 resources), commons, search
- Both protobuf messages and gRPC service stubs (command + query controllers)
- Standard Maven layout: `stubs/java/src/main/java/ai/stigmer/...`

---

