# Uploading Skills

This guide explains how to upload skills to Stigmer using the artifact-based workflow.

## Overview

Skills in Stigmer are uploaded as **artifacts** - Zip files containing a `SKILL.md` file and any supporting tools, scripts, or executables. The CLI automatically detects skill directories and handles the upload process.

## Quick Start

### 1. Create a Skill Directory

```bash
mkdir my-calculator-skill
cd my-calculator-skill
```

### 2. Create SKILL.md

Create a `SKILL.md` file with YAML frontmatter and your skill definition:

```markdown
---
name: calculator
version: 1.0.0
description: Simple calculator for basic arithmetic
---

# Calculator Skill

A simple calculator skill for basic arithmetic operations.

## Tools

### add
Adds two numbers together.

Usage: `./calculator.sh add <num1> <num2>`

### subtract
Subtracts second number from first.

Usage: `./calculator.sh subtract <num1> <num2>`
```

**Important**: The YAML frontmatter with `name` field is **required**. The `version` and `description` fields are optional but recommended.

### 3. Add Your Tool Implementation

```bash
# Create the calculator script
cat > calculator.sh << 'EOF'
#!/bin/bash
case "$1" in
    add) echo $(($2 + $3)) ;;
    subtract) echo $(($2 - $3)) ;;
    *) echo "Unknown operation: $1" ;;
esac
EOF

chmod +x calculator.sh
```

### 4. Upload the Skill

```bash
stigmer skill push
```

That's it! The CLI will:
1. Detect the `SKILL.md` file
2. Extract the skill name from YAML frontmatter
3. Auto-detect git metadata (if in a git repository)
4. Zip the entire directory (with smart exclusions)
5. Calculate a SHA256 hash for versioning
6. Upload to your Stigmer backend with source metadata
7. Display success with version information

## How It Works

### Skill Push Process

When you run `stigmer skill push`, the CLI:

1. **Validates SKILL.md**: Checks that `SKILL.md` exists and has valid YAML frontmatter
2. **Extracts Name**: Reads the `name` field from YAML frontmatter (required)
3. **Detects Source**: Auto-detects git metadata if you're in a git repository:
   - Git remote URL (origin)
   - Current commit SHA
   - Subdirectory path (if not at repository root)
4. **Creates Artifact**: Zips the directory with smart exclusions
5. **Uploads**: Sends to Stigmer backend with source metadata
6. **Confirms**: Displays version hash and storage information

### Skill Naming

The skill name **must** be defined in the YAML frontmatter of `SKILL.md`:

```yaml
---
name: my-calculator-skill
---
```

**Requirements**:
- Must be in kebab-case (lowercase with hyphens)
- Must be unique within your organization/platform
- Cannot use directory name as fallback (name field is required)

**Examples**:
```yaml
---
name: calculator        # ✅ Good
---

---
name: json-validator    # ✅ Good
---

---
name: MySkill          # ❌ Bad (not kebab-case)
---
```

### What Gets Included

The CLI automatically zips your entire skill directory, **excluding** common files:

**Included**:
- `SKILL.md` (required)
- Tool executables and scripts
- Configuration files
- Supporting libraries
- Documentation files

**Excluded** (automatically):
- Version control: `.git/`
- Dependencies: `node_modules/`, `.venv/`, `__pycache__/`
- IDE files: `.idea/`, `.vscode/`
- Build artifacts: `*.pyc`, `*.class`, `*.so`
- Secrets: `.env`, `.env.local`
- System files: `.DS_Store`, `Thumbs.db`
- Temporary files: `*.log`, `*.swp`

### Source Metadata

Every skill push automatically captures source information for **traceability**:

**Local Push** (auto-detected):
- Git remote URL (e.g., `https://github.com/org/repo.git`)
- Commit SHA (e.g., `abc123def456...`)
- Subdirectory path (if not at repo root)
- Whether it's in a git repository

**Remote Push** (from flags):
- Git repository URL (`--git-url`)
- Git reference (`--git-ref` - tag, branch, or commit SHA)
- Subdirectory path (`--subdir`)

This metadata helps you:
- Track which git commit a skill version came from
- Debug issues by checking out the exact source code
- Audit skill changes over time
- Reproduce builds from specific commits

