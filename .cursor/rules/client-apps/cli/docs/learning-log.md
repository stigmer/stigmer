# Stigmer CLI Learning Log

This document captures lessons learned during Stigmer CLI development, organized by topic for quick reference.

## Purpose

Before solving a problem, check here first:
- Has this issue been solved before?
- Is there a documented pattern?
- What was the root cause last time?

After solving a new problem, add it here to help future work.

---

## Module & Dependencies

### [To be populated during development]

**Purpose**: Document Go module issues, proto stub imports, dependency conflicts, and build errors.

---

## CLI Commands

### [To be populated during development]

**Purpose**: Document Cobra command patterns, flag handling, argument parsing, and command organization.

---

## Backend Communication

### [To be populated during development]

**Purpose**: Document gRPC connection issues, health checks, error handling, and TLS configuration.

---

## Daemon Management

### 2026-01-20 - Lock File-Based Subprocess Management

**Problem**: PID-based process detection is unreliable for background processes like Temporal dev server. Issues include:
- Stale PID files remain after crashes
- PID reuse causes false positives (OS assigns same PID to different process)
- Race conditions during concurrent starts (check-and-write not atomic)
- Manual cleanup required after failures
- "Already running" errors even when process is dead

**Root Cause**: PID files are just text files with no OS-level guarantees. They don't auto-cleanup, can't prevent concurrent access, and don't prevent PID reuse.

**Solution**: Replace PID-based detection with OS-level file locking using \`syscall.Flock\`:

**Key Advantages**:
1. **Auto-release on crash**: OS releases lock when process dies (no stale locks)
2. **Atomic operation**: Kernel enforces exclusivity (no race conditions)
3. **No PID reuse**: Lock tied to process, not PID number
4. **Instant detection**: O(1) lock check vs O(n) process inspection (5-10x faster)
5. **Crash recovery**: Automatic cleanup, no manual intervention

**Prevention**: For any future subprocess management (agent-runner, etc.), use lock files as source of truth and keep PID files only for debugging.

**Implementation Pattern**:
- Lock file: ~/.stigmer/{process}.lock (source of truth)
- PID file: ~/.stigmer/{process}.pid (debugging only)
- Multi-layer validation: Lock → PID → Process → Command → Port
- Idempotent start: Check lock first, return success if locked
- Release on all paths: Defer-like pattern to ensure cleanup

**Related Docs**: 
- CLI Subprocess Lifecycle Architecture (docs/architecture/cli-subprocess-lifecycle.md)
- Task 5 Completion (_projects/2026-01/20260119.07.production-grade-temporal-lifecycle/20260120-task5-lockfile-complete.md)
- Task 5 Testing Guide (_projects/2026-01/20260119.07.production-grade-temporal-lifecycle/task5-testing-guide.md)

**Production-Grade Patterns Combined**:
1. Lock files (concurrency control)
2. Process groups (coordinated cleanup)
3. Multi-layer validation (robust detection)
4. Idempotent start (user-friendly)
5. Supervisor auto-restart (self-healing)

---

### [To be populated during future development]

**Purpose**: Document daemon binary download, secret management, and other daemon-related patterns.

---

## Configuration

### [To be populated during development]

**Purpose**: Document config file issues, YAML parsing, environment variables, and file permissions.

---

## Output & Errors

### [To be populated during development]

**Purpose**: Document error message patterns, output formatting, progress indicators, and UX issues.

---

## Testing

### [To be populated during development]

**Purpose**: Document unit test patterns, integration tests, mocking strategies, and test organization.

---

## Build & Release

### [To be populated during development]

**Purpose**: Document build issues, Bazel/Gazelle problems, cross-compilation, and release processes.

---

## How to Use This Log

1. **Before implementing**: Search this log for similar issues
2. **During implementation**: Reference solutions from past learnings
3. **After solving**: Add new learnings under appropriate topic
4. **When stuck**: Check if the issue was solved before

---

*This log is continuously updated as we learn from real development work.*
