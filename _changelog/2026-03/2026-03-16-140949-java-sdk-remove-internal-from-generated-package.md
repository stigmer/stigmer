# Java SDK: Remove `internal` from Generated Code Package

**Date**: March 16, 2026

## Summary

Relocated all generated Java SDK types from `ai.stigmer.sdk.internal.gen` to `ai.stigmer.sdk.gen`, fixing a misleading package name that signaled "do not use" for types that are the SDK's public API. This is a one-constant generator fix with a coordinated Makefile, import, and directory move.

## Problem Statement

The Java SDK code generator placed all generated types (clients, inputs, errors, shared types) into the package `ai.stigmer.sdk.internal.gen`. Unlike Go, where `internal/` is compiler-enforced and hidden behind a public facade, Java has no language-level `internal` enforcement. Users had to write `import ai.stigmer.sdk.internal.gen.AgentInput;` -- a constant signal that they were using something they shouldn't.

### Pain Points

- Every user-facing import contained the word `internal`, contradicting Java conventions
- No facade or re-export mechanism exists in Java (unlike Python's `__init__.py` or TypeScript's barrel exports) -- the generated package IS the user-visible package
- The Go SDK's use of `internal/` is architecturally correct (compiler-enforced boundary + public wrapper); blindly copying that pattern to Java was not

## Solution

Changed the generator's Java package constant from `ai.stigmer.sdk.internal.gen` to `ai.stigmer.sdk.gen`. This removes the misleading `internal` segment while keeping generated code in a dedicated subdirectory that can be safely wiped and regenerated. The `internal/transport/` package (StigmerChannel, ApiKeyInterceptor) remains unchanged -- those classes are genuinely internal.

## Implementation Details

- **Generator**: Changed `javaGenPackage` constant on line 13 of `tools/codegen/generator/sdk_client_java.go`
- **Makefile**: Updated `SDK_GEN_DIR` in `sdk/java/Makefile` to point at `src/main/java/ai/stigmer/sdk/gen`
- **Hand-written imports**: Updated `StigmerClient.java` (18 imports) and `SearchClient.java` (2 imports)
- **Directory move**: Deleted 46 files under `internal/gen/`, regenerated into `gen/`
- **Gitignore**: Added `target/` for Java/Maven build output (was missing entirely)

## Benefits

- User imports are now clean: `import ai.stigmer.sdk.gen.AgentInput;`
- Consistent with industry SDKs (Stripe uses `com.stripe.model`, AWS uses `.model` subpackages)
- Safe `rm -rf` wipe during codegen: `gen/` directory contains only generated code, hand-written sources in parent package are untouched
- No breaking changes to the public `StigmerClient` API surface

## Impact

- **Java SDK users**: All generated type imports change from `ai.stigmer.sdk.internal.gen.*` to `ai.stigmer.sdk.gen.*`
- **Other SDKs**: No changes. Go's `internal/` is compiler-enforced and correct. Python's `_gen/` has a re-exporting `__init__.py`. TypeScript's `gen/` has a barrel `index.ts`.
- **Generator maintainers**: Single constant controls the Java package name

## Related Work

- `_changelog/2026-03/2026-03-16-132834-java-sdk-codegen-all-resources.md` -- Java codegen generator
- `_changelog/2026-03/2026-03-16-135622-java-sdk-handwritten-public-api-layer.md` -- Java public API layer
- `_projects/2026-03/20260316.02.java-sdk-codegen/` -- Parent project

---

**Status**: Production Ready
**Timeline**: Single session
