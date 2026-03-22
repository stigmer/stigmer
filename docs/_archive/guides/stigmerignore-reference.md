# .stigmerignore Reference

This guide explains how to use `.stigmerignore` files to control which files are included when pushing skills and other artifacts to Stigmer.

## Overview

When you run `stigmer skill push`, Stigmer creates a ZIP artifact of your skill directory. The `.stigmerignore` file lets you control which files are included in this artifact, similar to how `.gitignore` controls what Git tracks.

**Key Features:**
- Git-compatible pattern syntax (wildcards, negation, directory matching)
- Automatic respect for `.gitignore` patterns (can be disabled)
- Built-in security defaults to prevent accidental credential leaks
- CLI flags for additional control

## Quick Start

Create a `.stigmerignore` file in your skill's root directory:

```
# Ignore test files
*.test.py
*.test.ts
__tests__/

# Ignore documentation drafts
docs/drafts/

# But include the important test fixture
!tests/fixtures/critical.json
```

## Pattern Syntax

`.stigmerignore` uses the same syntax as `.gitignore`:

| Pattern | Description | Example |
|---------|-------------|---------|
| `*.ext` | Match files by extension | `*.pyc` matches all `.pyc` files |
| `dirname/` | Match directories (trailing slash) | `build/` matches the `build` directory |
| `**/pattern` | Match in any directory | `**/*.log` matches logs anywhere |
| `!pattern` | Negate (re-include) a pattern | `!important.log` re-includes that file |
| `#` | Comment line | `# This is a comment` |

### Pattern Examples

```gitignore
# Ignore all .log files
*.log

# But keep important.log
!important.log

# Ignore the entire build directory
build/

# Ignore node_modules anywhere in the tree
**/node_modules/

# Ignore all test files matching this pattern
**/*_test.go
**/test_*.py

# Ignore a specific file
secrets/api-key.txt

# Ignore files only in root directory (not subdirectories)
/local-config.yaml
```

## Precedence Rules

Stigmer applies ignore patterns in a layered system where later sources can override earlier ones:

```
1. Security Defaults (lowest priority)
      ↓
2. .gitignore patterns
      ↓
3. .stigmerignore patterns
      ↓
4. CLI flags (highest priority)
```

The **last matching pattern wins**. This means:

- `.stigmerignore` can override `.gitignore` using negation patterns
- CLI `--include` flags can override everything
- Security defaults can be overridden by explicit patterns (use with caution)

### Precedence Example

```
# .gitignore
build/
*.log

# .stigmerignore  
!build/assets/       # Re-include assets from build/
!config.log          # Re-include this specific log file
```

## Security Defaults

Stigmer includes built-in security patterns that are **always applied** to prevent accidental credential leaks. These patterns protect against common mistakes like pushing `.env` files or private keys.

### Protected File Types

| Category | Patterns |
|----------|----------|
| **Environment Files** | `.env`, `.env.*` (except `.env.example`, `.env.template`, `.env.sample`) |
| **Private Keys** | `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519` |
| **Cloud Credentials** | `credentials.json`, `service-account*.json`, `.aws/credentials` |
| **IDE/Editor** | `.idea/`, `.vscode/`, `*.swp` |
| **OS Files** | `.DS_Store`, `Thumbs.db` |
| **Build Artifacts** | `node_modules/`, `__pycache__/`, `.venv/`, `build/`, `dist/`, `target/` |
| **Logs** | `*.log`, `logs/` |

### Allowing Template Files

Security defaults specifically allow environment template files:

```
# These are ALLOWED (not real secrets):
.env.example
.env.template
.env.sample
```

### Overriding Security Defaults

You can override security defaults in `.stigmerignore`, but **use extreme caution**:

```gitignore
# WARNING: Only do this if you're sure the file contains no secrets!
!.env.development
```

## CLI Flags

The `stigmer skill push` command provides flags for additional control:

### `--ignore PATTERN`

Add patterns to ignore (repeatable):

```bash
stigmer skill push --ignore "*.tmp" --ignore "*.bak"
```

### `--include PATTERN`

Force-include files (highest priority, overrides all patterns):

```bash
stigmer skill push --include "config.log" --include "build/important.js"
```

### `--no-gitignore`

Disable reading `.gitignore` patterns:

```bash
stigmer skill push --no-gitignore
```

### `--verbose`

Show detailed output for each file decision:

```bash
stigmer skill push --verbose

# Output:
#   INCLUDE   SKILL.md
#   INCLUDE   main.py
#   IGNORE    .env (excluded by security default)
#   SKIP DIR  node_modules/ (excluded by security default)
```

### `--dry-run`

Preview what would be included without actually creating the artifact:

```bash
stigmer skill push --dry-run

# Output shows:
# - Pattern sources and counts
# - Sample included files
# - Sample ignored files
# - Estimated artifact size
```

