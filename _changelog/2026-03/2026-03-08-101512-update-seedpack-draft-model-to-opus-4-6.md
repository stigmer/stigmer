# Update Seedpack Draft Scripts to Claude Opus 4.6

**Date**: March 8, 2026

## Summary

Updated all `stigmer draft` invocations in the seedpack tooling scripts to use `claude-opus-4.6` instead of `claude-sonnet-4.6`. Scripts that were missing the `--model` flag entirely now have it explicitly set.

## Problem Statement

The seedpack draft scripts used `claude-sonnet-4.6` as the model for generating skills and approval policies. With the availability of `claude-opus-4.6`, these scripts needed to be upgraded to use the more capable model for higher quality generation output.

### Pain Points

- Two scripts (`02_draft-agent-creator-skill.sh`, `03_draft-mcp-server-creator-skill.sh`) used `claude-sonnet-4.6` explicitly
- One script (`04_generate-approval-policy.sh`) had no `--model` flag at all, defaulting to whatever the server chose

## Solution

Updated all three `stigmer draft` invocations in `seedpack/tools/` to use `--model claude-opus-4.6`:

- Changed existing `--model claude-sonnet-4.6` references to `--model claude-opus-4.6`
- Added `--model claude-opus-4.6` to the approval policy generation script that was missing it

## Implementation Details

Files changed:
- `seedpack/tools/02_draft-agent-creator-skill.sh` — sonnet → opus
- `seedpack/tools/03_draft-mcp-server-creator-skill.sh` — sonnet → opus
- `seedpack/tools/04_generate-approval-policy.sh` — added `--model claude-opus-4.6`

## Benefits

- All seedpack generation scripts now consistently use the same model
- Every `stigmer draft` call has an explicit `--model` flag, removing reliance on server defaults
- Higher quality skill and approval policy generation with Opus 4.6

## Impact

Affects seedpack regeneration (`regenerate_all.sh`) — next time skills or approval policies are regenerated, they will use Opus 4.6.

---

**Status**: ✅ Production Ready
