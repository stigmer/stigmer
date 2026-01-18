# Stigmer SDK Rules - Hierarchical Architecture

This directory contains the **root orchestrator rules** for Stigmer SDK implementation and improvement across multiple programming languages.

## Architecture Overview

```
sdk/
├── _rules/                                      # ← Root orchestrator (you are here)
│   ├── implement-stigmer-sdk-features.mdc      # Orchestrator: detects language, delegates
│   ├── improve-this-rule.mdc                    # Orchestrator: coordinates improvements
│   └── README.md                                # Architecture documentation (this file)
│
├── python/                                      # Python SDK implementation
│   └── _rules/
│       ├── implement-stigmer-sdk-features/
│       │   ├── implement-stigmer-sdk-features.mdc   # Python-specific patterns
│       │   ├── improve-this-rule.mdc                 # Python-specific improvements
│       │   └── docs/
│       │       ├── README.md                         # Python docs index
│       │       └── learning-log.md                   # Python SDK learnings
│       └── README.md                                 # Python SDK rules overview
│
└── go/                                          # Go SDK implementation
    └── _rules/
        ├── implement-stigmer-sdk-features/
        │   ├── implement-stigmer-sdk-features.mdc   # Go-specific patterns
        │   ├── improve-this-rule.mdc                 # Go-specific improvements
        │   └── docs/
        │       ├── README.md                         # Go docs index
        │       └── learning-log.md                   # Go SDK learnings
        └── README.md                                 # Go SDK rules overview
```

## How It Works

### 1. Unified Entry Point

Users invoke the **root orchestrator**:
```
@sdk/_rules/implement-stigmer-sdk-features
[Describe SDK feature to implement]
```

The orchestrator:
1. **Detects** which language is being worked on (Python, Go, or both)
2. **Delegates** to the appropriate language-specific rule
3. **Provides** unified experience across languages

### 2. Language-Specific Implementation

Each language has its own complete rule system:

**Python SDK** (`sdk/python/_rules (monorepo: stigmer/sdk/python/_rules)/`):
- Python-specific patterns (dataclasses, Poetry, pytest)
- Proto conversion in Python (`.extend()`, `.CopyFrom()`)
- Python validation and error handling
- Python testing patterns

**Go SDK** (`sdk/go/_rules (stigmer-sdk repo)/`):
- Go-specific patterns (structs, interfaces, go.mod)
- Proto conversion in Go (pointers, nil checks)
- Go validation and error wrapping
- Go testing patterns (table-driven tests)

### 3. Intelligent Improvement

When `@complete-stigmer-work` runs:
1. Detects SDK work (Python, Go, or both)
2. Invokes **root orchestrator improvement rule**
3. Orchestrator delegates to language-specific improvement rules
4. Each language updates its own learning log
5. Cross-language patterns referenced in both logs

## Benefits of Hierarchical Architecture

### For Users
✅ **Single entry point** - Don't need to remember language-specific paths
✅ **Automatic routing** - Orchestrator detects language and delegates
✅ **Consistent experience** - Same invocation pattern regardless of language
✅ **Flexibility** - Can still invoke language-specific rules directly if preferred

### For Maintainers
✅ **Separation of concerns** - Python patterns don't pollute Go docs
✅ **Independent evolution** - Each SDK evolves at its own pace
✅ **Clear organization** - Easy to find language-specific guidance
✅ **Scalability** - Easy to add new SDK languages (Rust, TypeScript, etc.)

### For Learning
✅ **Language-specific logs** - Python learnings in Python log, Go in Go log
✅ **Cross-references** - Universal patterns noted in both with references
✅ **No confusion** - Clear which solution applies to which language
✅ **Contextual** - Solutions shown in the language's idioms

## Usage Patterns

### Pattern 1: Let Orchestrator Decide (Recommended)

**Use case**: You're implementing SDK features and want automatic routing

```
@sdk/_rules/implement-stigmer-sdk-features
Implement agent configuration with environment variables
```

