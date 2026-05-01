# Dynamic Cursor Model Discovery and Pricing Alignment

**Date**: May 1, 2026

## Summary

Added dynamic model discovery to the Cursor runner, replacing hardcoded
model assumptions with live validation against the Cursor API catalog.
Corrected all model IDs in the pricing table to match Cursor's canonical
API format and expanded coverage from 15 to 27 models. This makes the
runner resilient to API key type changes and model roster evolution.

## Problem Statement

After rotating the platform Cursor API key from an Admin key to an MCP
integration key, agent executions began failing because the hardcoded
`composer-2` default model was not available to the new key type.
Additionally, the static pricing table used incorrect model IDs
(e.g., `claude-4.7-opus` instead of the API-canonical `claude-opus-4-7`)
and was missing 12 models from the Cursor catalog.

### Pain Points

- Model compatibility was invisible: failures occurred silently at
  execution time with no indication of which models were actually
  available
- Pricing IDs were hand-curated from documentation rather than validated
  against the live API, leading to drift
- No mechanism to gracefully fall back when a requested model was
  unavailable to the current API key

## Solution

Introduced a `model-discovery.ts` module that wraps `Cursor.models.list()`
with in-memory caching (15-minute TTL) and stale-cache fallback on
transient API failures. Integrated this into the execution pipeline as
Phase 6 — before agent creation — to validate or fall back on requested
model IDs. Updated the pricing table as a cost-estimation companion
(the Cursor API does not expose pricing).

## Implementation Details

### New: `model-discovery.ts`
- `discoverModels(apiKey)`: Fetches the live model catalog from Cursor,
  caches the result for 15 minutes, and falls back to stale cache on
  failure
- `resolveModelId(models, requestedModel)`: Validates a requested model
  against the catalog; returns `"default"` when the model is unknown
- `isValidModelId(models, id)`: Simple catalog membership check
- Works transparently through the existing fetch interceptor and proxy
  in cloud mode

### Updated: `execute-cursor.ts`
- New Phase 6 ("Discover models and validate selection") calls
  `discoverModels` and `resolveModelId` before agent creation
- The validated model ID flows into both `Agent.create()` and
  `UsageTracker`, eliminating the duplicated `"composer-2"` fallback
- Subsequent phases renumbered (7–13)

### Updated: `model-pricing.ts`
- All model IDs corrected to Cursor API canonical form
  (e.g., `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5`)
- `"auto"` renamed to `"default"` to match the API
- Added `displayName` field to `CursorModelPricing` interface
- Added 12 new model entries: `gpt-5.4-mini`, `gpt-5.4-nano`,
  `gpt-5.3-codex-spark`, `gpt-5.2`, `gpt-5.2-codex`, `gpt-5.1`,
  `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`, `gpt-5-mini`,
  `gemini-2.5-flash`, `grok-4-20`, `kimi-k2.5`
- Removed stale `composer-1` entry (not in Cursor API catalog)

### Updated: `sync.sh`
- Now copies `package-lock.json` alongside `package.json` to prevent
  dependency drift between cursor-runner source and embedded build

### Updated: `CursorProxyController.java` (stigmer-cloud)
- Metadata endpoints (`/v1/models`, `/v1/me`) exempted from
  execution-scoped authorization — they require only
  `STIGMER_TOKEN` authentication, not an `X-Stigmer-Execution-Id`

### Tests
- New `model-discovery.test.ts`: 12 tests covering caching,
  stale-cache fallback, validation, and edge cases
- Updated `model-pricing.test.ts`: corrected model IDs, added
  `displayName` field to test fixtures
- Updated `usage-tracker.test.ts`: corrected model ID reference

## Benefits

- **Resilient to key rotation**: The runner dynamically discovers which
  models the current API key supports rather than assuming availability
- **Graceful degradation**: Invalid or unavailable model requests fall
  back to `"default"` with a logged warning instead of hard-failing
- **Accurate cost tracking**: Pricing lookups use the same IDs the
  Cursor API returns, eliminating silent misses
- **Future-proof**: New models added to Cursor's catalog are
  automatically discovered without code changes

## Impact

- **Cursor runner**: Model selection is now validated at execution time
- **Stigmer proxy**: Metadata endpoints work without execution-scoped
  authorization, enabling model listing from any authenticated context
- **Cost estimation**: 12 additional models now have pricing entries,
  improving billing accuracy for multi-model usage

## Related Work

- `2026-05-01-154600-fix-cursor-runner-default-model-compatibility.md`:
  Companion fix that changed the hardcoded default from `composer-2` to
  `default`
- `2026-05-01-142354-fix-cursor-runner-silent-error-logging.md`:
  Diagnostic logging that helped identify the model failure pattern
- `2026-05-01-132919-fix-cursor-proxy-403-add-execution-authorization.md`:
  Original execution authorization that the metadata exemption extends

---

**Status**: ✅ Production Ready
**Timeline**: ~3 hours (investigation + implementation + testing)
