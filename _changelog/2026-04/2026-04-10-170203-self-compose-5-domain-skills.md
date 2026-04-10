# Self-Compose 5 Domain Skills for Seedpack Marketplace

**Date**: April 10, 2026

## Summary

Added 5 original domain-expertise skills to the seedpack marketplace: customer-support, code-reviewer, technical-writer, data-analyst, and research-analyst. These skills teach agents structured methodology for common business domains, expanding the seedpack from platform-authoring tools to general-purpose expertise that demonstrates Pillar 1 (Knows Your Business).

## Problem Statement

The seedpack had 10 skills after vendoring from Anthropic, but all were either meta-authoring tools (agent-creator, mcp-server-creator, skill-creator) or domain-specific utilities (webapp-testing, canvas-design, etc.). None taught agents how to excel at the most common AI agent use cases: customer support, code review, technical writing, data analysis, and research.

### Pain Points

- Platform builders adopting Stigmer had no out-of-the-box domain expertise for their agents
- The skills marketplace appeared tool-focused rather than business-value-focused
- Pillar 1 ("Knows Your Business") had no concrete proof points in the seedpack
- Agents using only the vendored skills lacked methodology for high-value business workflows

## Solution

Self-composed 5 domain-expertise skills following a consistent structural pattern. Each skill teaches a step-by-step methodology rather than trying to be an exhaustive domain manual. Skills are tool-agnostic by design — the methodology works standalone, and tool integration happens at the agent layer through composite agents (Task 3).

## Implementation Details

### Structural Pattern

Each skill follows a consistent anatomy:

- **SKILL.md** (133-216 lines): YAML frontmatter with trigger-focused description, numbered workflow steps, key principles (6-7 per skill), and a reference file table
- **references/** (2 files each): Deep-dive supporting material loaded on demand — checklists, templates, example patterns, decision frameworks

### Skills Created

| Skill | Workflow Steps | References | Focus |
|-------|---------------|------------|-------|
| **customer-support** | 4 (assess, gather, resolve, close) | escalation-framework, conversation-patterns | Issue resolution methodology with escalation decision tree |
| **code-reviewer** | 5 (understand, verify, assess quality, evaluate risk, deliver) | review-checklist, feedback-patterns | Systematic review with severity-categorized feedback |
| **technical-writer** | 5 (classify, gather, structure, write, review) | document-types, clarity-checklist | Diataxis-informed documentation methodology |
| **data-analyst** | 5 (frame, assess, analyze, synthesize, communicate) | analytical-methods, visualization-guide | Decision-oriented analytical thinking |
| **research-analyst** | 5 (define, plan, gather, synthesize, present) | source-evaluation, report-structure | Systematic methodology with source credibility framework |

### Key Design Decisions

- **Methodology, not encyclopedia**: Each skill teaches a decision framework ("senior practitioner's mental model"), not exhaustive domain knowledge
- **Tool-agnostic core**: Skills work without MCP tools; tool integration is the agent layer's concern
- **Anti-platitude quality bar**: Every principle must be specific enough to disagree with — "be helpful" is filler; "one apology, sincerely — then demonstrate care through action" is a principle
- **Progressive disclosure**: SKILL.md stays lean (under 500 lines); reference files hold depth
- **Trigger-focused descriptions**: Frontmatter `description` specifies when to activate with 6 concrete example phrases each

### Scoping Decisions

- **research-analyst**: Focused on systematic methodology and source evaluation, not general summarization (LLMs already summarize well; the skill's value is structured process and citation discipline)
- **data-analyst**: Focused on analytical thinking and insight communication, not computation (tools like pandas/SQL live at the agent layer)

## Benefits

- Seedpack grows from 10 to 15 skills, with domain expertise now represented
- Platform builders get ready-to-use skills for the 5 most common AI agent use cases
- Consistent structural pattern makes it easy to compose additional domain skills in the future
- Skills are composable with MCP servers through composite agents (Task 3)

## Impact

- **Seedpack marketplace**: 5 new publicly visible skills covering high-value business domains
- **Platform positioning**: Concrete proof points for Pillar 1 (Knows Your Business)
- **Skill authoring pattern**: Established a reusable structural template for domain-expertise skills that differs from the existing platform-authoring skill pattern

## Related Work

- [Vendor Skills from Anthropic Skills](2026-04-10-162007-vendor-skills-from-anthropic-skills.md) — Task 1 of the same project, vendored 7 Apache 2.0 skills
- [Curated MCP Marketplace](2026-04-10-164734-curated-mcp-marketplace-36-servers.md) — Companion project providing the MCP servers that Task 3 will pair with these skills
- Task 3 (composite agents) will create agent YAMLs that pair these skills with curated MCP servers

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
