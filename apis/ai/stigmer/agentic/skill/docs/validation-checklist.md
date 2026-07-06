# Validation Checklist and Common Pitfalls

Pre-push checklist and known pitfalls when authoring and publishing skills.

## Pre-Push Checklist

Run through this list before pushing a skill with `stigmer push skill`.

### SKILL.md File

- [ ] `SKILL.md` exists at the root of the skill directory (not in a subdirectory)
- [ ] `SKILL.md` starts with `---` on the very first line (no blank lines before the opening delimiter)
- [ ] The frontmatter is closed with a second `---` on its own line
- [ ] The `name` field is present and non-empty in the frontmatter
- [ ] The `name` field is kebab-case: lowercase letters (`a-z`), numbers (`0-9`), and hyphens (`-`), optionally scoped with dots (`.`) for namespaces (e.g. `platform.planton-architecture`); every segment is alphanumeric (no leading/trailing/consecutive separators); no underscores, spaces, or uppercase letters
- [ ] The `description` field is present and is a clear 1–2 sentence summary of *when to use* this skill (strongly recommended, not enforced)
- [ ] The `SKILL.md` body is non-empty and contains agent-directed instructions, not developer documentation

### Organization and Visibility

- [ ] The target organization is correct — either your CLI's configured org, or explicitly provided via `--org`
- [ ] In cloud mode: the org exists and you are a member
- [ ] In local mode: `local` is the correct org if pushing for use with local agents

### Versioning and Tags

- [ ] The `--tag` value is correct — remember that `latest` is the default; if you want `stable`, you must specify `--tag stable` explicitly
- [ ] You are not overwriting a `stable` or production tag unintentionally — check existing tags with `stigmer get skill <slug> --output yaml` before pushing
- [ ] If this skill is already referenced in production agents, confirm whether moving the tag is intentional

### Artifact Contents

- [ ] Run `stigmer push skill --dry-run` at least once to verify the expected files are included
- [ ] Secrets, credentials, and `.env` files are absent from the directory (or excluded via `.stigmerignore` or `--ignore`)
- [ ] Large binary files or generated outputs that don't belong in the artifact are excluded
- [ ] All files referenced by name in `SKILL.md` (e.g., `references/style-guide.md`) exist in the package

## Common Pitfalls

### Frontmatter Not at the Start of the File

The platform rejects `SKILL.md` files where the frontmatter does not begin on the first line.

```markdown
<!-- Wrong — blank line before the opening --- -->

---
name: my-skill
---

# My Skill
```

```markdown
<!-- Correct — --- is the very first character of the file -->
---
name: my-skill
---

# My Skill
```

### `name` Field Missing from Frontmatter

The `name` field is the only required frontmatter field. Omitting it causes the push to fail with a validation error.

```markdown
<!-- Wrong — name is absent -->
---
description: "A useful skill"
---
```

```markdown
<!-- Correct -->
---
name: my-skill
description: "A useful skill"
---
```

### Invalid `name` Format

The `name` must match `^[a-z0-9]+([.-][a-z0-9]+)*$` — kebab-case, optionally
scoped with dot-separated namespaces. The most common violations:

```yaml
# Wrong — uppercase letters
name: MySkill
name: Web-Scraper

# Wrong — camelCase
name: webScraper

# Wrong — underscores (use hyphens)
name: web_scraper
name: my_new_skill

# Wrong — starts with a separator
name: -my-skill
name: .platform

# Wrong — ends with a separator
name: my-skill-
name: platform.

# Wrong — consecutive separators
name: platform..architecture

# Wrong — contains a space
name: my skill

# Correct
name: my-skill
name: webscraper
name: web-scraper-v2
name: pdf2text

# Correct — dot-separated namespace (slug becomes platform-planton-architecture)
name: platform.planton-architecture
name: org.acme.custom-runbook
```

### Frontmatter Not Closed

The platform parser requires a closing `---` on its own line. A frontmatter block without a closing delimiter is rejected.

```markdown
<!-- Wrong — no closing --- -->
---
name: my-skill
description: "A skill"

# My Skill
```

```markdown
<!-- Correct -->
---
name: my-skill
description: "A skill"
---

# My Skill
```

