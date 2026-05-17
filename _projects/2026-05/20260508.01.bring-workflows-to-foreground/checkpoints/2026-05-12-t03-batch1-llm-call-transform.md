# Session Notes: 2026-05-12

## Task: T03 Batch 1 — llm_call + transform Task Types

## Accomplishments

- Created `common.proto` with shared `OnInvalidOutputPolicy` enum (extracted from `agent_call.proto`)
- Created `llm_call.proto` with `LlmCallTaskConfig` (10 fields: model, system_prompt, prompt, response_schema, temperature, max_tokens, timeout, on_invalid, max_retries, fallback_task)
- Created `transform.proto` with `TransformEngine` enum (JQ/JSONata/Template) and `TransformTaskConfig` (3 fields: engine, expression, input)
- Added `llm_call = 14` and `transform = 15` to `WorkflowTaskKind` in `enum.proto`
- Updated `spec.proto` task_config mapping comment
- Added unmarshal switch cases in `unmarshal.go`
- Updated `tasks/README.md` task definitions table (also backfilled missing `agent_call` row)
- Passed `buf lint` (zero errors), `buf breaking` (only intentional enum file move), `go vet` (zero errors)
- Ran `make codegen` (stigmer) — all stubs + codegen JSON schemas regenerated
- Ran `make protos` (stigmer-cloud) — all 5 language stubs regenerated and verified
- Committed: `417ee6042 feat(apis/workflow): add llm_call and transform task types (T03 Batch 1)`

## Decisions Made

1. **Extract OnInvalidOutputPolicy to common.proto** — cleaner than importing from agent_call.proto; establishes the convention for shared task enums ahead of Batch 2
2. **Temperature range 0.0–2.0 for llm_call** — wider than agent_call's 0.0–1.0 because llm_call is a raw provider call; providers like OpenAI support up to 2.0
3. **TransformEngine as local enum** — specific to transform, no reason to share; unlike OnInvalidOutputPolicy which crosses task boundaries
4. **buf breaking FILE-level change accepted** — moving OnInvalidOutputPolicy between files is a FILE-level break but the enum is unreleased (@internal, added in T02 same project)

## Key Code Changes

- `apis/ai/stigmer/agentic/workflow/v1/tasks/common.proto`: New file — shared OnInvalidOutputPolicy enum
- `apis/ai/stigmer/agentic/workflow/v1/tasks/llm_call.proto`: New file — LlmCallTaskConfig
- `apis/ai/stigmer/agentic/workflow/v1/tasks/transform.proto`: New file — TransformEngine + TransformTaskConfig
- `apis/ai/stigmer/agentic/workflow/v1/tasks/agent_call.proto`: Removed OnInvalidOutputPolicy, added import for common.proto
- `apis/ai/stigmer/agentic/workflow/v1/enum.proto`: Added llm_call=14, transform=15
- `apis/ai/stigmer/agentic/workflow/v1/spec.proto`: Updated task_config mapping comment
- `backend/services/workflow-runner/pkg/validation/unmarshal.go`: Added switch cases

## Next Session Plan

- Pick up T03 Batch 2: `human_input` (enum 16) + `validate` (enum 17)
- `human_input` is the most complex proto in T03 — multi-party, timeout-aware, form-driven
- Decide whether `HumanInputTimeoutPolicy` goes in `common.proto` or stays local
- `validate` follows a similar pattern to llm_call (schema validation with fail/branch/warn)
- After Batch 2: Batch 3 (emit_event + notification), then T04 or T05
