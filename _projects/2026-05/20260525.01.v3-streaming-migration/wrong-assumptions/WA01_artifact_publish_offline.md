# WA01: Artifact Publish Is Not Achievable Offline

**Date**: 2026-05-26
**Discovered during**: Phase 0, Session 3

## The Assumption

The Phase 0 plan assumed artifact publish could be tested in the offline harness by extending the MCP server with a `write_file` tool and configuring the runner with a test InlinePublisher.

## The Reality

Two independent blockers make this impossible without production code changes:

1. **StateBackend vs LocalWorkspaceBackend disconnect**: Agent `write_file` calls go to deepagents' `StateBackend` (in-memory LangGraph checkpoint state), but `InlinePublisher` reads files from `LocalWorkspaceBackend` (real disk). Files written by the agent never reach disk, so `InlinePublisher.publish()` fails silently with "File not found".

2. **Offline harness artifact storage misconfiguration**: Setting `ProxyEndpoint` (for MockLLMProxy) forces `ARTIFACT_STORAGE_TYPE=proxy`, but `MockLLMProxyServer` only handles LLM paths — artifact presign calls to `/v1/proxy/artifacts/*` return 404.

## What's Needed

1. **Production fix**: Switch `createDeepAgent`'s backend from `StateBackend` to `FilesystemBackend({ rootDir: workspaceBackend.rootDir })` (or a CompositeBackend) so agent writes land on disk.
2. **Harness fix**: Decouple LLM proxy from artifact storage — set `ARTIFACT_STORAGE_TYPE=local` with temp `LOCAL_ARTIFACT_PATH`.
3. **Test**: Mock LLM fixture with `write_file` tool_use + assertion on `result.GetStatus().GetArtifacts()`.

## Mitigation

Unit-level coverage is solid: `inline-publisher.test.ts` (9 tests), `streaming.test.ts` artifact orchestration (3 tests), `status-builder.test.ts` addArtifact (3 tests). These cover the StatusBuilder and streaming loop integration with mock dependencies.