**Orchestrator action**:
- Detects language from context (file changes, conversation)
- Delegates to Python or Go rule
- Provides language-specific guidance

### Pattern 2: Direct Language-Specific Invocation

**Use case**: You know exactly which SDK you're working on

```
# Python SDK
@sdk/python/_rules (monorepo: stigmer/sdk/python/_rules)/implement-stigmer-sdk-features/implement-python-sdk-features
Implement AgentConfig dataclass

# Go SDK
@sdk/go/_rules (stigmer-sdk repo)/implement-stigmer-sdk-features/implement-go-sdk-features
Implement AgentConfig struct
```

**Direct action**:
- Skips language detection
- Goes straight to language-specific guidance
- Faster for language-specific work

### Pattern 3: Multi-Language Work

**Use case**: Implementing same feature in both SDKs

```
@sdk/_rules/implement-stigmer-sdk-features
Implement skill configuration in both Python and Go SDKs
```

**Orchestrator action**:
- Detects multi-language intent
- Provides guidance for both languages
- Ensures consistency across implementations

## Example Workflows

### Workflow 1: Python SDK Feature

**Developer workflow**:
```bash
# 1. Start work (orchestrator auto-detects Python)
@sdk/_rules/implement-stigmer-sdk-features
# ... implement Python SDK features ...

# 2. Complete work (orchestrator handles Python improvement)
@_projects/... @complete-stigmer-work

# AI automatically:
# ✅ Creates changelog
# ✅ Updates project
# ✅ Commits work
# ✅ Detects Python SDK work
# ✅ Invokes Python improvement rule
# ✅ Updates Python learning log
# ✅ Commits Python improvements
```

### Workflow 2: Go SDK Feature

**Developer workflow**:
```bash
# 1. Start work (can invoke Go rule directly)
@sdk/go/_rules (stigmer-sdk repo)/implement-stigmer-sdk-features/implement-stigmer-sdk-features
# ... implement Go SDK features ...

# 2. Complete work (orchestrator handles Go improvement)
@_projects/... @complete-stigmer-work

# AI automatically:
# ✅ Creates changelog
# ✅ Updates project
# ✅ Commits work
# ✅ Detects Go SDK work
# ✅ Invokes Go improvement rule
# ✅ Updates Go learning log
# ✅ Commits Go improvements
```

### Workflow 3: Cross-Language Feature

**Developer workflow**:
```bash
# 1. Start multi-language work
@sdk/_rules/implement-stigmer-sdk-features
Implement MCP server configuration in both Python and Go

# AI provides guidance for both:
# - Python dataclass approach
# - Go builder pattern approach
# - Ensures consistency

# 2. Complete work
@_projects/... @complete-stigmer-work

# AI automatically:
# ✅ Creates changelog
# ✅ Updates project
# ✅ Commits work
# ✅ Detects both Python and Go work
# ✅ Improves both language rules
# ✅ Cross-references patterns in both logs
# ✅ Commits both improvements
```

## Language Detection Logic

The orchestrator uses these signals to detect language:

### File Patterns
```python
# Python SDK
'sdk/python/**/*.py' → Python
'sdk/python/tests/**/*.py' → Python
'sdk/python/pyproject.toml' → Python

# Go SDK
'sdk/go/**/*.go' → Go
'sdk/go/**/*_test.go' → Go
'sdk/go/go.mod' → Go
```

### Conversation Keywords
```python
# Python indicators
'dataclass', 'Poetry', 'pytest', '.extend()', 'Python'

# Go indicators
'struct', 'interface', 'go.mod', 'append()', 'Go', 'Golang'
```

### Explicit Language Mention
```python
# User explicitly states language
"Implement in Python SDK" → Python
"Implement in Go SDK" → Go
"Implement in both SDKs" → Both
```

## Cross-Language Learnings

When a learning applies to both languages:

### Example: Proto Repeated Field Handling

**Problem**: How to add items to proto repeated fields

**Python Solution** (in Python learning log):
```python
# Must use .extend() for repeated fields
agent_proto.spec.skill_refs.extend(skill_refs_list)
```

