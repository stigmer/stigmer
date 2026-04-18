# Scenar Proto Contract — Foundation for a Standalone Demo Engine Product

**Date**: April 17, 2026

## Summary

Defined the complete proto contract for Scenar, a standalone open-source product extracted from Stigmer's demo video framework. Created a new GitHub organization (scenar-ai), public monorepo (scenar-ai/scenar), and 13 proto source files that establish the formal schema for declarative scenario definitions — the foundation that all future Scenar components (engine, SDK, CLI) build upon.

## Problem Statement

Stigmer's demo engine is powerful — 25+ interactive demos, cursor choreography, narration sync, video export — but it's tightly coupled to the Stigmer codebase. The engine has zero reusability outside Stigmer. Other products that want the same "real components, not screenshots" capability have to build from scratch.

### Pain Points

- Demo engine code lives inside `site/src/components/docs/demos/engine/` with Stigmer-specific imports
- No formal contract defines "what a scenario IS" — it's implicit in TypeScript interfaces
- Scenario interactions are keyed by step index (`{ 4: [...], 6: [...] }`) which is fragile and error-prone
- No YAML authoring possible — scenarios must be written in TypeScript
- The engine can't be extracted as a standalone package without a clean contract to target

## Solution

Proto-first design: define the complete scenario contract before extracting any code. The proto schema becomes the single source of truth that the engine, SDK, and CLI all target. Users author scenarios in YAML or TypeScript (both validate against the same schema).

## Implementation Details

### Repository Setup

- **GitHub org**: `scenar-ai` (domain: scenar.ai)
- **Repo**: [scenar-ai/scenar](https://github.com/scenar-ai/scenar) — public, open-source monorepo
- **Buf module**: `buf.build/scenar/apis` — zero Stigmer dependencies

### Proto Structure (13 source files)

**Scenario protos** (`ai.scenar.scenario.v1`):
- `spec.proto` — ScenarioSpec, ViewportConfig, Step (with embedded interactions), StepAction (with `oneof config`), 6 action config messages (ClickConfig, TypeConfig, HoverConfig, DragConfig, ScrollToConfig, ViewportTransitionConfig)
- `enum.proto` — ActionType enum (9 types: set_cursor, clear_cursor, click, type, hover, drag, scroll_to, viewport_transition)
- `api.proto` — Scenario resource (K8s-style apiVersion/kind/metadata/spec/status)
- `io.proto` — ScenarioId, Scenarios, ListScenariosInput, RenderInput/Output, ScenarioOutputFormat
- `command.proto` — ScenarioCommandController (forward-looking service: create, update, delete, render)
- `query.proto` — ScenarioQueryController (forward-looking service: get, list)

**Commons resource patterns** (`ai.scenar.commons.resource`):
- `metadata.proto` — ResourceMetadata (name, slug, id, visibility, labels, annotations, tags, version)
- `enum.proto` — ResourceVisibility, ResourceEventType
- `status.proto` — ResourceAudit, ResourceAuditInfo, ResourceAuditActor
- `kind.proto` — ResourceKind enum
- `field_options.proto` — computed/immutable field annotations
- `rpc_service_options.proto` — resource_kind service option
- `rpc/pagination.proto` — PageInfo

### Build System

- `apis/buf.yaml` — standalone buf module config
- `apis/buf.gen.{ts,go,python}.yaml` — codegen templates for 3 languages
- `apis/Makefile` — per-language stub targets (ts-stubs, go-stubs, python-stubs)
- Root `Makefile` — `make protos` generates all 72 stub files

### Key Design Decisions

1. **Interactions embedded in Step** — Each step owns its interactions (`repeated StepAction interactions`), not a separate `map<int32, StepInteractions>`. Eliminates fragile step-index counting for YAML authors.
2. **No CursorStyle enum** — Cursor visual style is an engine rendering concern, not scenario data. The cursor switches to grab-hand automatically during drag actions.
3. **No multi-org** — ResourceMetadata has no `org` field initially. Simplifies the initial product.
4. **View is an opaque string** — The `view` field maps to React components via the scenario author's render function. Shells are product-specific, not modeled in proto.

## Benefits

- **Formal contract**: Scenarios validate against a versioned proto schema instead of implicit TypeScript interfaces
- **YAML authoring**: Non-developers can write scenario scripts without touching TypeScript
- **Multi-language stubs**: TypeScript, Go, and Python types generated from the same source
- **Standalone product**: Zero Stigmer dependencies — any product can use Scenar
- **Forward-looking API**: Command/query services ready for a future hosted platform

## Impact

- **Scenar product**: Foundation established. Engine extraction (T03), SDK (T05), and Stigmer rewiring (T06) can now target this contract.
- **Stigmer demos**: Once the SDK is built, the ~336-line scenario files shrink to ~200 lines of TS + ~50 lines of YAML by eliminating engine boilerplate.
- **Open source**: Public repo at github.com/scenar-ai/scenar enables community contribution.

## Related Work

- Demo Framework Hardening project (`_projects/2026-04/20260416.02.demo-framework-hardening/`) — established the engine architecture (T01-T08: viewport, click, type, hover, drag, viewport-transition)
- Scenar Product project (`_projects/2026-04/20260417.02.scenar-product/`) — T01 complete, T03-T08 pending

---

**Status**: Production Ready
**Timeline**: Single session (April 17, 2026)
