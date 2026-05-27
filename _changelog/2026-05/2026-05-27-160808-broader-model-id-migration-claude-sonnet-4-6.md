# Broader Model ID Migration: `claude-sonnet-4-20250514` to `claude-sonnet-4-6`

**Date**: May 27, 2026

## Summary

Migrated all remaining references to the deprecated `claude-sonnet-4-20250514` model ID to `claude-sonnet-4-6` across both the stigmer and stigmer-cloud repositories. This covers runtime source, CLI help strings, SDK examples, proto API comments, test fixtures, integration tests, and documentation — ensuring the platform is ready before Anthropic's June 15, 2026 hard retirement deadline.

## Problem Statement

The default agent model was already migrated to dynamic registry resolution (`getDefaultModel()`) in a prior session, but ~160 remaining references to the deprecated `claude-sonnet-4-20250514` model ID were scattered across both repositories.

### Pain Points

- CLI help strings and documentation showed deprecated model ID as examples, misleading users
- Test fixtures and integration tests hardcoded the deprecated model, risking failures after June 15
- Proto API comments cascaded the deprecated example into all generated stubs (Go, Java, TypeScript, Dart)
- Context tracker lacked an entry for the replacement model, potentially causing incorrect context window estimates

## Solution

Systematic find-and-replace across both repositories with nuanced handling of different reference categories:

- **Runtime source**: Added `claude-sonnet-4-6` to context tracker (kept old entry for backward compat), updated CLI help strings and SDK examples
- **Proto + codegen**: Updated proto source comment, ran `make codegen` (stigmer) and `make protos` (stigmer-cloud) to regenerate all stubs
- **Test code**: Updated ~32 test files including unit tests, integration tests, recorded response fixtures, and mock LLM proxy
- **Documentation**: Updated CLI docs, SDK docs, seedpack skill docs, and moved original Claude Sonnet 4 to "Deprecated" in the model reference
- **Intentionally preserved**: `model-registry.json` entry (correct mapping for original model), `context-tracker.ts` old entry (backward compat), historical project notes

## Implementation Details

**stigmer (OSS)** — 66 files modified:
- `context-tracker.ts`: Added `claude-sonnet-4-6` entry alongside existing entries (fallback lookup for in-flight executions)
- `spec.proto`: Updated `ExecutionConfig.model_name` example comment → regenerated stubs via `make codegen`
- CLI help strings: 5 Go source files (`run.go`, `run_agent_exec.go`, `draft_agent.go`, `draft_mcp_server.go`, `draft_skill.go`)
- SDK: `useSessionUsage.ts` JSDoc, `streaming_execution.go` example
- Tests: 9 TS unit test files, 14 JSON recorded-response fixtures, 9 Go integration test files
- Docs: 8 documentation files including CLI commands, SDK reference, seedpack skills

**stigmer-cloud** — 47 files modified (including regenerated stubs):
- Java source: `ModelPricingService.java`, `ExecutionBillingService.java` Javadoc examples
- Java tests: 6 test files (billing, usage rating, credit ledger, SSE extractors)
- Test fixtures: 4 SSE response fixture files
- Proto stubs: Regenerated via `make protos`

## Benefits

- Platform is ready for Anthropic's June 15, 2026 model retirement — no last-minute scramble
- Users see current model ID in CLI help, docs, and examples
- Tests validate behavior with the current model, avoiding post-retirement CI failures
- Context tracker correctly estimates window size for both old and new model IDs

## Impact

- **Users**: CLI `--model` help and documentation examples now reference the current model
- **Developers**: Integration tests and fixtures use the current model — no manual updates needed at retirement
- **Platform builders**: SDK JSDoc and type documentation reference the current model

## Related Work

- Dynamic default model registry resolution (Session 15, commit `1fef112b4`)
- v3 streaming migration project (Sessions 1-15)

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~25 minutes)
