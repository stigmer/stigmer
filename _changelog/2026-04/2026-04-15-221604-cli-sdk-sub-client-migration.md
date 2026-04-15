# CLI Go SDK Sub-Client Migration

**Date**: April 15, 2026

## Summary

Migrated the entire Stigmer CLI from raw gRPC stub construction (`somev1.NewXxxControllerClient(conn)`) to the Go SDK's typed sub-client methods (`client.Xxx.Get(ctx, id)`). This eliminates 83 raw stub constructions across 68 files, replaces 27 `.Conn()` escape-hatch calls with zero, and threads `*stigmer.Client` through all domain packages and the `ApplyHandler` interface. The CLI now consumes the SDK as any external consumer would.

## Problem Statement

After the Go SDK was created in Session 6 (T05), the CLI still bypassed it entirely — extracting the raw `*grpc.ClientConn` via `client.Conn()` and constructing protobuf-generated gRPC stubs directly. This meant:

### Pain Points

- **Two abstraction layers**: The SDK provided typed, error-wrapped methods (`client.Agent.Get(ctx, id)`), but the CLI ignored them and used raw stubs
- **No error normalization**: The CLI received raw gRPC `status.Error` instead of the SDK's structured `*stigmer.Error` with typed error codes
- **Fragile type assertions**: 10+ files asserted `client.Conn().(*grpc.ClientConn)` — a cast that would break if the connection type changed
- **Duplicated boilerplate**: Every domain package constructed its own gRPC client from a connection, adding 3-5 lines of ceremony per operation
- **Proto coupling**: Domain packages imported specific proto packages for stub construction, creating tight coupling to the gRPC layer

## Solution

SDK-first architecture: every CLI operation flows through `*stigmer.Client` and its typed sub-clients. The migration was executed in 5 phases with compilation and test verification at each step.

## Implementation Details

### Phase 0: SDK Enhancement — `FromProto` Helpers

The SDK's `Apply(*AgentInput)` method takes a flattened `*Input` struct, but the CLI's apply pipeline parses YAML into full proto resources. Rather than adding a second proto-accepting `Apply` method (which would fragment the API), we generated `FromProto` converters:

- Extended `tools/codegen/generator/sdk_client.go` with `generateFromProto`, `emitFromProtoField`, `emitFromProtoOneof`, `emitNestedFromProtoFunc`
- Added `ResourceRefFromProto` and `EnvSpecInputFromProto` shared helpers to `gen/types.go`
- Generated `sdk/go/from_proto.go` with public re-exports for all 19 resources
- Fixed a oneof field recursion bug where nested variant types (e.g., `GitRepoSource` inside `WorkspaceSource`) were not generating converter functions

### Phase 1: ApplyHandler Interface

Changed the framework-level interface from `conn grpc.ClientConnInterface` to `client *stigmer.Client`:
- `applier.ApplyHandler.Apply` signature
- `fileApplyContext` struct
- All 10 apply handler implementations now use `client.Xxx.Apply(ctx, stigmer.XxxInputFromProto(proto))`

### Phase 2: Get/Delete/List Domain Packages

Migrated all 14 resource domain packages and their callers:
- Session, Organization, Environment, Project, Skill, Workflow, McpServer, Agent, AgentInstance, WorkflowInstance, ApiKey, Execution, IdentityProvider, OAuthApp
- Command routers (`get.go`, `delete.go`, `list.go`) now thread `*stigmer.Client` directly

### Phase 3: Streaming & Remaining Operations

- Execution creation (`run_create.go`): Uses `client.AgentExecution.Create(ctx, input)` with `FromProto`
- Streaming (`run_stream.go`): Uses `client.AgentExecution.Subscribe(ctx, id)` SDK stream wrapper
- Search, skill push, usage reports, context, server commands: All migrated
- All `.Conn()` calls eliminated from CLI (was 27, now 0)

### Phase 4: Error Handling

- Updated `clierr.go` to recognize `*stigmer.Error` alongside raw gRPC status errors via `errors.As`
- Replaced `status.Code(err) == codes.NotFound` with `stigmer.IsNotFound(err)` in skill verification
- SDK errors now flow through the CLI's structured error handler with proper exit codes

## Benefits

- **Single abstraction layer**: CLI uses the same SDK API as any external consumer
- **Type-safe operations**: `client.Agent.Get(ctx, id)` instead of `agentv1.NewAgentQueryControllerClient(conn).Get(ctx, &agentv1.AgentId{Value: id})`
- **Structured errors**: `stigmer.IsNotFound(err)` instead of `status.Code(err) == codes.NotFound`
- **Zero type assertions**: No more `client.Conn().(*grpc.ClientConn)` casts
- **Reduced proto coupling**: Domain packages no longer import proto packages for stub construction
- **Generated `FromProto` converters**: Stay in sync with proto changes via codegen pipeline

## Impact

- **129 files changed** (103 CLI + 19 SDK gen + 1 new `from_proto.go` + codegen + misc)
- **2,048 insertions / 1,656 deletions**
- **83 raw stub constructions eliminated**
- **27 `.Conn()` calls reduced to 0**
- All existing tests pass; `go vet` clean
- `auth/whoami.go` and `daemon/daemon.go` intentionally excluded (independent gRPC connections)

## Related Work

- Part of [CLI Modernization project](../../_projects/2026-04/20260415.01.cli-modernization/README.md) (Task T05 continuation)
- Builds on Session 6 Go SDK creation (`sdk/go/client.go`, `internal/gen/`)
- Enables future T04 Phase 2 (Go CLI Ink integration) — Ink renderer can use the same SDK sub-clients

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
