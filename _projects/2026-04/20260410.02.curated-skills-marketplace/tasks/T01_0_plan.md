# Curated Skills Marketplace -- Task Plan

**Created**: 2026-04-10
**Status**: PENDING REVIEW

## Context

The seedpack currently has 3 skills, all meta-authoring focused (skill-creator, agent-creator, mcp-server-creator). None are general-purpose. This undermines Pillar 1 ("Knows Your Business") -- the first messaging pillar in the positioning strategy.

The `anthropics/skills` repo (114k stars) has 17 skills using the exact same SKILL.md format. Most are Apache 2.0. The vendoring infrastructure already exists (`01_vendor_skill.sh` + `vendor-sources.json`).

We will expand to ~18 total skills (3 existing + ~15 new) through vendoring and self-composition, plus create composite agents that demonstrate skills + MCP servers working together.

**Reference plan**: `_cursor/plans/curated_skills_marketplace_59b7afd1.plan.md`

---

## Task 1: Vendor Skills from `anthropics/skills` + License Check

**Repo**: stigmer
**Scope**: Vendor 6 Apache 2.0 skills, check license on 4 document skills

### 1.1 Vendor Apache 2.0 skills

Update `seedpack/tools/vendor-sources.json` and run `01_vendor_skill.sh` for:

| Skill | Category | What it does |
|-------|----------|--------------|
| **webapp-testing** | Development | Automated UI testing with Playwright |
| **claude-api** | Development | Using Claude API effectively |
| **doc-coauthoring** | Enterprise | Collaborative document writing |
| **internal-comms** | Enterprise | Writing internal communications |
| **brand-guidelines** | Enterprise | Creating brand consistency guides |
| **web-artifacts-builder** | Development | Building interactive web artifacts |

**Skip** (too niche or overlaps): `algorithmic-art`, `slack-gif-creator`, `theme-factory`, `mcp-builder`

Steps:
1. Pin the latest commit SHA from `anthropics/skills`
2. Add all 6 entries to `vendor-sources.json`
3. Run `01_vendor_skill.sh` for each skill
4. Verify each gets `SKILL.md`, `provenance.json`, `references/` (if any)

### 1.2 Check document skills license

Read the license for `docx`, `pdf`, `pptx`, `xlsx` in `anthropics/skills`:
- These are described as "source-available, not open source"
- Check if redistribution in a product seedpack is allowed
- If yes: vendor all 4
- If no: skip, note as future item

### 1.3 Commit and PR

---

## Task 2: Self-Compose 5 Domain Skills

**Repo**: stigmer
**Scope**: Write 5 original SKILL.md-based skills

Each skill directory in `seedpack/skills/` will contain:
- `SKILL.md` with frontmatter (`name`, `description`) + structured workflow
- `references/` with supporting material

### Skills to compose:

**1. customer-support**
The #1 use case for AI agents on SaaS platforms. Teaches agents:
- Professional tone and empathy patterns
- Escalation decision frameworks (when to hand off to humans)
- Resolution workflows (gather info, diagnose, resolve, follow up)
- Handling difficult conversations
- Multi-channel awareness (email, chat, phone)

**2. code-reviewer**
Platform builders' dev teams need code review agents. Teaches agents:
- What to look for: bugs, security, performance, maintainability
- How to prioritize feedback (critical vs. nitpick)
- How to give constructive feedback (suggest, don't demand)
- Language-agnostic patterns (complexity, error handling, naming)
- Security-specific review checklist

**3. technical-writer**
Platform builders need documentation. Teaches agents:
- Audience-aware writing (developer vs. end-user vs. decision-maker)
- Document structure patterns (tutorials, how-tos, references, explanations)
- API documentation best practices
- Clarity principles (active voice, concrete examples, progressive disclosure)
- Style consistency

**4. data-analyst**
Every platform deals with data. Teaches agents:
- Exploratory analysis methodology
- Pattern identification and statistical reasoning
- How to present insights (narrative structure, key takeaways)
- Data quality assessment
- Visualization guidance (when to use what chart type)

**5. research-analyst**
Knowledge-intensive platforms need research capability. Teaches agents:
- Systematic research methodology (define question, gather sources, evaluate, synthesize)
- Source evaluation (credibility, recency, relevance)
- Synthesis and summarization techniques
- Citation and attribution best practices
- Report structure (executive summary, findings, recommendations)

### Quality bar

Each self-composed skill should match the quality of Anthropic's vendored skills:
- Clear, actionable workflow (numbered steps)
- Specific guidelines (not vague platitudes)
- Examples where helpful
- References for deep dives

### 2.1 Commit and PR

---

## Task 3: Create Composite Agents + Test

**Repo**: stigmer
**Scope**: Create 4 agent YAML files, test seedpack apply

### 3.1 Create composite agents

Agents in `seedpack/agents/` that pair skills with MCP servers:

| Agent | Skill | MCP Servers | Purpose |
|-------|-------|-------------|---------|
| **support-agent** | customer-support | Zendesk, Slack | Handles customer support tickets with domain expertise |
| **code-review-agent** | code-reviewer | GitHub | Reviews PRs with structured methodology |
| **docs-agent** | technical-writer | GitHub, Filesystem | Creates and maintains technical documentation |
| **research-agent** | research-analyst | Brave Search, Exa, Fetch | Conducts systematic research with web access |

Each agent YAML will have:
- Clear `instructions` that leverage the referenced skill
- `skill_refs` pointing to the skill slug
- `mcp_server_usages` referencing curated MCP servers (from the MCP marketplace project)
- Appropriate `description` for marketplace display

**Note**: These agents depend on the curated MCP servers from the companion project landing first. If those MCP servers haven't been applied yet, the agents can still be created but `mcp_server_usages` references won't resolve until those servers exist.

### 3.2 Test seedpack apply

- Run `stigmer seedpack apply` to verify all skills and agents bootstrap
- Verify agents can reference skills via `skill_refs`
- Verify the skills marketplace shows them properly

### 3.3 Commit and PR

---

## Execution Order

Task 1 is fast (vendoring script exists). Task 2 is the biggest effort (writing 5 original skills). Task 3 depends on Tasks 1-2.

**Recommended conversation split:**
- **Conversation 1**: Task 1 (vendor from Anthropic -- fast, infrastructure exists)
- **Conversation 2**: Task 2 (self-compose 5 skills -- the creative/writing work)
- **Conversation 3**: Task 3 (create composite agents + test)
