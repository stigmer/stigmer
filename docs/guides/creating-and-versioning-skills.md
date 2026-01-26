# Creating and Versioning Skills

## Overview

Skills are reusable packages of agent capabilities that can be attached to agents. This guide covers creating skills, uploading them, and managing versions.

## Prerequisites

- Stigmer CLI installed (`stigmer --version`)
- Authenticated (`stigmer auth login`)
- Organization context set (for org-scoped skills)

## Skill Structure

A skill is a directory containing:

```
my-skill/
├── SKILL.md          # Required: Interface definition
├── tools/            # Optional: Executables
│   ├── calculator
│   └── formatter
├── scripts/          # Optional: Scripts
│   └── validate.sh
└── README.md         # Optional: Additional docs
```

### SKILL.md Format

The `SKILL.md` file defines your skill's interface and is injected into agent prompts.

**REQUIRED**: YAML frontmatter with `name` field at the top:

```markdown
---
name: calculator
version: 1.0.0
description: Mathematical calculation capabilities
---

# Calculator Skill

## Description

Provides mathematical calculation capabilities for agents.

## Tools

### calculator

Performs arithmetic operations.

**Usage**:
```bash
calculator add 5 3
calculator multiply 10 2
```

**Arguments**:
- Operation: add, subtract, multiply, divide
- Numbers: Two numeric values

**Returns**: Calculated result

## Examples

Calculate order totals:
```bash
calculator multiply $ITEM_PRICE $QUANTITY
```

## Notes

- Division by zero returns error
- Supports decimal numbers
- Maximum precision: 10 decimal places
```

**YAML Frontmatter Fields**:
- `name` (required): Skill name in kebab-case
- `version` (optional): Skill version (e.g., "1.0.0")
- `description` (optional): Brief description

**Best Practices**:
- Always include YAML frontmatter with `name` field
- Use kebab-case for skill names (lowercase-with-hyphens)
- Clear tool descriptions
- Usage examples
- Expected inputs/outputs
- Error conditions
- Limitations

## Creating a Skill

### Step 1: Create Directory Structure

```bash
mkdir my-skill
cd my-skill
```

### Step 2: Write SKILL.md

Create `SKILL.md` with YAML frontmatter and interface definition:

```markdown
---
name: my-skill
version: 1.0.0
---

# My Skill

Description and tool documentation here...
```

**Important**: The `name` field in YAML frontmatter is **required**.

### Step 3: Add Tools (Optional)

```bash
mkdir tools
# Add executables to tools/
chmod +x tools/*
```

### Step 4: Test Locally

Test your tools work correctly:

```bash
./tools/my-tool arg1 arg2
```

## Uploading Skills

### First Upload (Create)

```bash
cd my-skill/

# Upload skill
stigmer skill push
```

**What happens**:
1. CLI detects `SKILL.md` in current directory
2. Extracts skill name from YAML frontmatter (required)
3. Auto-detects git metadata (if in git repository)
4. Creates Zip artifact of entire directory
5. Uploads to Stigmer with source metadata
6. Returns version hash

**Output**:
```
✓ Detected SKILL.md
✓ Skill name: calculator (from YAML frontmatter)
✓ Git metadata detected:
  Remote: https://github.com/myorg/skills.git
  Commit: abc123def456...
✓ Creating skill artifact...
✓ Uploading to Stigmer...
✓ Skill uploaded successfully!
  Version Hash: abc123def456...
  Tag: latest
  Source: https://github.com/myorg/skills.git @ abc123def
```

### Updating a Skill

```bash
# Make changes to SKILL.md or tools
vim SKILL.md

# Upload new version
stigmer skill push
```

**What happens**:
1. CLI validates SKILL.md and extracts name
2. Auto-detects new git commit (if changed)
3. Creates new artifact version
4. Uploads with updated source metadata
5. Updates tag pointer (if specified)

