# Git Write-Back Prompt — Agent Push Awareness

**Date**: March 26, 2026

## Summary

Extended the workspace system prompt to tell agents they can push code changes when git credentials are configured in the sandbox. This is Phase 2 of the sandbox GitHub PR project, building on the credential persistence work from Phase 1.

## Problem Statement

After Phase 1 configured a git credential store in the Daytona sandbox, the agent had push capability but no awareness of it. The workspace prompt still ended with "Changes you make will be captured as artifacts when execution completes" — a read-only mental model that never mentioned pushing, branching, or committing.

### Pain Points

- Agents with push credentials had no system prompt guidance to use them
- No guardrails against pushing directly to the default branch
- No instruction to avoid reading credential files on disk
- The workspace prompt was identical whether credentials were configured or not

## Solution

Added a conditional `### Git Write-Back` prompt section that appears only when `git_metadata.git_credentials_configured` is `True`. The section covers branch rules, commit guidance, and a credential-file access warning. The guidance is injected by the prompt builder (`execute_graphton.py`), not the provisioner, keeping concerns cleanly separated.

## Implementation Details

**New function**: `_git_writeback_guidance(meta, *, heading_level=3)` in `execute_graphton.py` — returns the write-back section or empty string based on credential state. Heading level is parameterized: `###` for single-entry workspaces, `####` for multi-entry.

**Single-entry path** (`_build_single_workspace_section`): appends write-back guidance after the description and file tree, using `result.git_metadata`.

**Multi-entry path** (`_format_entry_description`): appends write-back guidance per-entry in the `GIT_REPO` branch, so only entries with configured credentials get the section.

**Prompt content** when credentials are configured:

```
### Git Write-Back

Git credentials are configured — you can push changes to the remote repository.

**Rules:**
- Create a new branch for your changes (never push directly to the default branch).
- Write clear, meaningful commit messages.
- Push your branch and report the branch name when done.
- Do NOT read, echo, or reference credential files (e.g. `~/.git-credentials`).
```

## Benefits

- Agents now know they can push when credentials are available
- Branch protection guardrail prevents direct pushes to main/master
- Credential file warning reduces risk of accidental token exposure in tool output
- No behavioral change when credentials are absent — existing read-only prompts unchanged
- Per-entry granularity in multi-workspace sessions

## Impact

- **Agent runner**: Prompt builder in `execute_graphton.py` gains credential-aware workspace guidance
- **Agent behavior**: Agents with `git_repo` workspaces and configured credentials will now proactively branch, commit, and push
- **Test coverage**: 9 new tests covering single-entry, multi-entry, ordering, mixed-credential, and direct description formatting scenarios. Full suite at 1280 tests, zero regressions.

## Related Work

- Phase 0: [Fix git on Daytona FUSE+S3 volumes](2026-03-26-144322-fix-git-on-daytona-fuse-s3-volumes.md)
- Phase 1: [Git credential persistence via credential store](2026-03-26-150111-git-credential-persistence-via-credential-store.md)
- Phase 3 (next): Platform `create_pull_request` tool for structured PR creation

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes
