# SDK Docs Makefile & CI Integration

**Date**: April 3, 2026

## Summary

Wired SDK reference documentation generation into the `make protos` pipeline and added a CI staleness check, so SDK docs are automatically regenerated alongside proto stubs and SDK clients and verified for freshness on every PR.

## Problem Statement

The SDK docs generator (`--target=sdk-docs`) existed as a standalone command that had to be invoked manually. This meant proto changes could land without updating the generated documentation, causing docs to silently drift from the source of truth.

### Pain Points

- SDK docs generation required remembering a specific `go run` command with `--comprehensive` flag
- No CI gate to catch stale SDK docs
- The existing `make protos` pipeline generated stubs and SDK clients but not docs
- Risk of proto changes landing with outdated SDK reference pages

## Solution

Integrated SDK docs generation into the existing `make protos` pipeline and added a CI freshness check modeled on the (now-removed) CLI docs freshness pattern.

## Implementation Details

**Makefile targets added:**
- `gen-sdk-docs` -- runs the SDK docs generator to produce 17 MDX reference pages + `meta.json`
- `gen-sdk-docs-check` -- generates docs to a temp directory and compares each generated file against `docs/sdk/`, exiting non-zero if any differ

**Pipeline integration:**
- Added `$(MAKE) gen-sdk-docs` as the final step of the `protos` target, after all SDK client codegens complete
- Simplified `codegen` to depend only on `protos` (removed CLI docs dependency)

**CI workflow (`ci.docs.yaml`):**
- Replaced `cli-docs-freshness` job with `sdk-docs-freshness` job using `tools/go.mod`
- Added `apis/**` and `tools/codegen/**` to path triggers so CI runs when proto definitions or generator code change

**Staleness check design:**
- Uses per-file comparison (not `diff -r`) to avoid false failures from extra files in `docs/sdk/` such as future manual pages or stale artifacts

## Benefits

- Every `make protos` run now regenerates SDK docs automatically -- zero manual steps
- CI catches stale SDK docs on PRs touching protos, schemas, or codegen tooling
- Eliminates risk of documentation drift from proto source of truth
- Developers get immediate feedback when proto changes require doc regeneration

## Impact

- **Developer workflow**: `make protos` is now the single command for all codegen including docs
- **CI pipeline**: SDK docs freshness is verified on every relevant PR
- **CLI docs**: Removed from pipeline (to be rebuilt in a separate project with improved quality)

## Related Work

- T02-T04: SDK docs generator implementation
- T05: Audience-aware proto comments and `@internal` convention
- Future: T06 manual pages (SDK overview, streaming guide, React SDK)

---

**Status**: Production Ready
**Timeline**: Session 5 of sdk-docs-auto-generation project
