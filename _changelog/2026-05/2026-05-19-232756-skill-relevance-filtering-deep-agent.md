# Skill Relevance Filtering for Deep Agent Execution

**Date**: May 19, 2026

## Summary

Ported the complete skill pipeline to the unified TypeScript runner's ExecuteDeepAgent path — including BM25-based relevance filtering that reduces prompt noise when agents have 8+ skills configured. Skills are now fetched via gRPC, written to the workspace, and injected into the system prompt following the progressive disclosure model.

## Problem Statement

The ExecuteDeepAgent activity in the unified TS runner had no skill support — `skillsPromptSection` was hardcoded to an empty string. Agents with skills configured on their blueprint would not receive any skill context during execution, breaking feature parity with the Python agent-runner.

### Pain Points

- Agents with skills got no skill context in deep-agent mode (only Cursor path had skills wired)
- No relevance filtering existed — agents with many skills would have excessive prompt noise
- The Python runner handled this correctly but was slated for removal after migration

## Solution

Ported the Python implementation to TypeScript as two shared modules (`skill-relevance.ts` and `skill-writer.ts`) and wired them into `setup.ts` between workspace provisioning and prompt construction.

## Implementation Details

**New shared modules (zero external dependencies):**

- `src/shared/skill-relevance.ts` — BM25 scoring algorithm with configurable threshold (default: 8 skills). Implements tokenization with stop-word removal, IDF computation, document-length normalization, and a safety floor that always keeps at least half the skills included.
- `src/shared/skill-writer.ts` — Skill fetching (via gRPC `getSkillByReference`), ZIP artifact extraction to `.stigmer/skills/{name}/`, prompt section generation following the Agent Skills spec progressive disclosure model, and workspace integrity checks for resume fast-path.

**Setup integration (Step 7b in the execution pipeline):**

1. Merge `skill_refs` from agent + session specs (union, dedup by slug)
2. Fetch skills in parallel via gRPC
3. Download and extract ZIP artifacts to workspace
4. Apply BM25 relevance filtering when count >= 8
5. Generate prompt section with "Also Available" note for excluded skills

**Test coverage:** 54 new unit tests covering tokenization, BM25 scoring, threshold filtering, workspace writing, prompt generation, and error resilience.

## Benefits

- Feature parity with Python agent-runner for skill injection
- Reduced prompt noise for skill-heavy agents (BM25 excludes irrelevant skills)
- Progressive disclosure preserves context budget (~50-70 tokens per included skill)
- Excluded skills remain accessible via "Also Available" section
- Safety floor prevents over-aggressive filtering

## Impact

- **ExecuteDeepAgent**: Full skill pipeline now active (was previously empty)
- **Test suite**: 488 → 542 tests (54 new, all passing)
- **Proto observability**: `ResolvedExecutionContext.skill_names` / `excluded_skill_names` can now be populated by the TS runner
- **Migration roadmap**: Phase 4 supporting activities effectively complete

## Related Work

- Phase 4 multi-provider model support (session 14)
- Phase 4 connect backfill (session 15)
- Python `skill_relevance.py` and `skill_writer.py` (reference implementations)
- Proto: `ResolvedExecutionContext.excluded_skill_names` field

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~30 minutes)