### Versioning and Hashing

Each skill upload is **content-addressable**:

1. **SHA256 Hash**: Calculated from the zip content
2. **Immutable**: Same content = same hash
3. **Deduplication**: Identical uploads won't duplicate storage
4. **Tag**: Defaults to `"latest"` (can be overridden with `--tag`)

## Example Workflow

### Creating and Uploading a New Skill

```bash
# 1. Create skill directory
mkdir code-formatter
cd code-formatter

# 2. Create SKILL.md
cat > SKILL.md << 'EOF'
---
name: code-formatter
version: 1.0.0
description: Formats code in various languages
---

# Code Formatter

Formats code in various languages.

## Tools

### format-python
Formats Python code using black.
Usage: `./format.sh python <file>`

### format-go
Formats Go code using gofmt.
Usage: `./format.sh go <file>`
EOF

# 3. Add implementation
cat > format.sh << 'EOF'
#!/bin/bash
case "$1" in
    python)
        black "$2"
        ;;
    go)
        gofmt -w "$2"
        ;;
esac
EOF
chmod +x format.sh

# 4. Upload
stigmer skill push
```

**Output**:
```
✓ Detected SKILL.md
✓ Skill name: code-formatter (from YAML frontmatter)
✓ Git metadata detected:
  Remote: https://github.com/myorg/skills.git
  Commit: a3f7b2e1c8d9f4a6...
  Subdir: code-formatter/
✓ Creating skill artifact...
✓ Artifact created (8.2 KB)
✓ Uploading skill artifact...
✓ Skill uploaded successfully!

Skill Details:
  Name:         code-formatter
  Version Hash: a3f7b2e1c8d9f4a6...
  Tag:          latest
  Size:         8.2 KB
  Source:       https://github.com/myorg/skills.git @ a3f7b2e1

Next steps:
  - Reference this skill in your agent code
  - Update and re-upload: edit files and run 'stigmer skill push' again
```

### Updating an Existing Skill

Simply edit your files and run `stigmer skill push` again:

```bash
# Edit your skill
vim SKILL.md
vim format.sh

# Re-upload (creates new version)
stigmer skill push
```

Each upload creates a new version with a unique hash. The `"latest"` tag points to the newest version.

## Remote Push from GitHub

You can push skills directly from a GitHub repository without cloning locally:

### Push from GitHub Repository Root

```bash
stigmer skill push \
  --git-url https://github.com/myorg/skills.git \
  --git-ref v1.0.0
```

### Push from GitHub Subdirectory

```bash
stigmer skill push \
  --git-url https://github.com/myorg/monorepo.git \
  --git-ref main \
  --subdir skills/calculator
```

**Use Cases**:
- **CI/CD pipelines**: Push skills from GitHub Actions
- **Shared repositories**: Multiple skills in one repo (monorepo pattern)
- **Version pinning**: Push specific git tags or commits
- **Quick deployment**: No need to clone entire repository

**How it works**:
1. CLI performs shallow clone (`--depth 1`) of the repository
2. Extracts specified subdirectory (if provided)
3. Validates SKILL.md and extracts name
4. Creates artifact and uploads with git source metadata
5. Cleans up temporary clone

**Example Output**:
```
✓ Cloning https://github.com/myorg/monorepo.git (ref: v1.0.0)
✓ Extracted subdirectory: skills/calculator
✓ Skill name: calculator (from YAML frontmatter)
✓ Creating skill artifact...
✓ Uploading...
✓ Skill uploaded successfully!

Source Metadata:
  URL:    https://github.com/myorg/monorepo.git
  Ref:    v1.0.0
  Subdir: skills/calculator
```

## Configuration

### Backend Mode

Skills are uploaded to your active backend. The organization is resolved from the CLI context (see `stigmer context show`), or overridden with the `--org` flag:

```bash
# Uses the active organization from context
stigmer skill push

# Override organization for this command
stigmer skill push --org acme-corp
```

### Scope

Skills are currently **organization-scoped** by default. Platform-scoped skills will be supported in a future release via a `--scope` flag.

## Troubleshooting

### Error: "SKILL.md not found"

**Cause**: No `SKILL.md` file in current directory.

