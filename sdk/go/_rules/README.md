# Stigmer Go SDK Rules

This directory contains the self-improving workflow infrastructure for the Stigmer Go SDK.

## Structure

```
_rules/
└── implement-stigmer-sdk-features/
    ├── implement-go-sdk-features.mdc       # Main implementation rule
    ├── improve-go-sdk-rule.mdc             # Self-improvement rule
    └── docs/
        ├── README.md                       # Documentation index
        └── learning-log.md                 # Learning repository
```

## How It Works

### 1. Implementation Phase

When working on Go SDK features:
- Use `@sdk/go/_rules/implement-stigmer-sdk-features/implement-go-sdk-features` rule for guidance
- Or use root orchestrator: `@sdk/_rules/implement-stigmer-sdk-features` (auto-detects Go)
- Implement features following documented Go patterns
- Check `docs/learning-log.md` for solutions to common problems

### 2. Completion Phase

When work is complete:
- Invoke `@complete-stigmer-work` orchestrator
- AI automatically:
  - Creates changelog
  - Updates project progress
  - Commits changes
  - **Evaluates if Go SDK learnings occurred**
  - Triggers Go SDK rule improvement if warranted

### 3. Learning Capture (Automatic)

If the AI detects Go SDK work with genuine learnings:
- Invokes `improve-this-rule.mdc` automatically
- Adds entries to `docs/learning-log.md`
- Updates topic documentation
- Updates main rule guidance
- Commits improvements separately

## AI-Driven Improvement Detection

The `@complete-stigmer-work` orchestrator detects Go SDK work by checking:
- `sdk/go/**/*.go` (Go SDK code changes)
- `sdk/go/**/*_test.go` (Test changes)
- `sdk/go/_rules/**/*.mdc` (Rule changes)

**Evaluation Questions** (AI asks itself):
1. Did I fix a proto conversion or pointer handling error?
2. Did I discover a validation pattern not documented?
3. Did I solve a struct/interface implementation problem?
4. Did I create a new builder pattern or agent type?
5. Did I fix Go module or dependency issues?
6. Did I enhance error handling with Go error wrapping?
7. Did I discover testing patterns (table-driven tests)?

**If YES to any** → Trigger improvement automatically

## Integration with Complete Stigmer Work

The Go SDK is fully integrated into the `@complete-stigmer-work` orchestrator:

| File Pattern | Triggers | Improvement Rule |
|-------------|----------|-----------------|
| `sdk/go/**/*.go` | Go SDK detection | `@sdk/go/_rules/implement-stigmer-sdk-features/improve-go-sdk-rule.mdc` |
| `sdk/go/**/*_test.go` | Go SDK detection | (same) |

## Example Workflow

**Developer workflow**:
```bash
# 1. Work on Go SDK features (use orchestrator or direct)
@sdk/_rules/implement-stigmer-sdk-features  # Orchestrator auto-detects Go
# OR
@sdk/go/_rules/implement-stigmer-sdk-features/implement-go-sdk-features
# ... make changes, fix bugs, discover patterns ...

# 2. Complete work (single invocation)
@_projects/2026-01/... @complete-stigmer-work

# AI automatically:
# ✅ Creates changelog
# ✅ Updates project
# ✅ Commits work
# ✅ Evaluates Go SDK changes
# ✅ Improves Go SDK rule if learning detected
# ✅ Commits improvements
```

**No manual steps needed** - The AI handles:
- Learning detection
- Documentation updates
- Rule improvements
- Separate commits

## Benefits

✅ **Automatic learning capture** - No need to remember what you learned
✅ **No decision fatigue** - AI decides what's worth documenting
✅ **High-signal improvements** - Filters out routine work
✅ **Continuous evolution** - Rules improve from actual work patterns
✅ **Zero overhead** - Happens automatically during completion

## Comparison with Python SDK

The Go SDK has the **exact same workflow** as Python SDK:

| Component | Python SDK | Go SDK |
|-----------|------------|--------|
| Main Rule | ✅ `implement-python-sdk-features.mdc` | ✅ `implement-go-sdk-features.mdc` |
| Learning Log | ✅ `docs/learning-log.md` | ✅ `docs/learning-log.md` |
| Improvement Rule | ✅ `improve-python-sdk-rule.mdc` | ✅ `improve-go-sdk-rule.mdc` |
| Orchestrator Integration | ✅ `@complete-stigmer-work` | ✅ `@complete-stigmer-work` |
| AI-Driven Detection | ✅ Automatic | ✅ Automatic |

**Key Difference**: Language-specific patterns stay in language-specific rules.

## Getting Started

1. **Start work**: `@sdk/_rules/implement-stigmer-sdk-features` (orchestrator auto-detects Go)
2. **Or direct**: `@sdk/go/_rules/implement-stigmer-sdk-features/implement-stigmer-sdk-features`
3. **Check log**: `docs/learning-log.md`
4. **Implement features**: Follow Go-specific patterns in main rule
5. **Complete work**: `@complete-stigmer-work`
6. **AI handles rest**: Learning capture and rule improvement

## Related Documentation

- **Main Rule**: `implement-stigmer-sdk-features/implement-go-sdk-features.mdc`
- **Learning Log**: `implement-stigmer-sdk-features/docs/learning-log.md`
- **Docs Index**: `implement-stigmer-sdk-features/docs/README.md`
- **Improvement Rule**: `implement-stigmer-sdk-features/improve-go-sdk-rule.mdc`
- **Root Orchestrator**: `../../../sdk/_rules/` (parent orchestrator)
- **Orchestrator**: `_projects/_rules/complete-stigmer-work.mdc`

---

**Status**: ✅ Fully operational and integrated with complete-stigmer-work orchestrator
