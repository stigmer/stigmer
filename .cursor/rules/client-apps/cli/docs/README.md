# Stigmer CLI Documentation

Complete reference documentation for Stigmer CLI development.

## Quick Start

**First-time CLI developers** - Read these in order:
1. `@.cursor/rules/client-apps/cli/coding-guidelines.mdc` - Engineering standards (MANDATORY)
2. `@.cursor/rules/client-apps/cli/implement-stigmer-cli-features.mdc` - Implementation guide
3. `learning-log.md` - Solutions to common issues

---

## Documentation Index

### Engineering Standards

- **`@.cursor/rules/client-apps/cli/coding-guidelines.mdc`** ⚠️ MANDATORY
  - Single Responsibility Principle
  - Interface Segregation
  - Error Handling Standards
  - Package Organization
  - Quality Checklist

### Implementation Guide

- **`@.cursor/rules/client-apps/cli/implement-stigmer-cli-features.mdc`**
  - CLI command patterns (Cobra)
  - Backend communication (gRPC)
  - Daemon management
  - Configuration handling
  - Output formatting
  - Error handling

### Learning & Troubleshooting

- **`learning-log.md`**
  - Real-world solutions
  - Common issues and fixes
  - Patterns discovered during development
  - Prevention strategies

### Self-Improvement

- **`@.cursor/rules/client-apps/cli/improve-this-rule.mdc`**
  - Autonomously improve implementation rule
  - Document new learnings
  - Update patterns and guidance

---

## Topic-Specific Docs

### (To be created as needed during development)

- **command-patterns.md** - Cobra command structures and flag handling
- **daemon-management.md** - Daemon lifecycle and binary management
- **backend-integration.md** - gRPC client patterns and error handling
- **configuration.md** - Config file formats and loading
- **error-handling.md** - Error wrapping and user-friendly messages
- **testing.md** - Unit and integration test patterns

---

## How to Use This Documentation

### Before Starting Work

1. Read `coding-guidelines.mdc` - Understand mandatory standards
2. Check `learning-log.md` - See if issue was solved before
3. Review `implement-stigmer-cli-features.mdc` - Understand patterns

### During Implementation

1. Follow patterns from `implement-stigmer-cli-features.mdc`
2. Reference `learning-log.md` when stuck
3. Adhere to `coding-guidelines.mdc` quality standards

### After Completing Work

1. If you learned something new → Add to `learning-log.md`
2. If patterns need updating → Invoke `@improve-this-rule.mdc`
3. Commit using `@complete-stigmer-oss-work`

---

## Documentation Philosophy

**Grounded in Reality**:
- All examples come from actual code
- Solutions are tested and work
- No speculation, only proven patterns

**Developer-Friendly**:
- Clear structure and navigation
- Scannable with good headers
- Code examples for everything
- Links between related docs

**Continuously Evolving**:
- Updated as we learn
- Improved as patterns mature
- Refined based on feedback

---

## Related Rules

- `@complete-stigmer-oss-work` - Finalize work with changelog and commits
- `@commit-stigmer-oss-changes` - Git commit with conventional messages
- `@create-stigmer-oss-pull-request` - Create PR with generated description

---

*This documentation grows and improves with every implementation. Your learnings help everyone.*
