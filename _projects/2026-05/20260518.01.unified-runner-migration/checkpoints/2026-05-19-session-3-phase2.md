# Session Notes: 2026-05-19 (Session 3 — Phase 2 Complete)

## Accomplishments

- Phase 2 (Core Shared Infrastructure) fully implemented and validated
- 4 deliverables completed, all tests pass (70 total), typecheck clean, build clean

### 2d. Status Persistence Utilities (`shared/status.ts`)
- Extracted `utcTimestamp`, `persistStatus`, `reportSetupProgress`, `slimStatus` from execute-cursor/index.ts
- Updated execute-cursor and message-translator to import from shared
- 8 unit tests

### 2b. Checkpointer Factory (`shared/checkpointer/`)
- `factory.ts` — async factory selecting memory or http by config
- `http-saver.ts` — port of Python HttpCheckpointSaver implementing LangGraph JS BaseCheckpointSaver
  - Uses `this.serde` (JsonPlusSerializer from base class) for serialization
  - MongoDB Extended JSON v2 `$binary` format for Java proxy compatibility
  - All 5 BaseCheckpointSaver methods: getTuple, list, put, putWrites, (get inherited)
- `types.ts` — CheckpointerConfig interface
- Added `checkpointerType` and `checkpointerProxyEndpoint` to Config
- 12 unit tests (factory + http-saver)

### 2c. Workspace Provisioner (`shared/workspace/`)
- `provisioner.ts` — WorkspaceProvisioner class dispatching on WorkspaceSource proto type
- `sources/git.ts` — git clone with GitHub token injection, idempotent re-use, git excludes
- `sources/local-path.ts` — path validation, local-only guard, multi-entry symlinks
- `sources/empty.ts` — empty workspace fallback
- `types.ts` — ProvisionResult, GitMetadata, SourceType, WorkspaceBackend interface
- `local-backend.ts` — LocalWorkspaceBackend (child_process + fs)
- `file-tree.ts` — workspace file tree for system prompts
- 12 unit tests

### 2a. MCP Connection Manager (`shared/mcp-manager.ts`)
- `connectMcpServers()` — creates MultiServerMCPClient from ResolvedMcpServer[]
- `toMcpClientConfig()` — converts harness-agnostic format to MCP adapters Connection config
- `isCloudCompatibleCommand()` — classifies stdio commands for cloud safety
- `warnCloudIncompatibleServers()` — operator visibility for cloud-incompatible MCP servers
- Added `@langchain/mcp-adapters` and `@langchain/core` dependencies
- 20 unit tests

## Key Decisions Made

- **Checkpointer backends**: Memory (OSS) + HTTP proxy (cloud). SQLite and MongoDB dropped.
- **StatusBuilder deferred**: Full LangGraph event StatusBuilder deferred to Phase 3 — too coupled to LangGraph event shapes to build speculatively. Shared status persistence utilities extracted instead.
- **MCP cloud compatibility**: Validation guard (warn, don't block) for non-npx stdio commands in cloud mode. No proto-level changes.
- **Transport naming**: LangGraph JS uses `"http"` transport (not Python's `"streamable_http"`).
- **Serde access**: `JsonPlusSerializer` is not publicly exported from `@langchain/langgraph-checkpoint`. Used `this.serde` from BaseCheckpointSaver instead.

## Key Discoveries

- `@langchain/mcp-adapters` needs `@langchain/core` as a peer dependency but it wasn't hoisted — explicit install required
- `@langchain/langgraph-checkpoint` package only exports from main entry point — no subpath exports for serde modules
- The `Connection` type in `@langchain/mcp-adapters` uses `transport: "http"` not `"streamable_http"`

## Test Summary

| Test File | Tests |
|-----------|-------|
| config.test.ts | 12 |
| worker.test.ts | 2 |
| execute-deep-agent/index.test.ts | 4 |
| shared/status.test.ts | 8 |
| shared/checkpointer/factory.test.ts | 5 |
| shared/checkpointer/http-saver.test.ts | 7 |
| shared/workspace/provisioner.test.ts | 12 |
| shared/mcp-manager.test.ts | 20 |
| **Total** | **70** |

## Files Created/Modified

### New files (17 source + 5 test):
- `src/shared/status.ts`
- `src/shared/checkpointer/types.ts`
- `src/shared/checkpointer/factory.ts`
- `src/shared/checkpointer/http-saver.ts`
- `src/shared/workspace/types.ts`
- `src/shared/workspace/local-backend.ts`
- `src/shared/workspace/provisioner.ts`
- `src/shared/workspace/file-tree.ts`
- `src/shared/workspace/sources/empty.ts`
- `src/shared/workspace/sources/local-path.ts`
- `src/shared/workspace/sources/git.ts`
- `src/shared/mcp-manager.ts`
- `src/shared/__tests__/status.test.ts`
- `src/shared/__tests__/mcp-manager.test.ts`
- `src/shared/checkpointer/__tests__/factory.test.ts`
- `src/shared/checkpointer/__tests__/http-saver.test.ts`
- `src/shared/workspace/__tests__/provisioner.test.ts`

### Modified files:
- `src/config.ts` — added checkpointerType, checkpointerProxyEndpoint fields
- `src/activities/execute-cursor/index.ts` — removed local status functions, imports from shared
- `src/activities/execute-cursor/message-translator.ts` — imports utcTimestamp from shared
- `src/activities/execute-deep-agent/__tests__/index.test.ts` — added new Config fields to mock
- `package.json` / `package-lock.json` — added @langchain/mcp-adapters, @langchain/core

## Next Steps

1. **Phase 3: ExecuteDeepAgent Activity** — the core migration
   - Build graphton-ts middleware layer (13 rebuild modules)
   - Wire checkpointer, MCP manager, workspace provisioner into deep agent activity
   - Build StatusBuilder for LangGraph astream_events
   - Implement HITL interrupt/resume flow
2. **Phase 4: Supporting Activities** — EnsureThread, MCP discovery, classify
3. **Deferred items** from Phase 2: remote workspace backend (Daytona), MCP package installer, streaming update scheduler
