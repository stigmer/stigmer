# Generate Missing Narration Audio and Codegen Integration

**Date**: April 9, 2026

## Summary

Generated missing narration audio files for two demo scenarios (`connect-playback` and `connect-tools-tour`) and wired narration generation into the root `make codegen` target so future codegen runs keep audio in sync with scenario step text.

## Problem Statement

Demo scenarios had narration text defined in their `steps.ts` files, but the corresponding MP3 audio files had not been generated after recent modifications.

### Pain Points

- `connect-playback` was a newly added scenario with no audio files or manifest at all
- `connect-tools-tour` had stale audio that needed regeneration after step text changes
- Narration generation was a standalone `make generate-narration` target in the site Makefile but was not part of the root `make codegen` pipeline, making it easy to forget

## Solution

Ran the existing `generate-narration` script (Edge TTS, hash-based caching) to produce all missing MP3 files, then added a `gen-narration` target to the root Makefile and included it as a dependency of `codegen`.

## Implementation Details

- **9 new MP3 files generated**: 4 for `connect-playback` (steps 0, 2, 4, 5) and 5 for `connect-tools-tour` (steps 0–4)
- **Root Makefile**: added `gen-narration` target that delegates to `$(MAKE) -C site generate-narration`; updated `codegen` prerequisite list from `protos gen-sdk-docs` to `protos gen-sdk-docs gen-narration`
- The script's hash-based cache ensures re-runs are fast and idempotent — only steps whose narration text changed trigger TTS calls

## Benefits

- All 19 narration-enabled scenarios now have up-to-date audio
- `make codegen` is now a single command that regenerates all derived artifacts: proto stubs, SDK docs, and narration audio
- Developers no longer need to remember a separate narration generation step

## Impact

- **Site demos**: visitors hear narration on all scenarios, including the newly added Connect flow
- **Developer workflow**: codegen is now comprehensive — one command keeps everything in sync

---

**Status**: ✅ Production Ready
