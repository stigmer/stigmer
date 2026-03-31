# Fix Vale lint warnings and Prettier formatting in docs

**Date**: March 31, 2026

## Summary

Resolved the `make check` failure caused by Prettier formatting issues in `docs/vocabulary.md` and `docs/index.mdx`, and reduced Vale lint warnings from 87 to 43 by fixing incorrect Stigmer term capitalization and adverb usage across both files.

## Problem Statement

`make check` was failing with exit code 2 due to Prettier code style violations in two documentation files. Additionally, Vale flagged 87 terminology warnings where Stigmer-specific terms (Agent, Skill, Workflow, Session, etc.) were incorrectly lowercased in contexts that require capitalization per the vocabulary guide's own rules.

### Pain Points

- `make check` could not pass — the `format-docs-check` target failed because Prettier found code style issues in `docs/vocabulary.md` and `docs/index.mdx`
- The vocabulary guide's example copy in quickstart, concepts, and reference columns used lowercase terms (e.g., "your agent") despite the guide itself requiring capitalization in those contexts
- Non-table definitions (Approval flow, Durable Execution, Seedpack, Graphton, Agent Runner) used lowercase for Stigmer resource names
- Adverbs flagged by Microsoft style guide ("rarely", "freely", "separately") added unnecessary hedging

## Solution

1. Ran Prettier to fix formatting in both files
2. Systematically fixed term capitalization in non-sales contexts, distinguishing between intentional lowercase (sales site examples, bad examples, verbatim quotes) and genuine errors
3. Replaced flagged adverbs with clearer phrasing

## Implementation Details

### `docs/index.mdx` (4 warnings fixed)
- Capitalized "Agent" and "Agents" in frontmatter description, body text, and Card component descriptions
- Changed "workflows" → "Workflows" in tutorial card description

### `docs/vocabulary.md` (40 warnings fixed)

**Non-table text:**
- "push skill" → "push Skill" (Skill API surface)
- "workflow DSL" → "Workflow DSL" (Workflow key fields)
- "an agent pauses" → "an Agent pauses" (Approval flow definition)
- "agent and workflow executions" → "Agent and Workflow executions" (Durable Execution definition)
- "agent definitions, skills, and MCP server" → "Agent definitions, Skills, and MCP Server" (Seedpack definition)
- "an agent that calls another agent" → "an Agent that calls another Agent" (Sub-Agent tutorial guidance)
- "The agent framework" → "The Agent framework" (Graphton)
- "AI agent tasks" → "AI Agent tasks" (Agent Runner)

**Table example copy (quickstart/concepts/reference/README columns):**
- Writing contexts table: "your agent can use" → "your Agent can use", "for your agent" → "for your Agent", "A skill is" → "A Skill is"
- Agent reference example: "AI agent definition" → "AI Agent definition"
- Skill examples: Capitalized "Agent" in quickstart and concepts rows
- MCP Server examples: Capitalized "Agent" in quickstart and concepts rows
- Session examples: Capitalized "Agent" in quickstart, "Agent-level" and "Session-level" in reference
- Workflow concepts example: "run an agent" → "run an Agent"
- Approval flow examples: Capitalized "Agent" in quickstart and concepts rows
- Reference example: "per-agent" → "per-Agent"

**Inconsistency register:**
- Capitalized "Agents and Workflows" in recommendation copy
- Capitalized "Agent" and "Workflow" in approval mechanism descriptions

**Adverb replacements:**
- "rarely in tutorials" → "only in tutorials when unavoidable"
- "Reference and SDK docs freely" → "Use in Reference and SDK docs without restriction"
- "In the README, use freely" → "In the README, use without restriction"
- "documented separately" → "documented as distinct topics"

### Intentionally skipped (43 remaining warnings)

These are false positives, not errors:
- **Sales site example copy**: lowercase "agent" is correct per the vocabulary guide's quick-reference table
- **Quick-reference table sales column**: deliberately shows lowercase terms
- **Bad examples**: showing what *not* to write — capitalization isn't the issue being demonstrated
- **Google.Colons**: `**Label**: Text` is standard bold-label markdown, not a sentence continuation
- **HeadingAcronyms**: CNCF and OSS are proper names / standard abbreviations
- **Verbatim quotes**: inconsistency register entries quoting actual text from other files

## Benefits

- `make check` now passes cleanly (exit code 0)
- Vale warnings reduced by 50% (87 → 43)
- The vocabulary guide's own examples now follow its own capitalization rules, eliminating a self-contradictory pattern
- Remaining warnings are all justified false positives that don't need action

## Impact

- **Developer experience**: `make check` no longer blocks on formatting errors
- **Content consistency**: Documentation landing page and vocabulary guide now consistently capitalize Stigmer terms in appropriate contexts
- **Style guide credibility**: The vocabulary guide practices what it preaches — its example copy matches its capitalization rules

## Related Work

- Vocabulary guide created in `10cc5038` (Phase 1 deliverable 2)
- Consistency review in `550fbe76` (Phase 1 deliverable review)

---

**Status**: ✅ Production Ready
