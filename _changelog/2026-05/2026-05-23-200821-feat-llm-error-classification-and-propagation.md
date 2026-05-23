# LLM Error Classification and User-Facing Error Propagation

**Date**: May 23, 2026

## Summary

Added comprehensive error handling to workflow `llm_call` tasks: LangChain SDK errors are now classified by HTTP status into `ApplicationFailure` with correct Temporal retryability semantics, error messages are properly unwrapped through the ActivityFailure chain to reach users, and the console inspector shows structured error categories with collapsible technical details.

## Problem Statement

When a workflow `llm_call` task failed (e.g., 403 from invalid proxy auth), three compounding issues prevented users from understanding what happened:

### Pain Points

- **Zero error handling**: The LangChain-rewritten `call-llm.ts` had no try-catch around `.stream()` or `.invoke()` — raw SDK exceptions propagated unclassified
- **Wrong retryability**: All LLM errors were treated as retryable by Temporal, causing permanent failures (401, 403, 404) to be retried 5 times before surfacing
- **Swallowed error messages**: `do-executor.ts` captured `taskErr.message` which was the Temporal `ActivityFailure` wrapper ("activity 'CallFunction' failed"), not the actual error
- **No structured classification**: The console showed raw error strings with no category, no actionable guidance, and no technical details

## Solution

Five coordinated changes across the runner engine, workflow executor, and React SDK console.

## Implementation Details

### 1. Error Classification (`call-llm.ts`)

Added `classifyAndThrowLlmError()` that duck-types on the `.status` property shared by both OpenAI and Anthropic SDK error hierarchies:

- 401 → `ApplicationFailure.nonRetryable("Authentication failed for model X...", "LLM_AUTHENTICATION_ERROR")`
- 403 → `LLM_PERMISSION_DENIED` (nonRetryable)
- 404 → `LLM_MODEL_NOT_FOUND` (nonRetryable)
- 400/422 → `LLM_BAD_REQUEST` / `LLM_UNPROCESSABLE_REQUEST` (nonRetryable)
- 429 → `LLM_RATE_LIMIT` (nonRetryable at Temporal level — LangChain SDK retries internally)
- 5xx → retryable `Error` (Temporal retry appropriate for transient provider outages)
- `ZodError` → `LLM_SCHEMA_VALIDATION` (nonRetryable — structured output didn't match schema)
- Connection/timeout errors → retryable `Error`

Also upgraded missing-API-key errors from plain `Error` to `ApplicationFailure.nonRetryable`.

### 2. Error Message Unwrapping (`error-utils.ts` + `do-executor.ts`)

Created `workflow-engine/error-utils.ts` with `extractRootErrorMessage()` and `extractStructuredError()`. Uses duck-typing (checking `.cause` chain) instead of `instanceof ActivityFailure` to avoid Temporal import coupling across sandbox boundaries.

Updated `do-executor.ts` catch block to use `extractRootErrorMessage` so the actual error message (e.g., "Access denied for model claude-haiku-4.5") reaches users instead of "activity 'CallFunction' failed".

### 3. Structured Error in Task Status Accumulator

Extended `taskFailed()` with an optional structured error parameter carrying `category`, `detail`, and `retryable`. When present, these are merged into the task's `metadata` map as `error_category`, `error_detail`, `error_retryable` — flowing through the existing proto `WorkflowTask.metadata` field to the console.

### 4. Console Error Tab Enhancement (`ErrorTab.tsx`)

- Error category badge (e.g., "Authentication Error", "Rate Limit", "Schema Validation")
- Collapsible "Show technical details" section with raw provider error text
- Category-to-label mapping for all LLM and HTTP error types

### 5. Diagnostic Logging

Added entry-point `console.log` in `callLlmAction` with model, provider, proxy status, structured output flag, and execution ID — makes diagnosing routing issues trivial from runner logs.

## Benefits

- **Instant failure for permanent errors**: 401/403/404 fail immediately instead of retrying 5 times (saves ~16s per failure)
- **Actionable error messages**: Users see "Authentication failed for model claude-haiku-4.5 (Anthropic)" instead of "activity 'CallFunction' failed"
- **Error classification in UI**: Category badges help users immediately understand the error class without reading the full message
- **No double-retrying**: 429 rate limits are handled by the SDK's built-in retry; Temporal doesn't pile on additional retries

## Impact

- **Workflow authors**: See clear, actionable error messages when LLM calls fail
- **Platform operators**: Diagnostic logging makes proxy/auth issues trivial to diagnose
- **Console UX**: Error tab now shows structured error information instead of raw strings

## Related Work

- LangChain rewrite: `_changelog/2026-05/2026-05-23-194126-feat-agent-call-strategy-structured-output-langchain.md`
- Runner task I/O enrichment: `_changelog/2026-05/2026-05-23-180610-feat-workflow-runner-task-status-enrichment.md`
- Runner task I/O follow-ups: `_projects/2026-05/20260523.02.workflow-ux-implementation/checkpoints/runner-task-io-followups.md`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
