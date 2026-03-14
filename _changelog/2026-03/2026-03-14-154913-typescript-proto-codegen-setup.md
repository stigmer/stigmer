# TypeScript Proto Codegen Added to OSS Build Pipeline

**Date**: March 14, 2026

## Summary

Added TypeScript/Connect-RPC protobuf code generation to the stigmer OSS repository, producing the `@stigmer/protos` internal package. This is the foundational prerequisite for migrating the Stigmer Web Console from stigmer-cloud to the OSS repo, enabling the web frontend to consume type-safe generated stubs from the same proto definitions used by Go and Python services.

## Problem Statement

TypeScript protobuf codegen lived exclusively in the stigmer-cloud repository, generating stubs from the OSS protos via a cross-repo relative path (`../../stigmer/apis`). With the web console moving to OSS, the stubs needed to be generated locally.

### Pain Points

- TypeScript stubs could only be generated from within stigmer-cloud
- No `make ts-stubs` target existed in the OSS build pipeline
- The web console migration was blocked without local TypeScript proto access
- stigmer-cloud's `ts-stubs-clean` target had a latent bug (cleaning `com/` instead of `ai/`), causing 435 stale files to accumulate across generations

## Solution

Mirrored the stigmer-cloud TypeScript codegen setup into the OSS repo with three additions: a Buf codegen config, a package manifest, and Makefile integration — while fixing the clean target bug discovered in the reference implementation.

## Implementation Details

- **`apis/buf.gen.ts.yaml`**: Buf v2 codegen config using `buf.build/bufbuild/es:v2.2.2` (protobuf-es message types) and `buf.build/connectrpc/es:v1.6.1` (Connect-RPC service clients), generating into `stubs/ts/`
- **`apis/stubs/ts/package.json`**: Internal `@stigmer/protos` ESM package with `@bufbuild/protobuf` dependency and path-based exports (`"./*": "./*.ts"`)
- **`apis/Makefile`**: Added `ts-stubs`, `ts-stubs-clean`, `ts-stubs-init` targets; wired into `build`, `clean`, `prep`, and `help`
- **`.gitignore`**: Added global `node_modules/` exclusion for upcoming web app workspace
- **Generated output**: 169 TypeScript files (`*_pb.ts` message types, `*_connect.ts` service definitions) covering all 133 proto source files

## Benefits

- `make protos` now generates Go, Python, and TypeScript stubs in a single command
- Web console development can proceed with type-safe proto access directly from the OSS repo
- Plugin versions pinned to match the proven stigmer-cloud setup, ensuring identical output
- Clean target correctly removes `ai/` and `buf/` directories (fixing the stigmer-cloud bug)

## Impact

- **APIs build pipeline**: TypeScript is now a first-class codegen target alongside Go and Python
- **Web console migration**: T01 unblocks T02-T07 of the web-console-oss-migration project
- **Developer workflow**: `make ts-stubs` available for isolated TypeScript regeneration

## Related Work

- Project: `_projects/2026-03/20260314.03.web-console-oss-migration`
- Next: T02 (Migrate Web Source to Stigmer Repo) — will consume these stubs via npm workspaces

---

**Status**: ✅ Production Ready
**Timeline**: T01 of 7-task web console migration project
