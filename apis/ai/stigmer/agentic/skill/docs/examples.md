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
skills/variance-report/
├── SKILL.md
└── references/
    ├── report-layout.md
    ├── materiality-checklist.md
    └── examples.md
```

**`SKILL.md`:**
```markdown
---
name: variance-report
description: "Turns a ledger into a variance report: each account's actual against its budget, with the variances that matter explained"
---

# Variance Report Skill

## When to Use This Skill
Use this skill when the user asks for a variance report, a budget-to-actual comparison,
or an explanation of why an account moved. Applies to any period and any chart of accounts.

## Report Process
Follow these steps for every variance report:
1. **Mapping**: Map each ledger line to the customer's chart of accounts. Are any lines unmapped?
2. **Materiality**: Refer to `references/materiality-checklist.md` for which variances to explain.
3. **Layout**: Apply the layout in `references/report-layout.md` for the report's sections and columns.
4. **Explanation**: Is each material variance explained by the entries behind it?

## Output Format
Structure your report as:
- **Summary**: One paragraph on the period overall
- **Material Variances** (must be explained): Numbered list
- **Watch List** (worth a look next period): Numbered list
- **On Budget**: Accounts within tolerance

For worked examples of well-structured reports, see `references/examples.md`.

## Severity Levels
- **Critical**: Variance over 10% of budget, or an entry posted to the wrong account
- **Major**: Variance over 5% of budget
- **Minor**: Variance within tolerance but trending away from budget
```

**`references/materiality-checklist.md`:**
```markdown
# Materiality Checklist

## Thresholds
- [ ] Every account over 5% of budget is explained
- [ ] Every account over a fixed amount the customer sets is explained
- [ ] Revenue and cost accounts are checked separately

## Entries
- [ ] Each explanation names the entries behind it
- [ ] One-off entries are told apart from recurring ones
- [ ] Reversals and accruals are matched to their originals

## Presentation
- [ ] Amounts use the ledger's currency and rounding
- [ ] Favourable and unfavourable variances are labelled
- [ ] Unmapped ledger lines are listed, not dropped
```

**Push:**
```bash
stigmer push skill ./skills/variance-report --tag stable
```

The platform packages `SKILL.md` and the entire `references/` directory into the artifact ZIP. The agent loads `references/materiality-checklist.md` on demand when the `SKILL.md` body directs it to.

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

## Cloud Mode: A Skill Shared With Child Organizations

A skill pushed to a parent organization and shared with every one of its child organizations.

```bash
# Push to a named org (cloud mode)
stigmer push skill ./skills/web-scraper --org acme-cloud --tag stable
```

Declare `visibility: child-orgs` in the SKILL.md frontmatter, or apply the level after the push. By default a skill is `visibility_org`, readable by its own organization only.

**Reference in an Agent from a child organization:**
```yaml
# An agent in acme-cloud referencing its own skill
skill_refs:
  - org: acme-cloud
    kind: skill
    slug: web-scraper
    version: stable

# An agent in a child organization of acme-cloud, referencing the shared skill
skill_refs:
  - org: acme-cloud
    kind: skill
    slug: web-scraper
    version: stable
```

A cross-organization reference is accepted only toward a skill the writing organization's parent shares with its children; any other is refused at write. Write access (pushing new versions) always requires membership of the owning organization. Any other organization uses the skill by installing the plugin that carries it.

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
