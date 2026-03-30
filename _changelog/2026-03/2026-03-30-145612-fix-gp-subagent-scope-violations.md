# Fix General-Purpose Sub-agent Scope Violations

**Date**: March 30, 2026

## Summary

Implemented a targeted fix to prevent General-Purpose (GP) sub-agents from exceeding their delegated task scope by stripping skills metadata and sub-agent delegation rules from their system prompt, and adding explicit scope boundary instructions. This addresses a production issue where sub-agent 3 autonomously executed skill creation workflows instead of completing its assigned exploration task.

## Problem Statement

During skill creation workflows, GP sub-agents were inheriting the parent agent's full system prompt, including skills metadata with activation breadcrumbs (e.g., `**Activate**: read .stigmer/skills/skill-creator/SKILL.md`). This caused sub-agents to proactively follow skill activation instructions instead of staying within their delegated task boundaries.

### Pain Points

- Sub-agent 3 executed `init_skill.py` and wrote multiple files (`SKILL.md`, `proto-api.md`, `param-system.md`) despite being tasked only with exploration and reporting
- GP sub-agents had access to skill activation breadcrumbs that encouraged autonomous skill execution
- No explicit scope constraints in sub-agent prompts to prevent overstepping delegated tasks
- Extended sub-agent runtime provided more opportunities for scope drift due to LLM "proactive helpfulness"

## Solution

Implemented a two-pronged approach (Option A + B from the analysis plan):

1. **Strip problematic sections**: Remove `## Available Skills` and `## Sub-agent delegation rules` sections from the GP sub-agent's system prompt
2. **Add scope boundaries**: Prepend explicit instructions constraining the sub-agent to its delegated task only

## Implementation Details

### Core Changes

**`backend/libs/python/graphton/src/graphton/core/agent.py`**:
- Added `_build_gp_system_prompt()` helper function with regex-based section stripping
- Implemented `_SKILLS_SECTION_RE` and `_SUBAGENT_RULES_SECTION_RE` patterns to identify and remove problematic sections
- Added `_GP_SCOPE_PREAMBLE` constant with explicit scope boundary instructions
- Modified `_pending_gp_config` to use the scoped prompt instead of the raw parent prompt

### Regex Patterns

```python
_SKILLS_SECTION_RE = re.compile(
    r"\n\n## Available Skills\n.*?(?=\n\n## |\Z)",
    re.DOTALL,
)
_SUBAGENT_RULES_SECTION_RE = re.compile(
    r"\n\n## Sub-agent delegation rules\n.*?(?=\n\n## |\Z)",
    re.DOTALL,
)
```

### Scope Preamble

```
You are a delegated sub-agent. Your ONLY responsibility is to complete 
the specific task described in the user message below. Stay strictly 
within the scope of that task. Do NOT:
- Follow skill activation instructions from the system context
- Perform work that was not explicitly requested in your task
- Create, scaffold, or write deliverables unless the task specifically asks for it
- Initiate workflows or run scripts that go beyond the delegated task

If you discover information relevant to the broader project but outside 
your task scope, include it in your report -- do NOT act on it.
```

### Test Updates

**`backend/libs/python/graphton/tests/core/test_recursion_limit.py`**:
- Updated `test_general_purpose_uses_main_agent_model_and_prompt` → `test_general_purpose_uses_main_agent_model_and_scoped_prompt`
- Added `test_general_purpose_prompt_strips_skills_and_delegation_rules` to verify section stripping behavior
- All 38 existing tests continue to pass

## Benefits

- **Prevents scope violations**: GP sub-agents can no longer see skill activation breadcrumbs
- **Explicit constraints**: Clear instructions prevent autonomous skill execution
- **Preserves functionality**: Other system prompt sections (workspace, response rules) remain intact
- **Defense-in-depth**: Combines root cause fix (stripping breadcrumbs) with behavioral constraints (scope preamble)
- **Minimal impact**: Changes are isolated to GP sub-agent compilation path only

## Impact

### Affected Components
- **GP Sub-agent System**: All future GP sub-agent invocations will use scoped prompts
- **Skill Creation Workflows**: Sub-agents will no longer autonomously execute skill creation steps
- **Test Suite**: Updated to reflect new expected behavior while maintaining full coverage

### Preserved Behavior
- Main agent retains full access to skills metadata and activation instructions
- Named sub-agents with explicit `skill_refs` continue to work as designed
- GP sub-agents retain full tool access (read, write, execute, etc.) as intended

## Related Work

This fix implements the recommendations from the "Sub-agent Scope Violation Analysis" plan, specifically addressing the root cause identified in the production incident where sub-agent 3 went beyond its exploration mandate. The solution aligns with industry best practices from Cursor's sub-agent model, which uses clean context and purpose-specific prompts to prevent scope violations.

---

**Status**: ✅ Production Ready  
**Timeline**: Single development session (~2 hours)