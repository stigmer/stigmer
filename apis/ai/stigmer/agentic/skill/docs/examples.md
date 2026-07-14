# Skill Examples

Complete, working examples from minimal to full-featured. All `SKILL.md` files shown can be used directly.

## Minimal Skill

The simplest possible skill — a single `SKILL.md` file with required frontmatter.

**Directory:**
```
skills/greeting/
└── SKILL.md
```

**`SKILL.md`:**
```markdown
---
name: greeting
description: "Generates polite, context-appropriate greetings in multiple languages and tones"
---

# Greeting Skill

## When to Use This Skill
Use this skill when the user asks you to greet someone, start a conversation, or generate
an introduction. This applies regardless of target language or formality level.

## Greeting Guidelines
- Match the formality of the request: a business email needs a formal greeting; a chat message needs a casual one.
- When a language is specified, produce the greeting in that language.
- When no language is specified, use English.
- Include the recipient's name if provided.

## Examples
- "Greet my colleague Ana in Spanish" → "¡Hola Ana! ¿Cómo estás?"
- "Write a formal email opening for a CEO" → "Dear [Name], I hope this message finds you well."
- "Say hi in Japanese" → "こんにちは！"
```

**Push:**
```bash
stigmer push skill ./skills/greeting
# Tags with "latest" by default
```

**Reference in an Agent:**
```yaml
skill_refs:
  - kind: skill
    slug: greeting
```

---

## Skill with a Pinned Tag

A skill pushed with an explicit tag for production stability.

**`SKILL.md`:**
```markdown
---
name: json-formatter
description: "Formats, validates, and transforms JSON data — pretty-printing, minifying, and extracting nested values"
version: "1.2.0"
---

# JSON Formatter Skill

## When to Use This Skill
Use this skill whenever the user asks you to:
- Format or pretty-print JSON
- Minify JSON for production use
- Validate that a JSON string is syntactically correct
- Extract a value from a nested JSON path

## Formatting Rules
- Use 2-space indentation for pretty-printing unless the user specifies otherwise.
- When minifying, remove all whitespace including newlines.
- Preserve original key ordering.

## JSON Path Extraction
Use dot notation to extract nested values: `data.user.email`
Use array indexing with brackets: `items[0].name`

## Validation Output
When validating JSON, report:
1. Whether the input is valid
2. If invalid: the line and column of the first error
3. A corrected version if the fix is unambiguous
```

**Push with a stable tag:**
```bash
cd ./skills/json-formatter
stigmer push skill --tag stable

# Also move "latest" in the same push cycle
stigmer push skill
# (same content → same hash, just moves "latest")
```

**Reference in an Agent (pinned to stable):**
```yaml
skill_refs:
  - org: acme-corp
    kind: skill
    slug: json-formatter
    version: stable
```

---

## Multi-File Skill with References

A skill with a `SKILL.md` that delegates detail to files in `references/`.

**Directory:**
```
skills/code-review/
├── SKILL.md
└── references/
    ├── style-rules.md
    ├── security-checklist.md
    └── examples.md
```

**`SKILL.md`:**
```markdown
---
name: code-review
description: "Reviews source code for correctness, style, security vulnerabilities, and maintainability"
---

# Code Review Skill

## When to Use This Skill
Use this skill when the user asks you to review code, identify bugs, check security issues,
or evaluate code quality. Applies to all programming languages.

## Review Process
Follow these steps for every code review:
1. **Correctness**: Does the code do what it claims to do? Are there logical errors?
2. **Security**: Refer to `references/security-checklist.md` for the full security review checklist.
3. **Style**: Apply the rules in `references/style-rules.md` for the language in question.
4. **Maintainability**: Is the code readable? Are abstractions appropriate? Is complexity justified?

## Output Format
Structure your review as:
- **Summary**: One paragraph overall assessment
- **Critical Issues** (must fix before merge): Numbered list
- **Suggestions** (should consider): Numbered list
- **Positive Observations**: What is done well

For worked examples of well-structured reviews, see `references/examples.md`.

## Severity Levels
- **Critical**: Security vulnerability, data loss risk, or broken functionality
- **Major**: Logic error or significant performance issue
- **Minor**: Style, naming, or documentation issue
```

**`references/security-checklist.md`:**
```markdown
# Security Review Checklist

## Input Validation
- [ ] All external inputs are validated before use
- [ ] SQL queries use parameterized statements (no string concatenation)
- [ ] File paths are sanitized to prevent directory traversal

## Authentication and Authorization
- [ ] Authentication is required for all sensitive endpoints
- [ ] Authorization checks occur server-side, not client-side only
- [ ] Tokens and secrets are not logged or included in error messages

## Secrets and Configuration
- [ ] No hardcoded secrets, passwords, or API keys in source
- [ ] Environment variables are used for sensitive configuration
- [ ] .gitignore excludes .env and credential files
```

