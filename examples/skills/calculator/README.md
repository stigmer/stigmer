# Calculator Skill Example

This is a sample skill demonstrating the proper structure and YAML frontmatter format.

## Structure

```
calculator/
├── SKILL.md          # Skill interface (required, with YAML frontmatter)
├── calculator.sh     # Tool implementation
└── README.md         # This file (optional)
```

## YAML Frontmatter

The `SKILL.md` file **must** include YAML frontmatter at the top:

```yaml
---
name: calculator
version: 1.0.0
description: Performs basic arithmetic operations
---
```

**Required fields**:
- `name` - Skill name in kebab-case (lowercase with hyphens)

**Optional fields**:
- `version` - Semantic version (e.g., "1.0.0")
- `description` - Brief description

## Testing Locally

Before pushing, test the tool:

```bash
# Make executable
chmod +x calculator.sh

# Test operations
./calculator.sh add 5 3        # Should output: 8
./calculator.sh subtract 10 3  # Should output: 7
./calculator.sh multiply 4 5   # Should output: 20
./calculator.sh divide 15 3    # Should output: 5

# Test error handling
./calculator.sh divide 10 0    # Should error: Division by zero
./calculator.sh invalid 1 2    # Should error: Unknown operation
```

## Pushing the Skill

### Local Push (Auto-detects Git)

```bash
cd examples/skills/calculator/
stigmer skill push
```

The CLI will:
1. Read `name: calculator` from YAML frontmatter
2. Auto-detect git metadata (remote URL, commit SHA, subdirectory)
3. Create artifact and upload

### Remote Push from GitHub

```bash
stigmer skill push \
  --git-url https://github.com/stigmer/stigmer.git \
  --git-ref main \
  --subdir examples/skills/calculator
```

### Push with Specific Tag

```bash
stigmer skill push --tag stable
```

## Source Metadata

Every push automatically captures source information:

**Local push**:
- Git remote URL: `https://github.com/stigmer/stigmer.git`
- Commit SHA: `abc123def456...`
- Subdirectory: `examples/skills/calculator/`

**Remote push**:
- Git URL: `https://github.com/stigmer/stigmer.git`
- Git ref: `main` (or tag/commit)
- Subdirectory: `examples/skills/calculator`

This metadata helps you track which version of the code a skill came from.

## Using in Agents

Reference this skill in your agent configuration:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: math-helper
spec:
  skills:
    - scope: organization
      org: my-org
      slug: calculator
      tag: latest  # or specific version hash
```

## Related Documentation

- [Uploading Skills Guide](../../../docs/guides/uploading-skills.md)
- [Creating and Versioning Skills](../../../docs/guides/creating-and-versioning-skills.md)
- [CLI Commands Reference](../../../client-apps/cli/COMMANDS.md)
