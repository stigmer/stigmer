# Workflow Model ID Validation with Harness-Aware Suggestions

**Date**: June 1, 2026

## Summary

Added model ID validation to the workflow spec validation pipeline in both the Go OSS server and the Java Cloud service. When a user specifies an invalid model ID in a workflow task, the validator now rejects it at `stigmer apply` / `stigmer validate` time with a harness-filtered "did you mean?" suggestion, instead of silently accepting it and failing at execution time.

## Problem Statement

The workflow validation pipeline had zero model ID validation. A user could write `model: "clode-sonet-99"` in a workflow YAML, and it would pass all validation steps. The error would only surface at execution time — or worse, the Cursor runtime would silently fall back to the `"default"` model, running the workflow on an unintended model without any warning.

### Pain Points

- Invalid model IDs were accepted at authoring time with no feedback
- Typos in model names (e.g., `claude-sonet-4` instead of `claude-sonnet-4`) went undetected
- Cross-harness mistakes (using a native model ID like `claude-sonnet-4.6` with `harness: cursor`) were invisible
- The Cursor runtime's silent fallback to `"default"` masked configuration errors
- No distinction between "model doesn't exist" and "model exists but for a different harness"

## Solution

A new validation step (`ValidateModelReferences`) added to the in-process workflow validator in both Go and Java. The step:

1. Extracts model ID and harness from `agent_call`, `llm_call`, and `eval` tasks using typed proto unmarshal
2. Filters the model registry by the task's effective harness (native vs cursor)
3. Validates the model ID against the filtered set
4. On mismatch, computes Levenshtein distances and suggests up to 3 closest matches from the correct harness

## Implementation Details

### Error Message Design

Error messages are harness-aware and show only relevant suggestions:

```
task 'analyze_player_data' (agent_call): model 'claude-opus-4.6' is not a valid model 
for harness 'cursor'. Did you mean: 'claude-opus-4-6', 'claude-opus-4-5', 'claude-opus-4-7'?
```

The suggestion algorithm uses Levenshtein distance (already present in `crossref.go` for task name typos), extended to support multiple ranked suggestions with a higher distance threshold (5 vs 3) since model IDs are longer than task names.

### Go Server (OSS)

- Embedded minimal model registry (`data/model-registry.json`) with 47 entries (20 native, 27 cursor), containing only `id` and `harness` per model
- `model_validation.go`: `ValidateModelReferences()` using typed unmarshal via `converter.UnmarshalTaskConfigPublic()` (same pattern as `budget_warnings.go`)
- Harness resolution: `AgentCallTaskConfig.Harness` enum, default `HARNESS_UNSPECIFIED` → native
- 16 unit tests covering valid models, invalid models, cross-harness mismatch, optional model skip, far typos, multiple errors, and edge cases

### Java Service (Cloud)

- `ModelValidationHelper` Spring component, injected with existing `ModelPricingService` which already loads `model-registry.json` at startup
- Builds harness-indexed model sets at `@PostConstruct`
- Identical error message format and Levenshtein algorithm as Go
- First Levenshtein/did-you-mean utility in the Java codebase
- 19 JUnit 5 tests mirroring Go test cases using a stub `ModelPricingService`

### Task Extraction Logic

| Task Kind | Model Source | Harness | Optional? |
|-----------|-------------|---------|-----------|
| `agent_call` | `config.model` | From `harness` field | Yes — skip when empty |
| `llm_call` | `model` | Always native | No — required field |
| `eval` | `model` | Always native | No — required field |

## Benefits

- Immediate feedback on invalid model IDs at authoring time (seconds vs minutes-to-failure at runtime)
- Harness-aware suggestions prevent cross-harness confusion (native vs cursor model ID conventions)
- Typo detection with ranked suggestions reduces trial-and-error
- Consistent validation behavior between OSS and Cloud editions

## Impact

- **Workflow authors**: Get actionable error messages when they specify an invalid model
- **Platform operators**: Fewer runtime failures from model configuration errors
- **Both editions**: Go and Java validators now share identical model validation logic and error format

## Related Work

- Existing Levenshtein-based "did you mean?" for task name typos (`crossref.go`)
- Model registry maintained by `@update-model-registry` rule in stigmer-cloud
- Budget warnings validation (`budget_warnings.go`) — same typed unmarshal pattern

---

**Status**: Production Ready
**Timeline**: Single session