### Writing Body as Developer Documentation Instead of Agent Instructions

The `SKILL.md` body is injected into an agent's context and read by the AI, not by a human developer. Documentation-style prose does not guide agent behavior effectively.

```markdown
<!-- Wrong — describes the skill from the outside -->
## Overview
This skill was created by the platform team to assist with code reviews.
It uses pattern matching and static analysis heuristics to detect common issues.

## Features
- Checks for security vulnerabilities
- Enforces style guidelines
```

```markdown
<!-- Correct — directs the agent -->
## When to Use This Skill
Use this skill for every code review request, regardless of programming language.

## How to Review
1. Check for security vulnerabilities first: SQL injection, exposed secrets, unvalidated input.
2. Apply the style rules for the detected language.
3. Report issues in order of severity: critical → major → minor.
```

### Assuming `latest` Points to a Known Version

The `latest` tag is moved by every push that does not specify an explicit `--tag`. In a team environment or CI/CD pipeline, multiple pushes may move `latest` unexpectedly.

```bash
# Developer A pushes (moves "latest" to H1)
stigmer push skill ./skills/calculator

# Developer B pushes an hour later (moves "latest" to H2)
stigmer push skill ./skills/calculator

# Agents referencing version: latest now load H2, not H1
```

For coordination and stability, use named tags (`stable`, `v1.0`, etc.) promoted by an intentional process, or pin to a specific hash.

### Expecting an Error on Duplicate Content Pushes

Pushing the same content twice does not produce an error. The platform deduplicates by hash — the second push is treated as a tag pointer update. If you expect an error to detect "nothing changed," you will not get one.

```bash
# First push — creates hash H1, tags "latest" → H1
stigmer push skill ./calculator

# Second push with no changes — hash H1 again
# No error. Platform moves "latest" → H1 (already there). Success.
stigmer push skill ./calculator
```

### Trusting Stale Tags in Agent References

When you reference a skill with a tag name (e.g., `version: stable`) in an agent, the platform resolves that tag *at runtime*, not at agent-authoring time. If someone moves the `stable` tag to a new version after you wrote the agent YAML, your agent will load the new version on the next run.

To guarantee that an agent always loads the same skill content, pin to a hash:

```yaml
# Risky — resolves to whatever "stable" currently points to
skill_refs:
  - org: acme-corp
    kind: skill
    slug: deployment-procedures
    version: stable

# Safe — resolves to exactly this content, always
skill_refs:
  - org: acme-corp
    kind: skill
    slug: deployment-procedures
    version: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456"
```

### Referencing Files Not in the Package

If your `SKILL.md` body says "see `references/examples.md`" but that file was excluded from the artifact (by `.gitignore`, `.stigmerignore`, or `--ignore`), the agent will fail to load it at runtime.

Verify all referenced files are included with `--dry-run`:

```bash
stigmer push skill --dry-run --verbose
# Check that all referenced files appear in the "included" list
```

### Pushing to the Wrong Organization

The organization cannot be changed after a skill is pushed. The org is part of the skill's identity — `local/calculator` and `acme-corp/calculator` are different resources.

Verify the org before pushing in cloud mode:

```bash
# Check what org the CLI will use by default
stigmer get skill some-slug --output yaml  # look at metadata.org

# Override explicitly
stigmer push skill --org acme-corp
```

### `name` Collision with an Existing Skill in the Org

If you push a skill directory whose `SKILL.md` has a `name` that does not match the slug of any existing skill in the org, the platform creates a new skill resource. If a skill with that name already exists under a different ID due to a naming conflict, the push will fail.

Verify before pushing:

```bash
stigmer get skill <expected-slug>
# If it returns a different skill than expected, there is a naming conflict
```

### Tag Syntax Error

Tags must match `^$|^[a-zA-Z0-9._-]+$`. Spaces and slashes are not allowed.

```bash
# Wrong — space in tag
stigmer push skill --tag "my stable"

# Wrong — slash (no git-style refs)
stigmer push skill --tag feature/new-behavior

# Correct
stigmer push skill --tag stable
stigmer push skill --tag v1.0.0
stigmer push skill --tag 2024-01
```
