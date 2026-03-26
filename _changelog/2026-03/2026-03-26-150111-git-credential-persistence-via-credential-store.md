# Git Credential Persistence via Credential Store

**Date**: March 26, 2026

## Summary

After git clone in cloud mode, the remote URL is cleaned to remove the embedded authentication token and a git credential store is configured so agents can `git push` without the token being visible via `git remote -v`. This is the second phase of the sandbox GitHub PR capability (Phase 1 of the task plan), building on the FUSE+S3 volume compatibility work from Session 1.

## Problem Statement

When the agent-runner clones a private GitHub repo into a Daytona sandbox, the `GITHUB_TOKEN` is embedded in the clone URL (`https://x-access-token:{token}@github.com/...`). Git stores this full URL as `remote.origin.url` in the repo config. While push already works via this URL-embedded token, the token is visible to the agent via `git remote -v` — which could inadvertently appear in agent responses shown to users.

### Pain Points

- Token visible in `git remote -v` output — risk of accidental exposure in agent responses
- No tracking of whether push credentials are available — downstream prompt builder can't conditionally tell the agent it can push
- No clean separation between clone authentication (one-time) and push authentication (ongoing)

## Solution

After a successful clone (or when reusing an existing repo), in cloud mode only (`is_local_mode=False`) when a GitHub token is present:

1. Replace the remote URL with the clean (tokenless) URL via `git remote set-url origin`
2. Configure the global git credential helper to use a file-based store at `/home/daytona/.git-credentials`
3. Write the token into the credential store in standard git-credential-store format
4. Track the result via a new `git_credentials_configured` field on `GitMetadata`

## Implementation Details

**New function**: `_configure_git_credentials(backend, url, token, *, target_subdir)` in `worker/workspace/sources/git.py`

Three-step process, each gated on the previous step's success:
- `git remote set-url origin <clean_url>` (runs with `cwd=target_subdir` for multi-entry workspaces)
- `git config --global credential.helper 'store --file=/home/daytona/.git-credentials'`
- `printf` writes the credential entry + `chmod 600` for file permissions

**Two call sites** in `provision()`:
- Fresh-clone path: configures credentials, sets field on `GitMetadata` constructor
- Idempotent path (existing repo): configures credentials, updates frozen result via `dataclasses.replace()`

Both paths are gated on `token and not is_local_mode`.

**Non-fatal**: all failures log warnings with token-scrubbed messages and return `False`. The workspace remains usable — the agent just can't push.

## Benefits

- Token no longer visible via `git remote -v` in agent sandbox
- Standard git credential mechanism — works transparently with all git operations (push, fetch, pull)
- `git_credentials_configured` field enables Phase 2 prompt builder to conditionally guide the agent on push capability
- Credential file on local sandbox FS (not the FUSE volume) — consistent with `--separate-git-dir` approach from Phase 0

## Impact

- **Agent security**: Reduced risk of accidental token exposure in agent-generated output
- **Platform extensibility**: `GitMetadata.git_credentials_configured` provides a clean signal for downstream prompt and tooling decisions
- **Test coverage**: 73 tests in `test_git_source.py` (12 new), 192 total related tests — zero regressions

## Related Work

- [2026-03-26 FUSE+S3 Volume Compatibility](./../2026-03-26-123838-inject-github-token-from-personal-environment.md) — Phase 0: made git clone work on Daytona volumes
- Phase 2 (next): workspace prompt write-back guidance
- Phase 3 (future): `create_pull_request` platform tool

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~2 hours)
