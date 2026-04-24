# Fix make check CI gate failures across Stigmer OSS

**Date**: April 24, 2026

## Summary

Resolved all `make check` CI gate failures in the Stigmer OSS repo across Go, TypeScript, Python, and documentation layers. The pipeline had accumulated breakages from recent runner feature work, desktop app scaffolding, and the domain reorganization — this sweep brings the full gate back to green.

## Problem Statement

Running `make check` locally failed at multiple stages, which meant the CI gate would also fail. The failures spanned every layer of the stack:

### Pain Points

- `go mod tidy` failed due to a stale MCP server codegen artifact importing non-existent proto paths
- ESLint flagged React 19 violations (setState in effects, refs during render) in the web console
- Python mypy reported 18 type errors in the agent-runner worker (checkpoint saver, config, setup)
- TypeDoc warnings treated as errors for undocumented `DraftParams` fields and unlinked `Runner` symbols
- Next.js build failed on broken relative imports left behind by the domain reorganization
- CLI type registry tests expected 13 types but the registry now has 14 (Runner was added)
- Python pytest failures from stale `api_key` constructor parameter and removed `_initialize_redis` method
- Vale doc lint flagged hyphenation and spelling errors in the new desktop guide pages
- Site yarn lockfile was stale

## Solution

Systematic layer-by-layer sweep through the `make check` pipeline, fixing each failure as it surfaced and re-running until the full gate passed.

## Implementation Details

### Go module fix
- Removed `mcp-server/gen/agentic/agentrunner/` (2 files) — a stale codegen duplicate that imported `proto/ai/stigmer/agentic/agentrunner/v1` which never existed. The working equivalent at `gen/agentic/runner/` already covers this resource.

### React / TypeScript fixes
- **SessionLauncher.tsx**: Replaced `useRef` + `useEffect` "capture once" pattern with React 19-compliant state-only pattern (setState during render with null-check guards). Removed `useRef` import.
- **Library detail pages**: Fixed 3 broken `../../../LibraryBreadcrumbContext` imports → `@/domain/library/LibraryBreadcrumbContext` (broken by domain reorganization).

### Python mypy fixes
- **http_saver.py**: Aligned `HttpCheckpointSaver` method signatures with LangGraph's `BaseCheckpointSaver` (`RunnableConfig` types, `task_path` param, `limit: int | None`, `cast()` for `CheckpointTuple` fields).
- **config.py**: Annotated `stigmer_token` as `str` to prevent type widening through `os.getenv` chains.
- **setup.py**: Fixed `SetupTimer.stop()` (removed stale argument), added `sandbox` field to `SetupResult` dataclass, passed `sandbox=None` to `WriteBackCoordinator` and `InlinePublisher` constructors.

### TypeDoc / SDK docs
- Added JSDoc to `DraftParams.draftType`, `.editRef.org`, `.editRef.slug` in `sdk/react`.
- Added `Runner` to `externalSymbolLinkMappings` in `typedoc.json`.
- Regenerated React SDK reference docs.

### CLI test fixes
- Updated type registry counts (13→14) and verb support expectations across `registry_test.go`, `routing_test.go`, and `verb_support_test.go`.
- Added `VerbDelete: true` to Runner in `verb_support.go`.

### Python test fixes
- Replaced `McpServerClient(api_key=...)` → `McpServerClient(token=...)` (7 sites) and `SkillClient(api_key=...)` → `SkillClient(token=...)` (2 sites).
- Removed stale `patch("worker.worker.Runner._initialize_redis")`.

### Documentation fixes
- Fixed "Auto-updates" → "Automatic updates", "heartbeating" → "sending heartbeats", "glanceable" → "at-a-glance" in desktop guide pages.
- Ran Prettier on modified doc files.
- Ran `yarn install` in `site/` to fix stale lockfile.

## Benefits

- `make check` passes end-to-end (tidy → fix → lint → tsdoc → gen-sdk-docs → check-links → libs-build → web-build → docs-build → build → test → validate-demos)
- CI gate is unblocked for the feature branch
- Pre-existing tech debt from rapid runner/desktop feature work is cleaned up
- All 1385 Python tests pass, all Go tests pass, all TypeScript type checks pass

## Impact

- **CI/CD**: Feature branch can now merge cleanly once pushed
- **Developer experience**: Local `make check` works again for all contributors
- **Code quality**: Type annotations, test expectations, and imports are all consistent with the current codebase state

## Related Work

- Runner feature work (Phase 3 persistent runners + browser launch)
- Desktop app scaffolding (Tauri 2.x)
- Web/SDK architecture standards (domain reorganization)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
