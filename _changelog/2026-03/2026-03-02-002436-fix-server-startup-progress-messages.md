# Fix Server Startup Progress Messages

**Date**: March 2, 2026

## Summary

Fixed misleading progress messages during `stigmer server` startup where the display showed "Deploying: Bootstrapping Python Runtime" (nothing is being deployed), "Starting services: done" (no services had started), and "Installing dependencies: done" (used for Temporal setup, not pip/npm deps). The root cause was a hardcoded phase ordering designed for cloud deployment flows being reused for local server startup with completely different semantics.

## Problem Statement

Running `stigmer server` displayed a progress UI where every line was semantically incorrect, and completed phases appeared below the active spinner due to an inverted display order.

### Pain Points

- "Deploying" label used for bootstrapping a local Python runtime -- nothing is being deployed
- "Starting services: done" appeared as the last completed line, but was actually the first phase set (`"Preparing environment"`), auto-completed when the next phase began
- "Installing dependencies: done" was triggered by "Setting up Temporal", not actual dependency installation
- Display order was inverted relative to execution order because `phaseOrder` in `progress.go` was hardcoded for cloud operations (discover/validate/deploy), not local server startup (init/install/start)

## Solution

Made `ProgressDisplay` phase-configurable so each caller defines its own phase order and labels, then redefined the `stigmer server` startup phases to accurately reflect the three-stage lifecycle: Initializing, Installing, Starting.

## Implementation Details

### 1. Configurable Phase Display (`progress.go`)

Added `PhaseEntry` and `PhaseConfig` types that pair a phase identifier with its human-readable label. Added `NewProgressDisplayWithPhases(PhaseConfig)` constructor that stores the config and uses it in `View()` and `renderFinalState()` instead of the previously hardcoded `phaseOrder` slices. The existing `NewProgressDisplay()` remains for backward compatibility with callers that don't need custom phases.

### 2. Server-Specific Phase Config (`server.go`)

Replaced `NewProgressDisplay()` with `NewProgressDisplayWithPhases()` using three phases that match the actual startup lifecycle:

- **Initializing** -- data directory, binary extraction, config loading, credential gathering
- **Installing** -- LLM setup, Temporal download, Python runtime bootstrap
- **Starting** -- Temporal server start, daemon process launch, gRPC readiness wait

Removed the premature `SetPhase(PhaseStarting, "Preparing environment")` that was causing the false "Starting services: done". Replaced `PhaseReady` handling with keeping `PhaseStarting` active during the gRPC readiness check.

### 3. Phase Remapping and Execution Reordering (`daemon.go`)

Remapped all `SetPhase` calls to use semantically correct phases:

- LLM setup moved from `PhaseInitializing` to `PhaseInstalling`
- Python runtime bootstrap moved from `PhaseDeploying` to `PhaseInstalling`
- Temporal start and daemon launch moved from `PhaseDeploying` to `PhaseStarting`

Reordered execution to group install operations together and start operations together. Moved Python runtime bootstrap before Temporal start (they are independent) so Temporal doesn't sit idle during Python download/venv creation.

### 4. LLM Phase Fix (`llm/setup.go`)

Changed the Ollama server start from `PhaseStarting` to `PhaseInstalling` since starting Ollama is part of LLM provider setup, not Stigmer service startup.

## Benefits

- Progress display now accurately describes what is happening at each stage
- Phases appear in chronological order (completed above active spinner)
- Labels match domain semantics: "Installing" for downloads/setup, "Starting" for process launches
- `ProgressDisplay` is now reusable across different command lifecycles without semantic mismatch
- Temporal idle time reduced by moving Python bootstrap before Temporal start

## Impact

- **End users** see accurate, non-misleading progress during `stigmer server` startup
- **Other CLI commands** can define their own phase configs for accurate progress display
- **Maintainers** benefit from clear phase semantics in `daemon.go` with explicit phase boundary comments

## Related Work

- Follows the native agent-runner migration (consolidate lifecycle into single daemon)
- Builds on the agent-runner bootstrap pipeline fix from earlier in this session

---

**Status**: Production Ready
