# Session Notes: 2026-05-12 — T04 Task Schema Registry

## Accomplishments

- **Proto definitions**: Created `task_kind_descriptor.proto` with `TaskKindDescriptor`, `TaskFieldDescriptor`, `TaskFieldGroup` messages and `TaskKindCategory` (7 values), `TaskFieldType` (10 values) enums. Created `task_kind_registry_query.proto` with `TaskKindRegistryQueryController` gRPC service. Both pass `buf lint` cleanly.

- **19 sidecar YAML metadata files**: One per task kind in `apis/.../tasks/meta/` with display names, categories, Lucide icons, output schemas, field groups, and YAML examples. Covers all 19 task kinds from set_vars through notification.

- **Generator extension**: Added `--target=task-registry` to `tools/codegen/generator/`. New `task_registry.go` reads proto2schema JSON + sidecar YAML, merges into unified `task-kind-registry.json` (85KB). Also generates per-kind JSON Schema files (draft 2020-12). Added `gopkg.in/yaml.v3` dependency (already available in MODULE.bazel).

- **Go HTTP endpoint**: Created `backend/services/stigmer-server/pkg/domain/workflow/registry/` with embed.FS-based handler serving at `/v1/proxy/task-kind-registry` with 1h cache. Wired into unified HTTP handler in `server.go`.

- **Java HTTP endpoint**: Created `TaskKindRegistryController.java` in stigmer-cloud serving classpath JSON at `/v1/proxy/task-kind-registry` with Spring `@RestController`.

- **Cross-task reference validation**: Created `crossref.go` in workflow-runner validation package. Validates `fallback_task` (llm_call, validate), `output.fallback_task` (agent_call), `cases[].then` (switch_case), `outcomes[].then` (human_input). Extracts references directly from `structpb.Struct` to avoid triggering buf.validate on optional fields. Includes Levenshtein "did you mean?" suggestions. Wired into `ValidateWorkflow()` as Layer 2. 5 tests passing.

- **SDK hook skeleton**: Created `sdk/react/src/workflow/` with `useTaskKindRegistry()` hook following `useModelRegistry` context pattern. Types: `TaskKindDescriptor`, `TaskFieldDescriptor`, `TaskKindCategory`, `TaskFieldType`, `TaskFieldGroup`. Exports added to `@stigmer/react` barrel. TypeScript compiles cleanly.

## Decisions Made

- **Sidecar extraction over Struct unmarshal**: Cross-task reference validation extracts references directly from `structpb.Struct` fields rather than unmarshaling into typed proto messages. This avoids triggering buf.validate constraints on optional fields with min > 0 (like `max_tokens`, `timeout`, `max_retries`) which would fail when unset (default 0). Discovered during testing.

- **Separate service proto**: `TaskKindRegistryQueryController` placed in its own proto file rather than in `query.proto`. The existing `WorkflowQueryController` is resource-scoped (has `api_resource_kind` option); the registry is cross-cutting metadata and doesn't fit that pattern.

- **Both snake_case and camelCase key lookup**: The sidecar field extraction checks both `fallbackTask` and `fallback_task` as Struct keys, since workflow configs may use either depending on the serialization path.

## Key Code Changes

| File | Change |
|------|--------|
| `apis/.../task_kind_descriptor.proto` | New — core descriptor proto with all messages and enums |
| `apis/.../task_kind_registry_query.proto` | New — gRPC service definition |
| `apis/.../tasks/meta/*.yaml` | New — 19 sidecar metadata files |
| `tools/codegen/generator/task_registry.go` | New — registry generation logic |
| `tools/codegen/generator/main.go` | Modified — add `--target=task-registry` and `--meta-dir` flag |
| `tools/codegen/generator/BUILD.bazel` | Modified — add task_registry.go and yaml.v3 dep |
| `backend/.../workflow/registry/task_kind_registry.go` | New — Go HTTP handler with embed.FS |
| `backend/.../workflow/registry/data/task-kind-registry.json` | Generated — 85KB registry artifact |
| `backend/.../server/server.go` | Modified — wire registry HTTP endpoint |
| `backend/.../validation/crossref.go` | New — cross-task reference validation |
| `backend/.../validation/crossref_test.go` | New — 5 tests for cross-ref validation |
| `backend/.../validation/validate.go` | Modified — add Layer 2 call to ValidateCrossTaskReferences |
| `sdk/react/src/workflow/` | New — types, context, hook, barrel export |
| `sdk/react/src/index.ts` | Modified — export workflow module |
| (stigmer-cloud) `TaskKindRegistryController.java` | New — Spring REST controller |

## Learnings

- `protojson.Unmarshal` accepts both JSON field names (camelCase) and proto field names (snake_case) — but `ValidateTaskConfig` with buf.validate will reject proto messages where optional integer fields with `min: 1` constraints default to 0. This means you can't unmarshal-then-validate for the purpose of just reading reference fields; direct Struct extraction is safer.

- The `tools/generator` binary in the repo is a committed binary artifact (~8MB) that changes when new source files are added. It should not be committed alongside source changes.

## Open Questions

- Proto stubs for the new `task_kind_descriptor.proto` and `task_kind_registry_query.proto` haven't been regenerated via `make protos`. This is needed before the gRPC service can be implemented in Go/Java.
- The `task-kind-registry.json` classpath resource for stigmer-cloud needs to be generated and placed in the right location for the Java controller to load it.

## Next Session Plan

1. Plan and implement T05: Budget Primitives
2. Run `make protos` to generate stubs for the new T04 protos
3. Wire gRPC service implementation once stubs are available
