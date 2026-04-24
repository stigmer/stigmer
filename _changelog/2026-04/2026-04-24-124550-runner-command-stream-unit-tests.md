# Runner Command Stream — Automated Unit Tests (T08)

**Date**: April 24, 2026

## Summary

Added comprehensive unit tests for the bidi stream domain logic across both OSS (Go) and Cloud (Java) backends. The T02-T07 implementation added ~2,500 lines of production code with zero dedicated tests for the core domain components. T08 closes that gap with 66 new tests covering StreamRegistry, heartbeat phase transitions, connect handler authentication/disconnect, and sendCommand validation/routing — all verified green via Bazel.

## Problem Statement

The runner command stream (bidi gRPC replacing unary heartbeat) was fully implemented across both editions but had no dedicated unit tests. Only `stop_test.go` and `RunnerStopHandlerTest` indirectly exercised stream-related code.

### Pain Points

- `StreamRegistry` — the backbone of command routing — had zero direct tests for register/unregister lifecycle, pending request eviction, or SendCommand+DeliverResponse correlation
- `applyHeartbeat` — a pure domain function with 6 distinct phase transition paths — was untested
- `SendCommand` RPC handler — validation, phase gate, and oneof copying — was untested
- `Connect` stream handler — authentication (first message must be heartbeat), runner_id mismatch rejection, disconnect→STOPPED transition — was untested
- Java equivalents (`RunnerStreamRegistry`, `RunnerHeartbeatService`, `RunnerSendCommandHandler`) had the same coverage gap
- CLI daemon `BUILD.bazel` was missing `runner_stream_commands_test.go` from Bazel `go_test` srcs — 5 tests silently skipped

## Solution

Wrote focused unit tests following existing patterns in both repos: standard `testing` + real SQLite + hand-written mocks in Go; JUnit 5 + Mockito in Java. No new test frameworks introduced.

## Implementation Details

### Go (stigmer-server) — 4 new test files, 39 tests

| File | Tests | Coverage |
|------|-------|----------|
| `heartbeat_test.go` | 8 | Table-driven phase transitions, connection info propagation, reactivation timestamps, nil status edge case |
| `stream_registry_test.go` | 11 | Register/Unregister/IsConnected, duplicate eviction with pending drain, SendCommand+DeliverResponse correlation, timeout, auto-generated request_id |
| `send_command_test.go` | 8 | Validation (missing runner_id, missing command), NOT_FOUND, phase gate (STOPPED/PENDING/FAILED), buildCommandRequest oneof copy + unique IDs |
| `connect_test.go` | 12 | authenticateStream (5 cases), handleHeartbeat (3 cases), handleDisconnect (3 cases), recvLoop (2 cases) |

### Java (stigmer-cloud) — 3 new test files, 27 tests

| File | Tests | Coverage |
|------|-------|----------|
| `RunnerStreamRegistryTest.java` | 7 | Registration/unregistration, eviction + pending drain, sendCommandLocally+deliverResponse, UNAVAILABLE for unknown runner |
| `RunnerHeartbeatServiceTest.java` | 12 | authenticateFirstHeartbeat (4 cases), processHeartbeat (5 cases), transitionToStopped (4 cases including never-throws guarantee) |
| `RunnerSendCommandHandlerTest.java` | 8 | Validation (2), NOT_FOUND, PERMISSION_DENIED, phase gate (3), local-first vs Redis routing (2) |

### Bug fix

CLI daemon `BUILD.bazel` — added `runner_stream_commands_test.go` to `go_test` srcs (fixed in prior session `728cb7453`).

## Benefits

- Domain logic for the bidi stream infrastructure now has exhaustive unit test coverage in both editions
- Phase transition invariants (FAILED rejection, reactivation semantics) are verified by tests, not just code review
- StreamRegistry's concurrent pending request lifecycle (eviction drains, timeout cleanup) is exercised under test
- Dual-edition behavioral parity is verified — Go and Java tests mirror each other for the same domain contracts

## Impact

- **Backend quality**: Runner command stream domain logic now has the test coverage expected by the architect and backend engineer roles
- **Regression safety**: Future changes to heartbeat processing, stream lifecycle, or command routing will be caught by tests
- **Both editions**: Consistent test coverage across OSS Go and Cloud Java

## Related Work

- Part of project `20260422.02.runner-command-stream` (T08 of 8)
- Builds on T04 (Go server), T05 (CLI client), T06 (Java server), T07 (sendCommand API)
- Web UI workspace picker depends on T07's sendCommand API — tracked in `20260422.01.runner-ux-cli-restructure`

---

**Status**: Production Ready
**Timeline**: 1 session
