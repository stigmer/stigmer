# Single-Quoted jq Expression Support for Approval Gates

**Date**: May 31, 2026

## Summary

Fixed a production workflow failure where approval-gate `switch_case` conditions using single-quoted string literals (e.g. `'approve'`) caused jq-wasm syntax errors and aborted execution. Added a character-by-character single-quote normalizer in the TS expression engine, documented single quotes as the recommended YAML pattern, and closed six integration-test gaps with 14 new tests across four files plus a golden YAML fixture.

## Problem Statement

The `daily-notification-plan` workflow failed at an approval gate with:

```
jq: error: syntax error, unexpected INVALID_CHARACTER
... $context.team_lead_review.outcome == 'approve'
```

Workflow authors naturally write string comparisons with single quotes inside `${ ... }` expressions because YAML double-quoting is awkward. jq-wasm (like jq itself) only accepts double-quoted string literals. The expression engine passed single-quoted literals through unchanged, so any `switch_case` routing on human-input outcomes silently broke in production.

### Pain Points

- Approval gates (`human_input` → `switch_case` on `outcome`) are a core HITL pattern but had zero integration test coverage
- String equality in switch conditions was untested (single quotes, double quotes, case sensitivity, special chars)
- Expression evaluation failures (invalid jq, missing context paths, type mismatches) were not validated end-to-end
- Multi-hop `$context` propagation through chained tasks was not integration-tested
- Documentation showed escaped double quotes, encouraging a syntax that works but is YAML-unfriendly
- Existing golden tests covered kernel tasks but not the approval-gate string-switch pattern

## Solution

Add `normalizeSingleQuotedStrings()` to the expression evaluation pipeline — a lexer-style state machine that converts single-quoted jq literals to properly escaped double-quoted literals before jq-wasm evaluation. Wire it into `evaluateExpression()` ahead of existing `preprocessUuid()`. This runs inside the `EvaluateExpressions` Temporal local activity, so it is replay-safe for in-flight workflows.

## Implementation Details

### Expression Engine (`expression.ts`)

- **`normalizeSingleQuotedStrings(expr)`** — character-by-character parser tracking `normal`, `single_quoted`, `double_quoted`, and `comment` states. Handles embedded double quotes and backslashes inside single-quoted content via `escapeForJqDoubleQuoted()`.
- **`evaluateExpression()`** — calls normalizer before UUID preprocessing and variable binding.
- Removed stale reference to deleted Go expression evaluator (`utils/runtime_expressions.go`).

### Unit Tests

- **16 normalizer tests** — simple strings, empty strings, mixed quotes, backslashes, comments, production bug expression
- **8 end-to-end evaluateExpression tests** — string comparisons through jq-wasm with `$context` paths and if-then-else
- **5 switch task tests** — approval gate routing with single/double quotes, 3-way switches, nested context
- **Golden #27** — `27-approval-gate-string-switch.yaml` with approve and reject path assertions

### Integration Tests (4 new files, 14 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `workflow_hitl_switch_test.go` | 4 | human_input → switch_case: approve, reject, 3-way, form_data in condition |
| `workflow_switch_string_test.go` | 5 | String equality: single/double quotes, case sensitivity, special chars, YAML path |
| `workflow_expression_errors_test.go` | 3 | Invalid jq, missing context, type mismatch → FAILED phase |
| `workflow_context_chain_test.go` | 2 | 3-hop context propagation, structured output in switch condition |

### Documentation

Updated `apis/ai/stigmer/agentic/workflow/docs/expressions.md` to recommend single quotes in YAML and document automatic conversion.

## Benefits

- Approval-gate workflows (including `daily-notification-plan`) route correctly on string outcomes
- Authors can use natural YAML quoting without jq syntax errors
- Six previously untested workflow patterns now have regression coverage
- Expression error propagation validated at integration level
- Golden test #27 provides deterministic, infra-free regression for the exact failure pattern

## Impact

- **Workflow authors**: Single-quoted string comparisons in `${ ... }` expressions now work as documented
- **HITL flows**: Approval gates with `switch_case` on `outcome` are production-ready
- **Platform confidence**: Integration suite now catches expression/switch/context gaps that unit tests alone missed
- **In-flight workflows**: Fix is replay-safe via Temporal local activity result caching

## Related Work

- Workflow runner TypeScript rewrite: `_projects/2026-05/20260519.01.workflow-runner-typescript-rewrite`
- E2E workflow testing infrastructure: `_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure`
- HITL approval UI: `_projects/2026-05/20260521.03.workflow-hitl-approval-ui`
- Version-pinned execution graph fixes: `_changelog/2026-05/2026-05-31-122533-version-pinned-execution-graph-correctness.md`

---

**Status**: ✅ Production Ready (pending runner rebuild + manual re-run of affected workflows)
**Timeline**: Single session — root cause analysis, fix, unit tests, golden test, integration tests, docs