**Go Solution** (in Go learning log):
```go
// Use append for repeated fields
agentProto.Spec.SkillRefs = append(agentProto.Spec.SkillRefs, skillRefs...)
```

**Cross-Reference** (in both logs):
```markdown
**Cross-Language Note**: See [Go SDK learning log] for Go equivalent using append().
Conceptually the same pattern, different syntax.
```

## Integration with Complete Stigmer Work

The root orchestrator is called by `@complete-stigmer-work.mdc`:

```markdown
## Step 4: Improve Rules (AI-Driven)

File Pattern: sdk/python/**/*.py or sdk/go/**/*.go
↓
Invokes: @sdk/_rules/improve-this-rule.mdc
↓
Orchestrator detects: Python, Go, or Both
↓
Delegates to language-specific improvement rules
↓
Updates language-specific learning logs
```

## Adding New SDK Languages

To add a new SDK language (e.g., Rust, TypeScript):

1. **Create language directory**:
   ```bash
   mkdir -p sdk/rust/_rules/implement-stigmer-sdk-features/docs
   ```

2. **Create language-specific rules**:
   - `implement-stigmer-sdk-features.mdc` - Rust patterns
   - `improve-this-rule.mdc` - Rust improvements
   - `docs/learning-log.md` - Rust learnings
   - `docs/README.md` - Rust docs index

3. **Update orchestrator**:
   - Add Rust detection patterns
   - Add Rust delegation logic
   - Add Rust evaluation questions

4. **Update complete-stigmer-work**:
   - Add Rust file patterns
   - Add Rust improvement rule path

## Quality Standards

### Language-Specific Rules Should:
✅ Use language-specific terminology and idioms
✅ Reference language-specific tools (Poetry, go.mod, cargo, etc.)
✅ Include language-specific code examples
✅ Document language-specific gotchas
✅ Maintain language-specific learning log

### Orchestrator Rules Should:
✅ Be language-agnostic in structure
✅ Handle all supported languages
✅ Provide clear delegation logic
✅ Ensure consistent user experience
✅ Coordinate cross-language learnings

## Related Documentation

**Root Orchestrator**:
- `implement-stigmer-sdk-features.mdc` - Main orchestrator for implementation
- `improve-this-rule.mdc` - Orchestrator for improvements
- `README.md` - This file

**Python SDK**:
- `sdk/python/_rules (monorepo: stigmer/sdk/python/_rules)/README.md` - Python SDK rules overview
- `sdk/python/_rules (monorepo: stigmer/sdk/python/_rules)/implement-stigmer-sdk-features/docs/learning-log.md` - Python learnings

**Go SDK**:
- `sdk/go/_rules (stigmer-sdk repo)/README.md` - Go SDK rules overview
- `sdk/go/_rules (stigmer-sdk repo)/implement-stigmer-sdk-features/docs/learning-log.md` - Go learnings

**Integration**:
- `_projects/_rules/complete-stigmer-work.mdc` - Uses orchestrator for SDK work

---

## Quick Reference

**Invoke orchestrator** (automatic language detection):
```
@sdk/_rules/implement-stigmer-sdk-features
```

**Invoke language-specific** (explicit):
```
@sdk/python/_rules (monorepo: stigmer/sdk/python/_rules)/implement-stigmer-sdk-features/implement-stigmer-sdk-features
@sdk/go/_rules (stigmer-sdk repo)/implement-stigmer-sdk-features/implement-stigmer-sdk-features
```

**Check learning logs**:
```
sdk/python/_rules (monorepo: stigmer/sdk/python/_rules)/implement-stigmer-sdk-features/docs/learning-log.md
sdk/go/_rules (stigmer-sdk repo)/implement-stigmer-sdk-features/docs/learning-log.md
```

---

**Status**: ✅ Hierarchical architecture fully operational

This architecture provides the best of both worlds:
- **Unified entry point** for convenience
- **Language-specific rules** for precision
- **Intelligent delegation** for the right guidance at the right time
