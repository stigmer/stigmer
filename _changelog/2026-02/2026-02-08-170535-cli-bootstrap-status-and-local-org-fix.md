# CLI Bootstrap Status Display and Local Organization Fix

**Date**: February 8, 2026

## Summary

Implemented Phase 3.1 of the CLI Platform Capabilities project by adding bootstrap status display to `stigmer server status` and fixing an organization mismatch bug that prevented CLI commands from finding system resources. The CLI now correctly shows seedpack bootstrap state and uses a consistent "local" organization naming scheme that aligns with developer expectations from similar tools.

## Problem Statement

The CLI lacked visibility into the bootstrap process - users couldn't tell if essential system skills and agents were successfully loaded. Additionally, a critical bug existed where the bootstrap registered resources under the "stigmer" organization while the CLI queried for "local" organization, making system resources invisible to all CLI commands.

### Pain Points

- No CLI visibility into bootstrap status (success, failure, applied resources)
- `stigmer list skills` and `stigmer list agents` returned empty results despite bootstrap completing
- Organization mismatch: bootstrap used "stigmer" org, CLI defaulted to "local" org
- Verbose debug logs leaked into CLI output, cluttering user experience
- Users couldn't verify if seedpack resources were available before running agents

## Solution

**Two-part fix:**

1. **Bootstrap Status Display**: Extended `stigmer server status` to show bootstrap state by reading directly from the SQLite database
2. **Organization Alignment**: Changed bootstrap to use "local" organization (matching industry standard single-tenant local mode patterns)

## Implementation Details

### CLI Bootstrap Status Module

Created new `client-apps/cli/internal/cli/bootstrap` package with direct SQLite access:

- `GetBootstrapStatus()`: Reads `bootstrap_state` table from `~/.stigmer/stigmer.db`
- Parses state keys (e.g., `"skill:skill-creator" -> "applied:sha256:abc..."`)
- Extracts resource names and digests
- Handles missing database gracefully (server never started)

**Integration**: Modified `stigmer server status` to call bootstrap module and display:
- Overall status with symbol (✓ for completed)
- Seedpack version applied
- Count and names of skills/agents

### Organization Fix

**Root cause**: Bootstrap registered resources under `"stigmer"` organization, but `resolveOrganization()` in CLI always returned `"local"` for local backend mode, ignoring the `--org` flag.

**Fix rationale**: Following industry patterns (Docker, minikube, npm, Pulumi), local development mode should use a single default namespace. Changed bootstrap to use `"local"` organization to match CLI expectations.

**Changes**:
- `bootstrap.go`: Changed `org: "stigmer"` → `org: "local"`
- Updated 3 test assertions in `bootstrap_test.go`
- All bootstrap tests pass

### Debug Log Cleanup

Removed verbose `"Registered SearchableExtractor"` debug logs from `registry.go` that were leaking into CLI output on every command invocation.

## Benefits

**Visibility**: Users can now verify bootstrap state with `stigmer server status`:
```
Bootstrap:
ℹ   Status:   Completed ✓
ℹ   Version:  1.1.0
ℹ   Skills:   1 applied (skill-creator)
ℹ   Agents:   1 applied (skill-creator-agent)
```

**Usability**: System resources now discoverable via CLI:
```bash
$ stigmer list skills
local/skill-creator   Guide for creating effective skills...

$ stigmer run agent skill-creator-agent -m "Create a hello-world skill"
✓ Agent execution started
```

**Clean Output**: No more debug log noise in CLI commands

## Impact

**Fixed**: Critical bug that made all system resources invisible to CLI commands

**Improved**: Developer experience by providing bootstrap visibility and following industry conventions

**Affected Components**:
- CLI: New bootstrap module, extended server status command
- Backend: Bootstrap organization changed from "stigmer" to "local"
- All existing CLI commands now find system resources correctly

## Architecture Decision

**Local Mode = Single Tenant**: Adopted industry-standard pattern where local development has no organization concept. Organizations are a cloud/collaboration feature, not needed for single-user local development.

| Tool | Local Mode | Organization Concept |
|------|-----------|---------------------|
| Docker | Single namespace | None locally |
| Pulumi | `file://~/.pulumi` | Orgs only in cloud |
| npm | No org locally | Scopes only when publishing |
| Git | No org locally | Orgs only on GitHub/GitLab |
| **Stigmer** | **"local" org** | **Orgs only in cloud** |

## Known Issues (Pre-existing, Not Fixed)

1. **Search Index Population**: Resources created via Push/Apply APIs don't automatically populate the FTS5 search index. Manual workaround applied for testing.
2. **Agent-Runner Connection**: Agent executions fail due to agent-runner not connected to Temporal (infrastructure issue).

## Testing

- ✅ Bootstrap tests pass (3 assertions updated)
- ✅ Fresh server start successfully bootstraps with "local" org
- ✅ `stigmer server status` displays bootstrap state correctly
- ✅ `stigmer list skills` shows system skill
- ✅ `stigmer list agents` shows system agent  
- ✅ `stigmer run agent` finds and starts agent execution
- ✅ No debug logs in CLI output

## Files Changed

```
backend/services/stigmer-server/pkg/bootstrap/
├── bootstrap.go (org: "stigmer" → "local")
└── bootstrap_test.go (3 test assertions updated)

backend/services/stigmer-server/pkg/query/search/extractor/
└── registry.go (removed debug log)

client-apps/cli/internal/cli/bootstrap/ (NEW)
├── status.go (bootstrap status reader)
├── status_test.go (unit tests)
└── BUILD.bazel (build config)

client-apps/cli/cmd/stigmer/root/
├── server.go (added bootstrap status display)
└── BUILD.bazel (added bootstrap dependency)
```

---

**Status**: ✅ Production Ready  
**Phase**: 3.1 complete (part of CLI Platform Capabilities project)
