# Model Registry: Cursor Catalog Coverage Check (No More $0-Billed Models)

**Date**: June 2, 2026

## Summary

Added a mandatory "catalog coverage check" to the `@update-model-registry` rule and used it to backfill four live Cursor models that were missing from `model-registry.json` — including the current flagship, Claude Opus 4.8. Any model Cursor can dispatch but that is absent from the registry has no pricing row, so the billing engine charges **$0** for it. The new step diffs Cursor's live list-models endpoint against the registry on every run, guaranteeing the gap is caught before it reaches production billing.

## Problem Statement

The registry at `backend/services/stigmer-service/src/main/resources/model-registry.json` (in stigmer-cloud) is the single source of truth for model pricing. A model missing from it is billed at zero. This had already happened silently with `Composer 2.5`, and a fresh audit showed it had happened again with several newer Cursor models.

### Pain Points

- **Silent $0 billing.** A dispatchable Cursor model with no registry entry incurs no cost — revenue leakage with no error or warning.
- **The old rule never asserted completeness.** Step 2 fetched Cursor's catalog, but Step 3 only described how to *match names to pricing rows*; nothing forced "every catalog id must have a registry entry."
- **The catalog fetch depended on the deployed cloud service.** It routed through the Stigmer proxy (`api.stigmer.ai/v1/proxy/...`) and a local Stigmer token, so it could not be run authoritatively/offline.

## Solution

Two changes to the `@update-model-registry` rule (in stigmer-cloud), plus the backfill they surfaced:

1. **Direct catalog fetch with the Planton-managed Cursor key.** Step 2 now calls Cursor's official `https://api.cursor.com/v1/models` directly, fetching the key from the Planton `cursor` secrets group exactly as the integration-test Makefiles do (`planton service secrets get-value --org stigmer --group cursor --name prod.api-key`). The proxy path is retained only as a fallback.
2. **New Step 3.5 — mandatory coverage check.** Build the set of catalog ids and the set of `harness: "cursor"` registry ids, then diff:
   - *In catalog, not in registry* → MISSING; add an entry, pulling pricing from the Cursor pricing page. If a model has no pricing row, flag and ask — never add with guessed/zero pricing.
   - *In registry, not in catalog* → STALE; present for confirmation, never silently delete.
   - Variant ids (e.g. a `-fast` parameter exposed as a routing entry, not a distinct catalog id) are left as-is.

## Implementation Details

Pricing for the backfilled models was taken from Cursor's pricing page (`https://cursor.com/docs/models-and-pricing.md`), joined to the catalog by provider + model name; `cursorTokenRatePerMillion: 0.25` comes from that page's "Cursor Token Rate" section.

Four cursor-harness models added to `model-registry.json` (input / output / cache-write / cache-read per 1M tokens):

- `claude-opus-4-8` — "Claude 4.8 Opus", Anthropic, featured flagship — $5 / $25 / $6.25 / $0.5 (and `claude-opus-4-7` demoted to `featured: false`)
- `gemini-3.5-flash` — "Gemini 3.5 Flash", Google — $1.5 / $9 / 0 / $0.15
- `grok-4.3` — "Grok 4.3", xAI — $1.25 / $2.5 / 0 / $0.2
- `grok-build-0.1` — "Grok Build 0.1", xAI — $1 / $2 / 0 / $0.2

After the backfill, the catalog/registry diff reports zero missing models. Remaining "in registry, not in catalog" entries are intentional: `composer-2`/`composer-1.5` (hidden on the pricing page), `composer-2.5-fast` (routing variant), and `grok-4-20` (still on the pricing page but dropped from the live catalog).

`model_pricing_service_test` passes; the JSON validates (62 entries).

## Benefits

- **No more silent $0-billed models** — a missing entry is now caught deterministically every time the rule runs, not by chance after the fact.
- **Authoritative, dependency-free audit** — the direct list-models call needs only a Planton key, not a deployed cloud service.
- **Clear add/keep/remove guidance** — the rule distinguishes missing (add), stale (confirm), and variant (leave) ids, so future runs don't churn the file.

## Impact

- Cursor-harness executions for Opus 4.8, Gemini 3.5 Flash, Grok 4.3, and Grok Build 0.1 now bill correctly (with the 0.25/M Cursor Token Rate) instead of being free.
- After the cloud service deploys, all consumers (React SDK `useModelRegistry`, cursor-runner, graphton) pick up the new entries within their 1-hour cache TTL.

## Related Work

- stigmer-cloud `.cursor/rules/update-model-registry.mdc` — the rule that now contains the coverage-check gate
- stigmer-cloud `_changelog/2026-06/2026-06-02-160723-cursor-token-rate-usage-proto-fields.md` — related Cursor Token Rate billing work

---

**Status**: ✅ Production Ready
**Timeline**: Single session
