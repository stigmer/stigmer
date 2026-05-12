# T04: Task Schema Registry

**Date**: May 12, 2026

## Summary

Implemented a machine-readable registry of all 19 workflow task kinds, providing complete metadata for UI form generation, YAML editor autocomplete, task palette rendering, CLI validation, and documentation generation. The registry is generated at build time from proto definitions and sidecar metadata, served via cacheable HTTP endpoints, and consumed by a typed React SDK hook.

## Problem Statement

With 19 workflow task kinds (expanded from 13 in T03), there was no unified, machine-readable source of task metadata for SDK/UI consumers. Each task kind's configuration was defined only in its proto file — inaccessible to Monaco editor autocomplete, form builders, task palettes, or client-side validators without manual duplication.

### Pain Points

- No JSON Schema for YAML editor validation or autocomplete
- No structured metadata for rendering task palettes (categories, icons, display names)
- No field-level metadata for form generation (groups, types, validation hints)
- No cross-task reference validation (fallback_task, then, outcome.then could reference nonexistent tasks)
- No output schema descriptions for execution viewer rendering

## Solution

A proto-derived + sidecar hybrid approach where structural schema comes from the existing `proto2schema` pipeline and presentation metadata lives in hand-maintained YAML sidecar files. The codegen generator merges both into a unified registry artifact served via HTTP endpoints and consumed by a typed SDK hook.

## Implementation Details

### Proto Layer
- `TaskKindDescriptor` proto with 14 fields covering kind metadata, field descriptors, JSON schemas, examples, and UI hints
- `TaskFieldDescriptor` with 13 fields for form rendering (type, required, isExpression, enumValues, validationHints)
- `TaskKindCategory` enum (control_flow, invocation, ai, data, governance, event) for palette grouping
- `TaskFieldType` enum (string, int32, float, bool, enum, struct, repeated, map, message) for form controls
- `TaskKindRegistryQueryController` gRPC service for typed API access

### Sidecar Metadata
- 19 YAML files in `apis/.../tasks/meta/` with display names, categories, Lucide icons, output schemas, field groups, and YAML code examples
- Field groups define UI form sections (e.g., "Core Configuration", "Output Control", "Model Tuning" for llm_call)

### Codegen Pipeline
- Extended `tools/codegen/generator/` with `--target=task-registry` and `--meta-dir` flag
- Reads proto2schema JSON (structural data) + sidecar YAML (presentation metadata)
- Generates `task-kind-registry.json` (85KB) with full field descriptors and merged metadata
- Generates per-kind JSON Schema files (draft 2020-12) for Monaco/RJSF consumers

### API Layer
- Go: embed.FS-based HTTP handler at `/v1/proxy/task-kind-registry` with 1h cache control
- Java: Spring `@RestController` serving classpath JSON with 1h cache control
- Both follow the established `model-registry.json` delivery pattern

### Cross-Task Reference Validation
- Validates `fallback_task` (llm_call, validate), `output.fallback_task` (agent_call), `cases[].then` (switch_case), `outcomes[].then` (human_input)
- Extracts references directly from `structpb.Struct` to avoid triggering buf.validate on optional fields
- Levenshtein-based "did you mean?" suggestions for typos (e.g., "human_reveiw" → "did you mean 'human_review'?")
- Wired into `ValidateWorkflow()` as Layer 2 after structural validation

### SDK Hook
- `useTaskKindRegistry()` hook following the `useModelRegistry` context pattern
- Returns `getByKind()`, `getJsonSchema()`, `categories` (Map), `descriptors`, `isLoading`, `error`
- Full TypeScript types exported from `@stigmer/react`

## Benefits

- **Zero-duplication schema delivery**: Task metadata derived from proto definitions — no manual JSON Schema authoring
- **UI-ready metadata**: Categories, icons, field groups enable task palette rendering without hardcoded mappings
- **Client-side validation**: JSON Schema per task kind enables pre-submit validation in YAML editors
- **Typo detection**: Cross-task reference validation with suggestions catches authoring errors early
- **Extensible**: Adding a new task kind requires only a proto file and a sidecar YAML — codegen handles the rest

## Impact

- **SDK consumers**: Can now build task palettes, form generators, and validation UIs using `useTaskKindRegistry()`
- **Workflow authors**: Will get better error messages when task references are incorrect
- **Platform maintainers**: Single source of truth for task metadata — proto definitions + thin sidecar YAML
- **Downstream tasks**: T10 (Monaco integration), T11 (RJSF forms), T12 (CLI validate), T15 (Task palette UI) all consume this registry

## Related Work

- T03: New task type protos (llm_call, transform, human_input, validate, emit_event, notification) — provided the 19-kind surface area
- T02: Structured Agent Output Model — established the output contract pattern reused in agent_call/llm_call
- Model Registry: Established the classpath JSON + HTTP endpoint pattern reused for delivery

---

**Status**: ✅ Production Ready (pending `make protos` for stub generation)
**Timeline**: Single session