**Solution**:
```bash
# Check current directory
ls SKILL.md

# Create SKILL.md with YAML frontmatter
cat > SKILL.md << 'EOF'
---
name: my-skill
---

# My Skill

Description here...
EOF
```

### Error: "Skill name is required"

**Cause**: Missing `name` field in YAML frontmatter.

**Solution**: Add YAML frontmatter to the top of `SKILL.md`:
```yaml
---
name: my-skill-name
---
```

### Error: "Invalid skill name format"

**Cause**: Skill name is not in kebab-case.

**Solution**: Use lowercase letters, numbers, and hyphens only:
```yaml
---
name: my-valid-skill-name  # ✅ Good
---

# Not valid:
# name: MySkill            # ❌ Has capitals
# name: my_skill           # ❌ Has underscores
# name: My Skill           # ❌ Has spaces
```

### Large Skills (>10MB)

For skills with large dependencies or datasets:

1. **Use exclusions**: Ensure `.gitignore` patterns are applied
2. **Optimize artifacts**: Remove unnecessary files
3. **Consider splitting**: Create multiple smaller skills

Future releases may add artifact size limits and warnings.

### Permission Errors

**Error**: "unauthorized to push skill in this organization"

**Cause**: You don't have `can_create_skill` permission in the organization.

**Solution**: Contact your organization administrator to grant permission.

## Best Practices

### 1. Keep Skills Focused

Each skill should do one thing well:
- ✅ Good: "json-validator" (validates JSON)
- ❌ Avoid: "utilities" (does everything)

### 2. Document Clearly

Your `SKILL.md` should include:
- Skill purpose
- Tool names and descriptions
- Usage examples
- Input/output formats
- Error conditions

### 3. Use Executable Scripts

Make your tools executable:
```bash
chmod +x tool.sh
```

### 4. Test Locally First

Test your skill tools before uploading:
```bash
./calculator.sh add 5 3
# Should output: 8
```

### 5. Version Control

Track your skills in Git:
```bash
git init
git add .
git commit -m "Initial skill implementation"
```

### 6. Use .gitignore

Create a `.gitignore` to exclude development files:
```
__pycache__/
*.pyc
.venv/
node_modules/
.env
```

## What's Next?

After uploading your skill:

1. **Reference in Agents**: Attach skills to your agents
2. **Test Execution**: Verify skills work in agent context
3. **Monitor Usage**: Track skill invocations (future feature)
4. **Update as Needed**: Re-upload when you improve tools

## Advanced Topics

### Content-Addressable Storage

Skills use **content-addressable storage** with SHA256 hashing:

**Benefits**:
- **Deduplication**: Same content = single storage copy
- **Integrity**: Hash verifies content hasn't been corrupted
- **Immutability**: Hash changes if content changes
- **Caching**: Can cache by hash forever

**Example**:
```bash
# Upload 1: Content "v1" → Hash "abc123..." → Stored
# Upload 2: Content "v1" (identical) → Hash "abc123..." → Skipped!
# Upload 3: Content "v2" → Hash "def456..." → Stored
```

### Skill Versioning

Each skill upload creates a version:

- **Version Hash**: SHA256 of zip content (immutable identifier)
- **Tag**: Human-readable label (e.g., "latest", "v1.0", "stable")
- **Resolution**: Agents can reference by tag or exact hash

```yaml
# Reference by tag (mutable, tracks updates)
agent:
  skills:
    - name: calculator
      tag: latest

# Reference by hash (immutable, never changes)
agent:
  skills:
    - name: calculator
      hash: abc123def456...
```

## Related Documentation

- [Agent Configuration](../getting-started/agent-configuration.md) - How to attach skills to agents
- [SKILL.md Format](../reference/skill-md-format.md) - Complete SKILL.md specification
- [CLI Commands](../reference/cli-commands.md) - Full CLI reference

## See Also

- [Architecture: Skill Artifact Model](../architecture/skill-artifact-model.md) - How skills work under the hood
- [Getting Started: Local Mode](../getting-started/local-mode.md) - Setting up local development
- [Guides: Creating Custom Skills](creating-custom-skills.md) - Advanced skill authoring

---

**Note**: This is part of the Skill API Enhancement (T01) which introduces artifact-based skill management. The previous code-based skill definition approach has been deprecated.
