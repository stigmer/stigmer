# Java Proto Stub Generation via Buf

**Date**: March 16, 2026

## Summary

Added Java protobuf and gRPC stub generation to the Stigmer build pipeline, producing 676 compiled Java source files across all 17 API resources plus commons, search, and IAM infrastructure. This is the foundation for the upcoming Java SDK (`ai.stigmer:stigmer-java`).

## Problem Statement

The Stigmer platform generates language-specific proto stubs for Go, Python, and TypeScript, but had no Java support. The Java SDK (Task 2-5 of the java-sdk-codegen project) requires compiled proto stubs as its foundational dependency.

### Pain Points

- No Java stubs meant no path to a Java SDK
- Java developers cannot consume Stigmer APIs from JVM-based applications
- The codegen pipeline only covered three of the four target languages

## Solution

Created a new Buf generation config (`apis/buf.gen.java.yaml`) with `protobuf-java` and `grpc-java` remote plugins, integrated into the existing `apis/Makefile` build pipeline. Added a Maven project (`apis/stubs/java/pom.xml`) for compilation verification.

## Implementation Details

### Buf Generation Config (`apis/buf.gen.java.yaml`)

- **Plugins**: `buf.build/protocolbuffers/java:v34.0` + `buf.build/grpc/java:v1.79.0`
- **Managed mode**: `java_multiple_files = true` (one Java file per message), `optimize_for = SPEED`
- **`java_package` disabled**: Prevents Buf's default `com.` prefix. Proto packages like `ai.stigmer.agentic.agent.v1` map directly to Java packages, which is clean and consistent.
- **Output**: Standard Maven layout at `stubs/java/src/main/java/`

### Makefile Integration

Added `java-stubs`, `java-stubs-clean`, `java-stubs-init` targets to `apis/Makefile`, wired into `build`, `clean`, and `prep` aggregates. Java stubs now generate automatically alongside Go, Python, and TS stubs when running `make protos`.

### Maven Stubs Project (`apis/stubs/java/pom.xml`)

Minimal Maven project for compilation verification:
- `com.google.protobuf:protobuf-java:4.34.0`
- `io.grpc:grpc-stub:1.79.0`, `io.grpc:grpc-protobuf:1.79.0`
- `build.buf:protovalidate:1.1.1` (68 generated files reference `build.buf.validate.ValidateProto` in descriptor code)
- Java 17 via `maven.compiler.release`

### Surprises Resolved

1. **`com.` prefix**: Buf managed mode defaults `java_package_prefix` to `com.`, producing `com.ai.stigmer.agentic.agent.v1`. Fixed by disabling `java_package` in managed mode.
2. **Plugin version format**: Buf uses `v34.0` (base protobuf version), not `v4.34.0` (Maven artifact version).
3. **protovalidate dependency**: Generated descriptor classes reference `build.buf.validate.ValidateProto` — required adding `build.buf:protovalidate:1.1.1` as a Maven dependency.

## Benefits

- All 17 resources + commons + search + IAM have Java proto stubs
- 676 Java files compile cleanly with `mvn compile` (zero warnings)
- Java stubs generate in ~5s via `make java-stubs`
- Standard Maven layout enables direct consumption by the Java SDK project
- Pinned plugin versions ensure reproducible builds

## Impact

- **Build pipeline**: `make protos` now generates Java stubs alongside Go, Python, and TS
- **Java SDK**: Unblocks Tasks 2-5 (codegen, SDK scaffolding, build wiring, publishing)
- **JVM ecosystem**: Foundation for Kotlin, Scala, and other JVM language support

## Related Work

- `_changelog/2026-03/2026-03-16-112653-go-sdk-stripe-style-restructure.md` — Go SDK Stripe-style pattern
- `_changelog/2026-03/2026-03-16-115418-go-sdk-all-resource-codegen.md` — Go SDK all-resource codegen
- `_projects/2026-03/20260316.02.java-sdk-codegen/` — Parent project (Task 1 of 5)

---

**Status**: Production Ready
**Timeline**: Task 1 of 5 in java-sdk-codegen project
