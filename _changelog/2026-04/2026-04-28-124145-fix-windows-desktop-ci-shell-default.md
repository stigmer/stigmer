# Fix Windows Desktop CI — Job-Level Bash Shell Default

**Date**: April 28, 2026

## Summary

Fixed the broken Windows desktop CI build by adding a job-level `defaults.run.shell: bash` to the `build` job in the desktop release workflow. The root cause was a missing `shell: bash` on the agent-runner sync step, which caused PowerShell to attempt executing `chmod` and a bash script on Windows runners.

## Problem Statement

The desktop release workflow (`release.desktop.yaml`) failed on Windows runners during the "Sync agent-runner source for embedding" step. GitHub Actions defaults to PowerShell on Windows, and the sync step uses `chmod +x sync.sh` and `./sync.sh` — both of which are bash-only constructs. The downstream verification step correctly caught the failure:

```
ERROR: agent-runner source not synced -- sidecar will fail at runtime
```

### Pain Points

- The bug only surfaced on Windows tag pushes — the highest-stakes CI trigger
- 5 of 9 `run:` steps in the build job already had per-step `shell: bash`, but the sync step was missed
- The inconsistent shell declarations made it easy to add new steps without realizing bash was required

## Solution

Instead of a spot fix on one step, applied a job-level `defaults.run.shell: bash` to the `build` job. This fixes the immediate bug and prevents the same class of error for any future step added to the job.

## Implementation Details

Added three lines to `release.desktop.yaml` in the `build` job:

```yaml
defaults:
  run:
    shell: bash
```

All 9 existing `run:` steps in the job were audited and confirmed bash-compatible. The 5 existing per-step `shell: bash` declarations become redundant but were left in place to keep the diff focused.

## Benefits

- Windows desktop CI builds will pass the agent-runner sync step
- Future steps added to the job automatically use bash — no per-step annotation needed
- No behavioral change on macOS or Ubuntu where bash was already the default

## Impact

- **CI pipeline**: Windows desktop builds unblocked
- **Contributors**: Reduced risk of introducing the same class of bug when adding new steps

## Files Changed

- `.github/workflows/release.desktop.yaml` — added `defaults.run.shell: bash` to `build` job

---

**Status**: ✅ Production Ready
