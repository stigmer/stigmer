# SKILL.md Format and Package Structure

How to author the `SKILL.md` file and structure a skill package for publishing.

## What Is SKILL.md?

`SKILL.md` is the required entry point for every skill. It is a Markdown file with a YAML frontmatter header that serves two purposes simultaneously:

1. **Machine-readable metadata**: The frontmatter fields (`name`, `description`) are extracted by the platform and stored in the Skill resource. They drive search, discovery, and context-window management at runtime.
2. **Agent instructions**: The Markdown body is the content injected into agent context at runtime. Write it as instructions *to* the agent — as if you are coaching it on how to use this skill.

## Frontmatter Schema

Every `SKILL.md` must begin with a YAML frontmatter block enclosed between `---` markers. The frontmatter must be the very first thing in the file — no blank lines before the opening `---`.

```markdown
---
name: calculator
description: "Performs arithmetic operations and evaluates mathematical expressions"
version: "1.0.0"
---

# Calculator Skill

...body content here...
```

### Frontmatter Fields

| Field | Required | Format | Description |
|---|---|---|---|
| `name` | **Yes** | Kebab-case, optionally dot-scoped: `^[a-z0-9]+([.-][a-z0-9]+)*$` | The canonical skill identifier. Used to derive the slug for referencing the skill from agents. Lowercase letters, numbers, hyphens between words, and dots to separate namespace segments; every segment must be alphanumeric. The slug renders dots as hyphens (`platform.planton-architecture` → slug `platform-planton-architecture`). Examples: `calculator`, `web-scraper`, `math-utils`, `platform.planton-architecture`. |
| `description` | Strongly recommended | Plain text, 1-2 sentences, under 100 tokens | A concise summary of what this skill does. Shown in the marketplace, used by the runtime to decide when to activate the skill's full content. Short, precise descriptions improve context-window efficiency. |
| `version` | No | Freeform string | An informational version label. **Not used for platform versioning** — the platform uses the artifact's SHA-256 hash as the authoritative version. This field is for human reference only. Examples: `"1.0.0"`, `"2024-01"`. |

### Name Constraints

The `name` field has strict format requirements enforced by the backend. It is
kebab-case, optionally scoped with dot-separated namespaces — dots let you
organize skills by scope (e.g. platform-managed vs org-specific) without name
collisions. The derived slug renders dots as hyphens.

```yaml
# Correct
name: calculator
name: web-scraper
name: math-utils
name: pdf-extractor2

# Correct — dot-separated namespaces (slug becomes platform-planton-architecture)
name: platform.planton-architecture
name: org.acme.custom-runbook

# Wrong — uppercase letters
name: Calculator
name: WebScraper

# Wrong — camelCase
name: webScraper

# Wrong — underscores
name: web_scraper

# Wrong — starts with a separator
name: -scraper
name: .platform

# Wrong — consecutive separators
name: platform..architecture

# Wrong — spaces
name: web scraper
```

### Description Guidelines

The `description` field drives two runtime behaviors:

1. **Skill activation**: The runtime uses the description to decide whether to load the full `SKILL.md` body for a given agent request. A vague description (e.g., "A skill") will cause the skill to be activated for irrelevant requests and skipped for relevant ones.
2. **Marketplace display**: Descriptions appear in the skill directory and agent configuration UI.

Write descriptions that answer the question: *"When should an agent use this skill?"*

```yaml
# Effective — specific about what triggers use and what output to expect
description: "Evaluates mathematical expressions, unit conversions, and statistical calculations"

# Effective — names the domain and capability clearly
description: "Extracts structured data (tables, dates, figures) from PDF and Word documents using OCR when needed"

# Ineffective — too vague to drive activation decisions
description: "A useful skill for data work"

# Ineffective — describes the implementation, not the capability
description: "Uses Python regex and BeautifulSoup to parse HTML"
```

Keep descriptions under 100 tokens (~75 words). The runtime loads them into context for every agent turn — long descriptions waste context space.

## Body Guidelines

The `SKILL.md` body is Markdown content that follows the closing `---` of the frontmatter. This content is injected directly into the agent's context when the skill is activated.

### Write Instructions, Not Documentation

The body is read by an AI agent, not a human developer. Write it as direct instructions:

```markdown
# Good — imperative, specific, agent-directed

## When to Use This Skill
Use this skill whenever the user asks you to evaluate a mathematical expression,
perform a unit conversion, or calculate statistics.

## How to Format Results
Always show your work step by step. Use LaTeX notation for complex expressions.
When the result is approximate, state the precision explicitly.

## Examples
- "What is 15% of 847?" → Calculate and show the multiplication.
- "Convert 72°F to Celsius" → Apply the formula, show the steps.
```

```markdown
# Poor — describes the skill from the outside, doesn't instruct the agent

## Overview
This skill provides mathematical calculation capabilities including arithmetic,
unit conversion, and statistics. It was built by the platform team in 2024.

## Features
- Arithmetic operations
- Unit conversions
- Statistical functions
```