**Output**:
```
✓ Detected SKILL.md
✓ Skill name: calculator (from YAML frontmatter)
✓ Git metadata detected:
  Remote: https://github.com/myorg/skills.git
  Commit: xyz789abc123...  (updated)
✓ Creating skill artifact...
✓ Uploading to Stigmer...
✓ Skill updated: calculator
  Version Hash: xyz789abc123...
  Tag: latest (updated)
  Source: https://github.com/myorg/skills.git @ xyz789abc
```

### Pushing from Remote GitHub

You can push skills directly from a GitHub repository:

```bash
# Push from repository root
stigmer skill push \
  --git-url https://github.com/myorg/skills.git \
  --git-ref v1.0.0

# Push from subdirectory
stigmer skill push \
  --git-url https://github.com/myorg/monorepo.git \
  --git-ref main \
  --subdir skills/calculator
```

**Use cases**:
- CI/CD pipelines (GitHub Actions, etc.)
- Monorepo with multiple skills
- Push specific git tags or commits
- No need to clone locally

## Version Management

### Tags

Tags are mutable pointers to skill versions:

**Common tag patterns**:
- `latest` - Most recent version (default)
- `stable` - Production-ready version
- `v1.0`, `v2.0` - Major version markers
- `beta`, `alpha` - Pre-release versions

**Using tags**:
```bash
# Upload with tag
stigmer skill push --tag stable

# Upload with default "latest" tag
stigmer skill push
```

### Version Hashes

Every skill version has an immutable SHA256 hash:

**Viewing versions**:
```bash
stigmer skill versions calculator
```

**Output**:
```
Skill: calculator

Current (main):
  Hash: abc123def456...
  Tag: stable
  Updated: 2026-01-25 14:30:00

History (audit):
  Hash: xyz789abc123...
  Tag: stable
  Updated: 2026-01-24 10:15:00
  
  Hash: def456789abc...
  Tag: beta
  Updated: 2026-01-23 16:45:00
```

### Referencing Skill Versions

#### In Agent YAML

**Latest version** (mutable, auto-updates):
```yaml
skills:
  - scope: organization
    org: my-org
    slug: calculator
    # No version specified → uses latest
```

**Specific tag** (semi-mutable, manually updated):
```yaml
skills:
  - scope: organization
    org: my-org
    slug: calculator
    version: stable  # Uses whatever "stable" points to
```

**Exact hash** (immutable, never changes):
```yaml
skills:
  - scope: organization
    org: my-org
    slug: calculator
    version: abc123def456...  # Exact version, never changes
```

## CLI Commands

### List Skills

```bash
stigmer skill list
```

**Output**:
```
NAME          SCOPE     ORG       TAG      VERSION        UPDATED
calculator    org       my-org    stable   abc123def...   2026-01-25 14:30
formatter     platform  -         latest   xyz789abc...   2026-01-24 10:15
validator     org       my-org    v1.0     def456789...   2026-01-23 16:45
```

### Get Skill Details

```bash
stigmer skill get calculator
```

**Output**:
```yaml
api_version: agentic.stigmer.ai/v1
kind: Skill
metadata:
  id: skl-abc123
  slug: calculator
  owner_scope: organization
  org: my-org
  created_at: 2026-01-20T10:00:00Z
  updated_at: 2026-01-25T14:30:00Z
spec:
  skill_md: |
    # Calculator Skill
    ...
  tag: stable
status:
  version_hash: abc123def456...
  artifact_storage_key: skills/calculator_abc123def456.zip
  state: READY
```

### List Versions

```bash
stigmer skill versions calculator
```

### Delete Skill

```bash
stigmer skill delete calculator
```

**Warning**: This deletes the skill from the main collection but preserves audit history.

## Best Practices

### Versioning Strategy

**For Development**:
- Use `latest` tag (default)
- Iterate quickly without version constraints
- Easy to test changes

**For Staging**:
- Use `beta` or `staging` tag
- Test before promoting to production
- Separate from development churn

**For Production**:
- Use semantic version tags (`v1.0`, `v2.0`)
- Or use exact hashes for critical deployments
- Guarantees stability

### Skill Naming

**Good names**:
- `calculator` - Clear, concise
- `json-formatter` - Descriptive, hyphenated
- `aws-cli` - Technology-specific

