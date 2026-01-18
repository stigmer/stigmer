# Stigmer Go SDK Documentation Index

## Overview

This directory contains comprehensive documentation for implementing and maintaining the Stigmer Go SDK. Documentation is organized by topic for easy lookup.

## 📚 Documentation Catalog

### Learning & Evolution

1. **[Learning Log](learning-log.md)** 📖 **CHECK BEFORE IMPLEMENTING**
   - All discoveries and fixes
   - Organized by topic
   - Real-world Go solutions

### Architecture Guides

2. **[Proto-Agnostic Architecture](proto-agnostic-architecture.md)** 🏗️ **CORE PATTERN**
   - SDK is proto-agnostic (no proto dependencies)
   - CLI handles all proto conversion
   - File-based content loading
   - Inline + referenced resources
   - Builder pattern methods
   - Benefits and implementation guidance

### Implementation Guides (To Be Created)

Future documentation will be created as patterns stabilize:

3. **Proto Converters** (planned - CLI-side only)
   - CLI converter implementation
   - SDK to Proto transformations
   - Handling inline resources
   - Common conversion patterns

3. **Agent Configuration** (planned)
   - Builder patterns
   - Struct composition
   - Validation patterns
   - Error wrapping

4. **Testing Patterns** (planned)
   - Table-driven tests
   - Test fixtures
   - Mock patterns
   - Integration tests

5. **Error Handling** (planned)
   - Error wrapping with fmt.Errorf
   - Custom error types
   - Error propagation
   - Validation errors

## 🎯 Quick Lookup by Problem

### "Proto conversion pointer error"
→ Will be in Proto Converters doc (check learning log first)

### "Nil pointer dereference"
→ Will be in Proto Converters - Nil checks section

### "Table-driven test pattern"
→ Will be in Testing Patterns doc

### "Builder pattern for config"
→ Will be in Agent Configuration doc

## 📋 Documentation Standards

### When to Create New Docs

Create a new reference doc when:
- A new major feature area is added
- A topic has 5+ entries in learning log
- Patterns are complex enough to need dedicated explanation

### When to Update Existing Docs

Update existing docs when:
- Patterns change or improve
- New edge cases discovered
- Better examples found in real code
- Errors in current documentation

### When to Add to Learning Log

Add to learning log when:
- You fixed a non-obvious issue
- You discovered a new pattern
- You solved something that took >30 minutes
- You want to save others from the same problem

## 🔄 Self-Improvement Process

1. **Check First**: Always check learning log before solving a problem
2. **Document Discoveries**: Add new learnings to appropriate topic
3. **Update References**: Enhance reference docs with examples
4. **Improve Rule**: Invoke `@improve-this-rule.mdc` if patterns change
5. **Commit Changes**: Use `@complete-stigmer-work.mdc` to finalize

## 📊 Documentation Coverage

Current topics covered:
- ✅ Learning log (active) - 8+ major entries including:
  - Proto-agnostic architecture
  - File-based content loading
  - Inline resources pattern
  - Builder pattern methods
  - **Workflow SDK implementation** (12 task types) ⭐ NEW
  - **Fluent API patterns** (method chaining) ⭐ NEW
  - **Task-specific validation** (type assertions) ⭐ NEW
  - **Registry integration** (multi-resource support) ⭐ NEW
- ✅ Proto-agnostic architecture (complete) - Core architectural pattern
- ⏳ Proto converters (TODO - CLI-side only, as patterns emerge)
- ⏳ Agent configuration (TODO - as patterns emerge)
- ⏳ Workflow configuration (TODO - as patterns emerge) ⭐ NEW
- ⏳ Testing patterns (TODO - as patterns emerge)
- ⏳ Error handling (TODO - as patterns emerge)

## 🎓 Learning Philosophy

**These docs are living knowledge bases**, not static references:

- **Grow organically** as we discover Go-specific patterns
- **Evolve continuously** as Go implementations improve
- **Capture real problems** with real Go solutions
- **Save time** by preventing repeated issues

**Remember**: Every Go error you solve, every pattern you discover, every optimization you make should be documented here for the next developer (which might be you in 3 months).

## Cross-Language References

When applicable, reference Python SDK equivalent:
```markdown
**Python equivalent**: See sdk/python/_rules/.../docs/learning-log.md for Python approach using .extend()
**Go approach**: Use append() instead
```

## Related Files

- Main Rule: `../implement-stigmer-sdk-features.mdc`
- Improvement Rule: `../improve-this-rule.mdc`
- Go SDK Code: `../../../../` (sdk/go/)
- Root Orchestrator: `../../../../../sdk/_rules/`
