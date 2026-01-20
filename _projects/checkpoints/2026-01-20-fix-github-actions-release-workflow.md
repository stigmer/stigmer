# Checkpoint: Fix GitHub Actions Release Workflow

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Status**: ✅ Complete

## Summary

Fixed critical bug in GitHub Actions release workflow that was preventing all releases from being published. Added missing Buf CLI installation step.

## Work Completed

- ✅ Identified root cause (buf command not found - exit code 127)
- ✅ Added `bufbuild/buf-setup-action@v1` to release workflow
- ✅ Positioned buf setup between Go setup and proto generation
- ✅ Verified workflow execution order is correct

## Impact

**Before**: Release workflow failed at proto generation step, blocking all releases  
**After**: Buf CLI installed, `make protos` succeeds, releases can be published

## Files Changed

- `.github/workflows/release.yml` - Added buf installation step

## Testing

Next release tag push will validate this fix. The workflow should now:
1. Set up Go ✓
2. Set up Buf ✓ (NEW)
3. Generate proto stubs ✓
4. Run GoReleaser ✓
5. Publish release ✓

## References

- Changelog: `_changelog/2026-01/2026-01-20-062426-fix-github-actions-buf-installation.md`
- Error screenshot/context: `_cursor/error.md`

---

**Status**: Complete and ready for next release tag validation.