**Avoid**:
- `utils` - Too generic
- `MyAwesomeSkill` - Use lowercase with hyphens
- `skill1`, `test` - Not descriptive

### SKILL.md Content

**Include**:
- Clear description
- Tool usage examples
- Input/output specifications
- Error handling
- Limitations

**Avoid**:
- Implementation details (users don't need to know)
- Overly verbose documentation (keep it concise)
- Outdated examples (update with tools)

### Tool Design

**Principles**:
- **Single Responsibility**: Each tool does one thing well
- **Clear Interface**: Simple arguments, predictable output
- **Error Handling**: Return meaningful error messages
- **Idempotent**: Same input → same output
- **Fast**: Agents wait for tool execution

### Testing Skills

**Before uploading**:
1. Test tools manually: `./tools/my-tool arg1`
2. Verify SKILL.md is clear and accurate
3. Check file permissions (executables are `chmod +x`)
4. Test with minimal agent config

**After uploading**:
1. Create test agent with skill attached
2. Run agent execution with skill-using prompts
3. Verify tools execute correctly
4. Check logs for errors

## Common Patterns

### Skill with Scripts

```
my-skill/
├── SKILL.md
└── scripts/
    ├── process.sh
    └── validate.sh
```

**SKILL.md**:
```markdown
### process

**Usage**: `./scripts/process.sh input.txt`
```

### Skill with Multiple Tools

```
my-skill/
├── SKILL.md
└── tools/
    ├── format
    ├── validate
    └── convert
```

**SKILL.md**: Document each tool separately

### Platform vs Organization Skills

**Platform Skills** (all orgs):
```bash
# Set platform scope
export STIGMER_SCOPE=platform
stigmer apply
```

**Organization Skills** (specific org):
```bash
# Set org scope (default)
export STIGMER_ORG=my-org
stigmer apply
```

## Troubleshooting

### Skill Upload Fails

**Error**: `Error: SKILL.md not found`
- **Solution**: Ensure `SKILL.md` exists in current directory
- **Check**: `ls -la SKILL.md`

**Error**: `Error: skill name required`
- **Solution**: Add YAML frontmatter with `name` field to `SKILL.md`:
  ```yaml
  ---
  name: my-skill-name
  ---
  ```

**Error**: `Error: invalid skill name format`
- **Solution**: Use kebab-case (lowercase with hyphens):
  ```yaml
  ---
  name: my-skill-name  # ✅ Good
  ---
  # Not valid:
  # name: MySkill      # ❌ Has capitals
  # name: my_skill     # ❌ Has underscores
  ```

**Error**: `Error: artifact too large`
- **Solution**: Reduce artifact size (< 100MB recommended)
- **Check**: Large binaries? Consider external downloads

### Version Resolution Issues

**Issue**: Agent uses wrong version
- **Check**: Agent YAML `version` field
- **Verify**: `stigmer skill get <name>` shows expected version
- **Solution**: Use exact hash for production

**Issue**: Tag doesn't update
- **Cause**: Tag pointer not moved
- **Solution**: Ensure push operation specifies tag

### Tool Execution Fails

**Issue**: `Permission denied` in agent
- **Cause**: Tool not executable
- **Solution**: `chmod +x tools/*` before uploading

**Issue**: `Tool not found` in agent
- **Cause**: Tool path incorrect in SKILL.md
- **Solution**: Use relative paths from skill root

## Examples

See complete skill examples:
- [Calculator Skill](../../examples/skills/calculator/) - Basic arithmetic
- [AWS CLI Skill](../../examples/skills/aws-cli/) - Cloud operations
- [Git Skill](../../examples/skills/git/) - Version control

## References

- [Skill Versioning Architecture](../architecture/skill-versioning.md) - How versioning works
- [CLI Reference: stigmer apply](../cli/stigmer-apply.md) - Upload command details
- [Agent Configuration](../guides/agent-configuration.md) - Attaching skills to agents
- [SKILL.md Format Specification](../reference/skill-md-format.md) - Complete format details

---

**Last Updated**: 2026-01-25  
**Status**: Available in v0.x