**Push:**
```bash
stigmer push skill ./skills/code-review --tag stable
```

The platform packages `SKILL.md` and the entire `references/` directory into the artifact ZIP. The agent loads `references/security-checklist.md` on demand when the `SKILL.md` body directs it to.

---

## Skill from a Remote Git Repository

Push a skill sourced from a GitHub repository without cloning it locally first.

```bash
# Skill at the root of the repository
stigmer push skill \
  --git-url https://github.com/stigmer/platform-skills.git \
  --git-ref v2.0.0 \
  --tag stable

# Skill in a subdirectory of a monorepo
stigmer push skill \
  --git-url https://github.com/acme-corp/skills.git \
  --git-ref main \
  --subdir skills/web-scraper \
  --tag latest
```

The CLI:
1. Shallow-clones the repository at the specified ref
2. Navigates to `--subdir` (or repo root if not specified)
3. Packages the directory into a ZIP
4. Records the exact commit SHA in `GitProvenance` for reproducibility
5. Pushes to the platform

The resulting skill's `status.git_provenance` will show:
```yaml
git_provenance:
  remote_url: "https://github.com/acme-corp/skills.git"
  ref: "main"
  commit: "abc123def456789012345678901234567890abcd"  # resolved SHA
  subdir: "skills/web-scraper"
```

---

## SDK-Authored Skill (Go SDK)

Declare skills as code in a Stigmer Go project.

**Project structure:**
```
my-stigmer-project/
├── main.go
├── skills/
│   ├── pdf-extractor/
│   │   └── SKILL.md
│   └── data-transformer/
│       ├── SKILL.md
│       └── references/
│           └── format-spec.md
└── go.mod
```

**`main.go`:**
```go
package main

import (
    stigmer "github.com/stigmer/stigmer/sdk/go/v3"
    "github.com/stigmer/stigmer/sdk/go/v3/skill"
)

func main() {
    stigmer.Run(func(ctx *stigmer.Context) error {
        // Local skill — auto-detects git provenance
        _, err := skill.FromDir(ctx, "./skills/pdf-extractor",
            skill.WithTag("stable"))
        if err != nil {
            return err
        }

        // Local skill — no tag (uses "latest")
        _, err = skill.FromDir(ctx, "./skills/data-transformer")
        if err != nil {
            return err
        }

        // Remote skill from a shared repository
        _, err = skill.FromGit(ctx, "https://github.com/acme-corp/shared-skills.git",
            skill.WithRef("v1.5.0"),
            skill.WithSubdir("formatting"),
            skill.WithGitTag("stable"))
        if err != nil {
            return err
        }

        return nil
    })
}
```

When the CLI processes this project:
- `pdf-extractor` is packaged from `./skills/pdf-extractor` and pushed with `--tag stable`
- `data-transformer` is packaged from `./skills/data-transformer` and pushed with `--tag latest`
- The shared formatting skill is cloned from the remote repository at `v1.5.0` and pushed with `--tag stable`

---

## Cloud Mode: Public Skill

A skill pushed to a named organization with public visibility for marketplace publishing.

```bash
# Push to a named org (cloud mode)
stigmer push skill ./skills/web-scraper --org acme-corp --tag stable
```

After pushing, update visibility via the API to make it public for marketplace listing. By default, all skills are `visibility_private`.

**Reference in an Agent from a different org:**
```yaml
# An agent in acme-corp referencing their own skill
skill_refs:
  - org: acme-corp
    kind: skill
    slug: web-scraper
    version: stable

# An agent in another org referencing acme-corp's public skill
skill_refs:
  - org: acme-corp
    kind: skill
    slug: web-scraper
    version: stable
```

Public skills are readable by anyone. Write access (pushing new versions) always requires org membership.

---

## Iterative Development Workflow

A typical development cycle for a skill:

```bash
# 1. Create the skill directory
mkdir -p skills/my-skill
cat > skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: "Draft skill under development"
---

# My Skill

Initial draft.
EOF

# 2. Validate the artifact before pushing (check what files are included)
stigmer push skill ./skills/my-skill --dry-run

# 3. Push for development testing (tags "latest")
stigmer push skill ./skills/my-skill

# 4. Reference in a dev agent YAML to test behavior
# skill_refs:
#   - kind: skill
#     slug: my-skill

# 5. Iterate — edit SKILL.md, re-push
stigmer push skill ./skills/my-skill

# 6. When satisfied, push with a stable tag for production agents
stigmer push skill ./skills/my-skill --tag stable

# 7. Pin the production agent to the specific hash for reproducibility
stigmer get skill my-skill --output yaml
# → copy status.version_hash
# → set version: <hash> in agent YAML
```
