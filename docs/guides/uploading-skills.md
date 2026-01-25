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

Create a `SKILL.md` file with your skill definition:

```markdown
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
stigmer apply
```

That's it! The CLI will:
1. Detect the `SKILL.md` file
2. Zip the entire directory (with smart exclusions)
3. Calculate a SHA256 hash for versioning
4. Upload to your Stigmer backend
5. Display success with version information

## How It Works

### Automatic Mode Detection

When you run `stigmer apply`, the CLI checks the current directory:

**Artifact Mode** (Skill Upload):
- **Triggered when**: `SKILL.md` exists in the directory
- **Process**: Zips and uploads the skill artifact
- **Scope**: Organization-level by default

**Code Mode** (Agent/Workflow Deployment):
- **Triggered when**: `Stigmer.yaml` exists (no `SKILL.md`)
- **Process**: Executes entry point and deploys resources
- **Scope**: Defined in Stigmer.yaml

### Skill Naming

The skill name is derived from the **directory name**:

```bash
my-calculator-skill/   → Skill name: "my-calculator-skill"
cool-validator/        → Skill name: "cool-validator"
```

The backend normalizes the name to a slug (lowercase, hyphens for spaces).

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

### Versioning and Hashing

Each skill upload is **content-addressable**:

1. **SHA256 Hash**: Calculated from the zip content
2. **Immutable**: Same content = same hash
3. **Deduplication**: Identical uploads won't duplicate storage
4. **Tag**: Defaults to `"latest"` (can be overridden in future)

## Example Workflow

### Creating and Uploading a New Skill

```bash
# 1. Create skill directory
mkdir code-formatter
cd code-formatter

# 2. Create SKILL.md
cat > SKILL.md << 'EOF'
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
stigmer apply
```

**Output**:
```
Detected SKILL.md - entering Artifact Mode

Skill name: code-formatter
Creating skill artifact...
✓ Artifact created (8.2 KB)
Version hash: a3f7b2e1...
Uploading skill artifact...
✓ Skill artifact uploaded successfully
  Version hash: a3f7b2e1c8d9f4a6...
  Tag: latest

🚀 Skill uploaded successfully!

Skill Details:
  Name:         code-formatter
  Version Hash: a3f7b2e1c8d9f4a6...
  Tag:          latest
  Size:         8.2 KB

Next steps:
  - Reference this skill in your agent code
  - Update and re-upload: edit files and run 'stigmer apply' again
```

### Updating an Existing Skill

Simply edit your files and run `stigmer apply` again:

```bash
# Edit your skill
vim SKILL.md
vim format.sh

# Re-upload (creates new version)
stigmer apply
```

Each upload creates a new version with a unique hash. The `"latest"` tag points to the newest version.

## Configuration

### Backend Mode

Skills are uploaded to your active backend:

**Local Backend** (Development):
```bash
# Uses local daemon at localhost:7234
# Organization: "local"
stigmer apply
```

**Cloud Backend** (Production):
```bash
# Uses cloud backend from config
# Organization: from config or --org flag
stigmer apply --org my-org-id
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

# Create SKILL.md
touch SKILL.md
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
