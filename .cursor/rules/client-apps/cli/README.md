# Stigmer CLI Rules

This directory contains rules and documentation for implementing Stigmer CLI features.

## Rules Overview

### `coding-guidelines.mdc`

**Mandatory engineering standards** for all CLI code:
- Single Responsibility Principle
- Interface Segregation
- Dependency Injection
- Error Handling Standards
- Package Organization
- Quality Checklist

**Status**: MANDATORY - Must be followed for all CLI work

**Type**: Always-apply standards (though set to alwaysApply: false for manual reference)

### `implement-stigmer-cli-features.mdc`

**Implementation guide** for CLI development:
- CLI command patterns (Cobra)
- Daemon management
- Backend communication
- Configuration handling
- Output formatting
- Error handling
- Testing patterns

**Status**: Active - Use when implementing CLI features

**Type**: Action rule

### `improve-this-rule.mdc`

**Self-improvement** for CLI rules:
- Analyzes learnings from CLI work
- Updates documentation automatically
- Captures patterns and solutions
- Prevents future issues

**Status**: Active - Triggered by `@complete-stigmer-oss-work`

**Type**: Action rule (AI-driven, automatic)

## Documentation

### `docs/learning-log.md`

Real-world solutions and patterns:
- Organized by topic
- Problem → Root Cause → Solution
- Prevention strategies
- Code examples

**Check this FIRST before solving issues!**

### `docs/README.md`

Complete documentation index:
- Quick start guide
- Topic-specific docs
- Usage patterns
- Related rules

## How CLI Rules Integrate with Complete Work Orchestrator

The `@complete-stigmer-oss-work` orchestrator automatically:

1. **Detects CLI Work**: Analyzes `client-apps/cli/**/*.go` changes
2. **Evaluates Learning**: Checks if new patterns/issues were discovered
3. **Triggers Improvement**: Automatically invokes `@improve-this-rule.mdc`
4. **Updates Documentation**: Adds to learning log and reference docs

**AI-driven**: No manual intervention needed - the system learns and improves itself.

## Usage Workflow

### During Development

1. **Reference coding guidelines**: `@coding-guidelines.mdc`
2. **Follow implementation patterns**: `@implement-stigmer-cli-features.mdc`
3. **Check learning log**: `docs/learning-log.md` for solutions

### After Completing Work

1. **Invoke complete work**: `@complete-stigmer-oss-work`
2. **AI evaluates**: Automatically checks for CLI learnings
3. **Auto-improves**: Updates rules if new patterns discovered

## File Structure

```
.cursor/rules/client-apps/cli/
├── README.md (this file)
├── coding-guidelines.mdc (mandatory standards)
├── implement-stigmer-cli-features.mdc (implementation guide)
├── improve-this-rule.mdc (self-improvement)
└── docs/
    ├── README.md (documentation index)
    └── learning-log.md (real-world solutions)
```

## Key Differences from Stigmer Cloud CLI

Stigmer OSS CLI differs from Stigmer Cloud CLI:

1. **Dual Mode**: Local (daemon) + Backend (for Stigmer Cloud integration)
2. **Focus**: Workflow execution and agent management
3. **Import Paths**: `github.com/stigmer/stigmer/...`
4. **Simpler**: No multi-environment context (simpler than Planton Cloud)

## Related Rules

- `@complete-stigmer-oss-work` - Orchestrator that triggers CLI improvements
- `@commit-stigmer-oss-changes` - Git commit with conventional messages
- `@create-stigmer-oss-pull-request` - Create PR with description

---

**Remember**: These rules continuously improve based on real development work. Your learnings make the rules better for everyone.
