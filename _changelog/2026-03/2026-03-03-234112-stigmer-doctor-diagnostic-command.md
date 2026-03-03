# stigmer doctor Diagnostic Command

**Date**: March 3, 2026

## Summary

Added `stigmer doctor`, a self-service diagnostic command that runs seven ordered checks (configuration, server connectivity, authentication, organization context, agent availability, MCP health, terminal capabilities) and reports pass/warn/fail/skip per check with actionable fix suggestions. Output is format-agnostic (human, JSON, quiet) via the existing `clioutput` system. Exit code 0 when all checks pass or warn/skip, 1 when any check fails — enabling CI/script pre-flight patterns such as `stigmer doctor && stigmer run ...`.

## Problem Statement

When things go wrong, users have no self-service diagnostic tool. Errors often dump raw gRPC internals instead of guiding the user. Industry practice (e.g. Claude Code’s `/status` and `/doctor`) is to provide a first-class diagnostic surface that answers: Is my config valid? Can I reach the server? Am I authenticated? Is my org set? Can I list agents? What does my terminal support?

### Pain Points

- No single command to verify end-to-end readiness before `run` or `draft`
- Config, auth, and org issues surface as opaque errors deep in command flows
- Scripts and CI cannot easily gate on “CLI is healthy” without parsing command-specific output
- Terminal capability (TTY, TERM, NO_COLOR) is only implied by behavior, not reported

## Solution

A new `stigmer doctor` command under the config group that:

1. Loads config (or uses defaults if missing)
2. Runs seven checks in dependency order: config → server → auth → org → agents (when conn+org available) → MCP health (stub skip) → terminal
3. Builds a single `clioutput.CommandResult` from all check outcomes
4. Renders via the same human/JSON/quiet pipeline as `stigmer server status`
5. Exits 0 if no check has status “fail”, 1 otherwise

Each check returns a structured `checkResult` (name, status, fields, hint). The orchestrator converts these into sections and hints; overall status is the worst case across checks. Server check uses a 5s timeout and reports latency; auth and MCP health are honest about current limitations (token presence only; MCP runtime health “not yet implemented”).

## Implementation Details

### Files Added

- **`cmd/stigmer/root/doctor.go`** (118 lines): `NewDoctorCommand()` with `--json`/`--quiet` flags, `executeDoctor(format)`, `buildDoctorResult(checks)`. Exit code set to 1 when any check fails.
- **`cmd/stigmer/root/doctor_checks.go`** (220 lines): Types `checkStatus`, `checkField`, `checkResult`; `statusSymbol()`; pure checks `checkConfig`, `checkAuth`, `checkOrg`, `checkAgents`, `checkMCPHealth`, `skipCheck`; helpers `formatLatency`, `abbreviateHome`.
- **`cmd/stigmer/root/doctor_checks_runtime.go`** (118 lines): `checkServer(cfg)` (gRPC dial + Ping, 5s timeout, returns `*backend.Client` for downstream) and `checkTerminal()` (stdin/stdout/stderr TTY, TERM, dimensions, NO_COLOR).
- **`cmd/stigmer/root/doctor_test.go`** (431 lines): 22 unit tests for `statusSymbol`, `checkConfig`, `checkAuth`, `checkOrg`, `checkMCPHealth`, `checkTerminal`, `skipCheck`, `buildDoctorResult`, and `checkServer` (unreachable endpoint).

### Files Modified

- **`cmd/stigmer/root.go`**: Registered `NewDoctorCommand()` under the config group.
- **`internal/cli/backend/client.go`**: Added `Conn() *grpc.ClientConn` accessor so `checkAgents` can pass the connection to `search.List()`.

### Check Semantics

| Check        | Pass condition                          | Fail condition              | Skip condition                                      |
|-------------|------------------------------------------|-----------------------------|-----------------------------------------------------|
| Configuration | Config loaded, backend and endpoint set | Cannot get config path     | —                                                   |
| Server      | Connected and Ping succeeds, latency shown | Unreachable or config error | —                                                   |
| Authentication | Local: N/A; Cloud: token present       | Cloud and no token         | Local backend                                       |
| Organization | Org resolved from context/cloud         | Org not set                 | —                                                   |
| Agents      | Search returns agent count              | Query error                 | No client or no org (skipped via `skipCheck`)       |
| MCP Health  | —                                        | —                           | Always (runtime health not implemented)             |
| Terminal    | At least one of stdout/stderr is TTY    | —                           | — (warn if both non-TTY)                            |

### Design Choices

- **checkResult as internal abstraction**: Check functions return a value type, not `clioutput.Section`, so rendering stays in one place and tests assert on data.
- **5s server timeout**: Shorter than `NewConnection`’s 10s for faster diagnostic failure.
- **MCP health as explicit skip**: Avoids pretending the check works; message states “runtime health check not yet implemented”.
- **Auth reports presence only**: Cloud token validity is not verified (addAuthHeader is still a stub); local reports “not applicable”.

## Benefits

- One command to validate config, connectivity, auth, org, agents, and terminal before running agents.
- Actionable hints per failed check (e.g. “stigmer server”, “stigmer context set --org <slug>”).
- JSON/quiet output for scripting and CI; exit code allows `stigmer doctor && stigmer run ...`.
- Latency from server Ping gives a quick network health signal.
- All production files under 250 lines; checks split into pure vs runtime for testability and clarity.

## Impact

- **Users**: Can run `stigmer doctor` to self-diagnose before or after failures; hints reduce support burden.
- **Scripts/CI**: Can use `stigmer doctor` as a pre-flight gate with a clear exit code.
- **Maintainers**: New checks can be added by implementing a function that returns `checkResult` and appending it in `executeDoctor`.

## Related Work

- Phase 2.4 (Preparation Phase Spinner): Same config group and CLI patterns.
- Phase 2.2 (Two-Lane Output): `doctor` uses the same `clioutput` renderer and human/JSON/quiet flags.
- `stigmer server status`: Same `CommandResult` + section/hint pattern; doctor reuses that abstraction.
- T01_0_plan.md Phase 2.5 and research #G (diagnostic surfaces).

---

**Status**: ✅ Production Ready  
**Timeline**: Single session (Phase 2.5)
