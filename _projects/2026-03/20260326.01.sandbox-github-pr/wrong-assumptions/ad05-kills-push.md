# Wrong Assumption: AD-05 Stripping Kills Push Capability

**Date**: 2026-03-26
**Source**: T01_0_plan.md, Gap 1 description

## The Assumption

> "AD-05 strips GITHUB_TOKEN from merged_env_vars after clone to prevent
> MCP ${GITHUB_TOKEN} placeholder leakage. This is correct, but it also
> kills push capability."

## Why It Was Wrong

`_build_auth_url()` embeds the token directly into the clone URL:
`https://x-access-token:{token}@github.com/org/repo.git`

After clone, git stores this URL as `remote.origin.url` in the repo
config (on the local sandbox FS when using `--separate-git-dir`). AD-05
strips the `GITHUB_TOKEN` environment variable, but the token is already
persisted in the git config. `git push` reads the URL from config, not
from env vars.

## What Was Actually Needed

The credential store implementation (Phase 1) is a **security hygiene**
improvement, not a functionality enabler:

- Cleans the remote URL so `git remote -v` doesn't leak the token
- Moves credentials to a standard git credential store file
- Tracks whether credentials were configured via `git_credentials_configured`

## Impact

Phase 1 scope was reframed from "enable push" to "secure push" — smaller
risk, same outcome, better security posture.