## Common Scenarios

### Python Skill

```gitignore
# .stigmerignore for Python skill

# Test files (keep source, skip tests)
tests/
*_test.py
pytest.ini
conftest.py

# Virtual environments (already in defaults, but be explicit)
.venv/
venv/
.python-version

# IDE
.mypy_cache/
.pytest_cache/

# Build artifacts
*.egg-info/
dist/
build/
```

### Node.js Skill

```gitignore
# .stigmerignore for Node.js skill

# Test files
__tests__/
*.test.js
*.test.ts
*.spec.js
*.spec.ts
jest.config.js
.jest/

# Development only
*.d.ts.map
.eslintrc*
.prettierrc*
tsconfig.json

# Build (if you want to include compiled output)
# Uncomment to include: !dist/

# Documentation
docs/
*.md
!README.md
!SKILL.md
```

### Go Skill

```gitignore
# .stigmerignore for Go skill

# Test files
*_test.go
testdata/

# Build binaries
bin/
*.exe

# Go tool files
go.work
go.work.sum

# Vendor (if not needed)
vendor/
```

### Full-Stack Skill (Multiple Languages)

```gitignore
# .stigmerignore for full-stack skill

# Backend tests
backend/tests/
backend/*_test.py

# Frontend tests
frontend/__tests__/
frontend/*.test.tsx

# Development configs
docker-compose.dev.yml
Makefile

# Keep only production requirements
!requirements.txt
!package.json
!package-lock.json
```

## Directory Skipping Optimization

When a directory matches an ignore pattern, Stigmer skips the **entire directory tree** for performance. This is especially important for large directories like `node_modules/`.

**Important:** Files inside a skipped directory **cannot** be re-included using negation patterns. This is a deliberate trade-off for performance.

```gitignore
# This WORKS (file-level negation)
*.log
!important.log

# This does NOT work (directory already skipped)
node_modules/
!node_modules/important-package/  # Will NOT be included
```

If you need to include specific files from a generally-ignored directory, use a more specific pattern:

```gitignore
# Instead of ignoring the whole directory, ignore specific contents
node_modules/**/*.md
node_modules/**/*.ts
# This allows important-package to be included
!node_modules/important-package/
```

## Dry-Run Analysis

Use `--dry-run` to see exactly what would be included:

```bash
stigmer skill push --dry-run

# Output:
# ℹ Analyzing skill directory...
# 
# Pattern Sources:
#   - defaults (60 patterns)
#   - .gitignore (5 patterns)
#   - .stigmerignore (3 patterns)
#
# Summary:
#   Files: 15 would be included, 42 would be ignored
#   Directories skipped: 3
#   Estimated size: 24.5 KB
#
# Sample included files:
#   - SKILL.md
#   - main.py
#   - utils/helpers.py
#   - requirements.txt
#   - config.yaml
#
# Sample ignored files:
#   - .env (excluded by security default)
#   - tests/test_main.py (excluded by .stigmerignore)
#   - node_modules/ (excluded by security default)
```

## Best Practices

### 1. Start with Security Defaults

Security defaults are always on. Don't fight them unless you have a specific reason.

### 2. Use `.gitignore` First

If you already have a `.gitignore`, it will be respected automatically. Only add a `.stigmerignore` for Stigmer-specific overrides.

### 3. Be Explicit About Tests

Always exclude test files to keep artifacts small:

```gitignore
# Tests
tests/
test/
*_test.py
*.test.js
```

### 4. Include Only What's Needed

Skills should be minimal. Exclude documentation, examples, and development tools:

```gitignore
docs/
examples/
*.md
!README.md
!SKILL.md
```

### 5. Use Dry-Run Before Pushing

Always verify with `--dry-run` before your first push:

```bash
stigmer skill push --dry-run --verbose
```

### 6. Check Artifact Size

If your artifact is unexpectedly large, use `--verbose` to see what's being included:

```bash
stigmer skill push --verbose --dry-run | grep INCLUDE
```

## Troubleshooting

### File Not Being Ignored

1. Check pattern syntax (use `--verbose` to see decisions)
2. Verify the pattern is in the right file (`.gitignore` vs `.stigmerignore`)
3. Check for negation patterns that might be re-including it

### File Unexpectedly Ignored

1. Check security defaults (may be blocking it)
2. Use `--verbose` to see which pattern matched
3. Add explicit `!filename` negation to include it

### Directory Contents Not Included

If you're trying to include files from an ignored directory, remember that directory-level skipping prevents this. Restructure your patterns to avoid skipping the entire directory.

## Related Documentation

- [Uploading Skills](./uploading-skills.md) - How to push skills to Stigmer
- [Creating and Versioning Skills](./creating-and-versioning-skills.md) - Skill development guide
