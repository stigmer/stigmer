# Infrastructure Fix: Proto Generation Alignment

**Date**: 2026-01-19
**Type**: Infrastructure / Build System
**Scope**: Project-wide (affects all proto generation)

## Context

During work on the managed-local-temporal-runtime project, encountered proto generation errors due to misaligned configuration between Stigmer OSS and Stigmer Cloud.

## Problem

Go stubs were being generated to `internal/gen` causing:
- Build errors and gazelle warnings
- Inconsistency with Stigmer Cloud project  
- 409 import statements pointing to wrong location
- `internal/gen` directory kept being recreated after deletion

## Solution Implemented

Fixed proto generation to align with Stigmer Cloud pattern:

1. **Updated buf.gen.go.yaml** - Changed output from `../internal/gen` to `stubs/go`
2. **Updated apis/Makefile** - Changed GO_STUBS_DIR from `../internal/gen` to `stubs/go`
3. **Created apis/stubs/go/go.mod** - Separate module prevents nested paths
4. **Updated 409 imports** - Changed all imports from `internal/gen` to `apis/stubs/go`
5. **Fixed incorrect imports** - Corrected `store/badger`, `prototime`, etc.

## Impact

✅ Stigmer OSS now matches Stigmer Cloud proto generation pattern
✅ `internal/gen` directory eliminated permanently
✅ Build system clean and consistent
✅ `go mod tidy` succeeds without errors

## Documentation

- **Changelog**: `_changelog/2026-01/2026-01-19-080926-align-proto-generation-with-stigmer-cloud.md`
- **Technical Details**: `PROTO_GENERATION_FIX.md` (this project directory)

## Note

This was an infrastructure fix discovered during the managed-temporal project but is independent of that feature. It affects the entire Stigmer OSS codebase.