### Structure Recommendations

Use clear headings to separate distinct areas of behavior. Agents navigate headings to find relevant guidance quickly.

Recommended structure for most skills:

```markdown
---
name: my-skill
description: "One or two sentences describing what triggers this skill"
---

# My Skill

## When to Use This Skill
Describe the conditions under which the agent should apply this skill's guidance.
Be specific about the types of requests, data formats, or situations that trigger it.

## Core Instructions
The main behavioral guidance. Use numbered steps for sequential processes.
Use bullet points for parallel options or rules.

## Examples
Concrete examples showing correct behavior. Include both the input scenario
and the expected output or approach.

## Edge Cases and Constraints
Limitations, known gaps, situations where a different approach is needed.
If this skill only applies to certain conditions, state them here.
```

### Referencing Bundled Files

If your skill package includes files in `references/`, `scripts/`, or `assets/`, reference them explicitly in the body. The agent does not auto-load bundled files — it loads them on demand when the instructions reference them.

```markdown
## Style Reference
For the full code style rules, see `references/style-guide.md`.
When reviewing code, refer to that document for specific rules about
naming conventions, error handling patterns, and formatting requirements.
```

### Body Length and Context Efficiency

The full `SKILL.md` body is loaded into the agent's context window when the skill is activated. Keep the body focused. A skill that tries to cover everything becomes a cognitive burden for the agent.

| Body Length | Guidance |
|---|---|
| Under 500 words | Ideal for most skills. Fits comfortably in context. |
| 500–2000 words | Acceptable for complex domains. Consider splitting into sub-skills. |
| Over 2000 words | High risk of context pressure. Extract large sections to `references/` files and reference them by name. |

## Package Structure

A skill is a directory. The platform packages the entire directory into a ZIP artifact when you push.

```
my-skill/
├── SKILL.md              # Required — frontmatter + instructions
├── .stigmerignore        # Optional — additional exclude patterns
├── references/           # Optional — supplementary knowledge (loaded on demand)
│   ├── examples.md
│   ├── style-guide.md
│   └── api-reference.md
├── scripts/              # Optional — executable files
│   ├── setup.sh
│   └── validate.py
└── assets/               # Optional — static files
    ├── template.yaml
    └── schema.json
```

### The `references/` Directory

Use `references/` for supplementary knowledge that the agent loads on demand. This is the primary mechanism for keeping the skill's base context size small while still making detailed information available when needed.

The agent loads files from `references/` only when the `SKILL.md` body explicitly directs it to. Files in `references/` are not auto-loaded.

Good candidates for `references/`:
- Detailed examples the agent consults case-by-case
- Complete rule sets or style guides referenced by name in the body
- Domain reference material (API documentation excerpts, glossaries)

### The `scripts/` Directory

Use `scripts/` for executable files that the agent runs as tools. The runner extracts skill artifacts into `/bin/skills/<version_hash>/` in the execution sandbox. Scripts in this directory become available at that path.

Reference scripts in your `SKILL.md` body with their execution path:

```markdown
## Running the Validator
To validate a configuration file, run:
`/bin/skills/<version_hash>/scripts/validate.py <config_file>`
```

### The `assets/` Directory

Use `assets/` for static files the agent uses as templates, schemas, or configuration:
- YAML/JSON templates the agent fills in
- JSON Schema files for validation
- Configuration file examples

### File Filtering

The platform filters files when packaging the ZIP artifact. By default, it respects `.gitignore` patterns in the skill directory. Additional exclusions can be specified:

**`.stigmerignore`** — Place this file in the skill directory to define additional patterns to exclude. Uses gitignore syntax.

```
# .stigmerignore example
*.log
*.tmp
draft/**
node_modules/
__pycache__/
.DS_Store
```

**CLI flags** — Override filtering at push time without modifying `.stigmerignore`:

```bash
# Exclude additional patterns
stigmer push skill --ignore "*.log" --ignore "draft/**"

# Force-include a file that would be filtered
stigmer push skill --include ".env.example"

# Disable .gitignore-based filtering entirely
stigmer push skill --no-gitignore
```

Use `--dry-run` to preview what will be included before pushing:

```bash
stigmer push skill --dry-run
stigmer push skill --dry-run --verbose  # show per-file decisions
```

## Minimal Valid SKILL.md

The absolute minimum to satisfy the platform's validation requirements:

```markdown
---
name: my-skill
description: "Brief description of what this skill does"
---

You are operating with the my-skill capability. [Instructions for the agent here.]
```

The `name` and a non-empty body are the only hard requirements. Everything else is strongly recommended but optional.

## Related Documentation

- [README.md](README.md) — Overview and lifecycle
- [publishing-skills.md](publishing-skills.md) — How to push the skill package
- [versioning.md](versioning.md) — How versions are assigned from the artifact content
- [examples.md](examples.md) — Complete SKILL.md examples for different use cases
- [validation-checklist.md](validation-checklist.md) — Pre-push checklist
