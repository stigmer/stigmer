# Task T01: Define Scenar Proto Contract

**Created**: 2026-04-17
**Status**: PENDING REVIEW
**Type**: Feature Development
**Depends on**: —

## Goal

Create the Scenar scenario proto contract in `scenar/apis/` (completely separate from Stigmer's `apis/`), following the Stigmer API resource pattern: `api.proto`, `spec.proto`, `command.proto`, `query.proto`, `io.proto`, `enum.proto`.

## Context

Scenar is a standalone product being extracted from Stigmer's demo video framework. The proto contract defines "what a Scenario IS" — the formal, versioned schema for declarative scenario definitions. Users bring React components and define scenarios against this contract. The proto generates TypeScript types consumed by the Scenar React SDK.

Key design decision: **Scenar protos have zero Stigmer imports.** No `ai.stigmer.commons.*`, no shared metadata, no shared field options. Scenar defines its own lightweight metadata and types so it remains independently extractable.

## Proto Package

**Package**: `ai.scenar.scenario.v1`
**Location**: `scenar/apis/ai/scenar/scenario/v1/`

## Files to Create

### 1. `enum.proto` — Enums

- `ActionType`: `UNSPECIFIED`, `SET_CURSOR`, `CLEAR_CURSOR`, `CLICK`, `TYPE`, `HOVER`, `DRAG`, `SCROLL_TO`, `VIEWPORT_TRANSITION`
- `CursorStyle`: `UNSPECIFIED`, `POINTER` (default arrow), `GRAB` (closed hand during drag)

### 2. `spec.proto` — The Core: Declarative Scenario Definition

This is where Scenar's value lives. Messages:

- `ScenarioSpec` — Top-level spec with `ViewportConfig`, `repeated Step`, `map<int32, StepInteractions>`
- `ViewportConfig` — Canonical dimensions (`width`, `height`) for deterministic rendering
- `Step` — `view` (string component ref), `delay_ms`, `caption`, `narration_text`, `google.protobuf.Struct props`
- `StepInteractions` — `repeated StepAction`
- `StepAction` — `at_percent` (float 0.0–1.0), `ActionType type`, `string target`, `oneof config {...}`
- `ClickConfig` — (empty or minimal; click target is on parent StepAction)
- `TypeConfig` — `string text`, `int32 type_delay_ms`
- `HoverConfig` — `int32 hover_duration_ms`
- `DragConfig` — `string drag_target`
- `ScrollToConfig` — (empty; scroll target is on parent StepAction)
- `ViewportTransitionConfig` — `float viewport_zoom`, `bool viewport_reset`

### 3. `api.proto` — Resource Shape

The `Scenario` resource document following the Kubernetes-style pattern:

- `api_version` — const `"scenar.ai/v1"` (buf validate)
- `kind` — const `"Scenario"` (buf validate)
- `ScenarioMetadata metadata` — Scenar's own metadata (NOT Stigmer commons)
- `ScenarioSpec spec` — from spec.proto
- `ScenarioStatus status` — build state

Supporting messages:
- `ScenarioMetadata` — `name`, `id`, `description`, `repeated string tags`
- `ScenarioStatus` — `google.protobuf.Timestamp last_rendered_at`, `bool validated`

### 4. `io.proto` — Helper Types

- `ScenarioId` — `string value`
- `Scenarios` — `repeated Scenario entries`
- `ListScenariosInput` — `repeated string tags`, pagination
- `RenderInput` — `string scenario_id`, `ScenarioOutputFormat format`
- `RenderOutput` — `string artifact_url`, `ScenarioOutputFormat format`
- `ScenarioOutputFormat` enum — `UNSPECIFIED`, `INTERACTIVE_EMBED`, `MP4_VIDEO`

### 5. `command.proto` — Write Operations (Forward-Looking)

`ScenarioCommandController` service:
- `apply(Scenario) returns (Scenario)`
- `create(Scenario) returns (Scenario)`
- `update(Scenario) returns (Scenario)`
- `delete(ScenarioId) returns (Scenario)`
- `render(RenderInput) returns (RenderOutput)` — domain-specific

No auth annotations initially. The service contract is forward-looking for when Scenar becomes hosted.

### 6. `query.proto` — Read Operations (Forward-Looking)

`ScenarioQueryController` service:
- `get(ScenarioId) returns (Scenario)`
- `list(ListScenariosInput) returns (Scenarios)`

### 7. Buf Configuration

- `scenar/apis/buf.yaml` — module config for `buf.build/scenar/apis`
- Depends on `buf.build/bufbuild/protovalidate` only (no Stigmer deps)

## Implementation Steps

1. Create `scenar/apis/ai/scenar/scenario/v1/` directory structure
2. Write `enum.proto`
3. Write `spec.proto` (the core — most important file)
4. Write `api.proto`
5. Write `io.proto`
6. Write `command.proto`
7. Write `query.proto`
8. Create `scenar/apis/buf.yaml`
9. Run `buf lint` and `buf build` to validate

## Success Criteria

- All 6 proto files compile without errors
- Zero imports from `ai.stigmer.*` — completely standalone
- Proto structure matches the Stigmer API resource pattern (api/spec/command/query/io/enum)
- `buf lint` passes
- ScenarioSpec accurately models the existing engine's step + interaction model

## Design Rationale

- **Protos first**: The contract defines what a Scenario IS before any code is moved. Engine extraction (T02+) targets this contract.
- **Separate from Stigmer**: `scenar/apis/` not `apis/ai/scenar/` — Scenar is its own product, not a Stigmer sub-package.
- **Hybrid authoring**: Proto defines the schema. Users can author in TypeScript (using generated types) or YAML. Both validate against the same contract.
- **Forward-looking services**: command.proto and query.proto define the API surface for a future Scenar hosted service, even though initial usage is local/build-time.
