# Fix Incorrect CLI Commands in Secrets Documentation

**Date**: March 20, 2026

## Summary

Removed three non-existent CLI commands from the Environment Flow section of `how-to-provide-secrets.md` and fixed the Execution Flow CLI example that was missing the required `-m` flag. This prevents documentation from teaching users commands that fail on execution.

## Problem Statement

The product documentation for secret delivery (`docs/product/how-to-provide-secrets.md`) contained CLI examples that referenced commands and flags that do not exist in the Stigmer CLI.

### Pain Points

- `stigmer environment apply env.yaml` — no `environment` command exists in the CLI, and `apply` does not support the Environment kind
- `stigmer agent instance create --agent my-agent --env prod-credentials` — no `agent instance` subcommands exist
- `stigmer run my-agent "..." --instance github-bot-prod` — no `--instance` flag on `run`
- `stigmer run my-agent "Process this data" --env ...` — message passed as positional arg instead of `-m` flag, causing the CLI to misinterpret it as a type+reference pair

## Solution

Applied Option (c) from the T01 plan: show only what works, defer what doesn't.

- **Environment Flow CLI**: Replaced the incorrect code block with a clear note explaining that CLI support for environment and agent instance management is planned, directing users to the Web Console or SDKs
- **Execution Flow CLI**: Added the required `-m` flag to the message argument, matching the CLI's actual command syntax (`stigmer run my-agent -m "..." --env KEY=val --secret KEY=val`)

## Implementation Details

Single file changed: `docs/product/how-to-provide-secrets.md`

**Environment Flow section** (was lines 103-109): Three incorrect bash commands replaced with a prose note that provides actionable guidance — where to manage environments today (Console/SDKs) and where to find CLI-supported secret injection (Execution Flow section).

**Execution Flow section** (was line 178): Added `-m` before the message string. Without this flag, cobra interprets two positional args as `TypeArg` + `Reference`, not as agent + message.

## Benefits

- Users no longer encounter documentation that fails on first try
- The Execution Flow CLI example now matches `stigmer run --help` output exactly
- Clear deferred-support note sets correct expectations without removing useful context

## Impact

Documentation-only change. No code, API, or SDK changes. Affects readers of `docs/product/how-to-provide-secrets.md` who follow CLI examples.

## Related Work

- Part of project `20260319.06.secrets-flow-hardening` (T01)
- Prerequisite for T04 (Session API cleanup), T03 (naming consistency), T02 (useAgentSetup hardening)

---

**Status**: ✅ Production Ready
**Timeline**: ~15 minutes
