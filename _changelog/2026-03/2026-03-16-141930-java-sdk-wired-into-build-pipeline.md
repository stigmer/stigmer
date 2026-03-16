# Java SDK Wired into Root Build Pipeline

**Date**: March 16, 2026

## Summary

Added the Java SDK codegen step to the root `make protos` pipeline, completing Task 4 of the Java SDK codegen project. The Java SDK now regenerates alongside Go, TypeScript, and Python whenever protocol buffer stubs and SDK client code are regenerated. Also added a missing `.gitignore` for the Java SDK's Maven build output.

## Problem Statement

The Java SDK codegen was fully functional (generator registered, Makefile targets in place, codegen-verify passing) but was not wired into the root `make protos` pipeline. This meant Java SDK regeneration had to be invoked manually and was not part of the standard development workflow.

### Pain Points

- Running `make protos` would regenerate Go, TypeScript, and Python SDKs but skip Java
- Java SDK codegen required a separate manual step: `make -C sdk/java codegen`
- Missing `sdk/java/.gitignore` caused ~90 stale `.class` files to appear in `git status`

## Solution

Added one line to the root `Makefile` `protos` target and created a `.gitignore` for the Java SDK.

## Implementation Details

- **Root `Makefile`**: Added `$(MAKE) -C sdk/java codegen` to the `protos` target, following the exact same pattern as Go, TypeScript, and Python
- **`sdk/java/.gitignore`**: Excludes `target/`, `*.class`, `*.jar`, `*.iml`, `.idea/`

## Benefits

- Java SDK regeneration is now part of the standard `make protos` workflow
- No separate manual invocation required
- Clean `git status` for the Java SDK directory
- Consistent with how all other SDKs (Go, TypeScript, Python) are integrated

## Impact

- **Developers**: `make protos` now regenerates all four SDK languages in one command
- **CI**: Any future CI gate using `make protos` will automatically include Java SDK codegen
- **Project**: Task 4 complete; only Task 5 (Maven Central publishing) remains

## Related Work

- `_changelog/2026-03/2026-03-16-135622-java-sdk-handwritten-public-api-layer.md`
- `_changelog/2026-03/2026-03-16-140949-java-sdk-remove-internal-from-generated-package.md`

---

**Status**: Production Ready
**Timeline**: ~15 minutes (most subtasks were already done in earlier sessions)
