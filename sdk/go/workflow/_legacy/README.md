# Legacy Manual Task Implementations

**Purpose**: Archive of manual task config implementations, preserved as reference during code generator migration.

**Date Archived**: 2026-01-22  
**Reason**: Migrating to code-generated task configs from JSON schemas

---

## Contents

### task.go
Manual implementations of 12 task config types:
- SetTaskConfig
- HttpCallTaskConfig
- GrpcCallTaskConfig
- SwitchTaskConfig
- ForTaskConfig
- ForkTaskConfig
- TryTaskConfig
- ListenTaskConfig
- WaitTaskConfig
- CallActivityTaskConfig
- RaiseTaskConfig
- RunTaskConfig

### task_agent_call.go
Manual implementation of:
- AgentCallTaskConfig

---

## Purpose of Archive

This archive serves as:

1. **Field Reference**: Extract all fields to create complete JSON schemas
2. **Logic Reference**: Identify special logic (e.g., ImplicitDependencies tracking)
3. **Test Reference**: Verify generated code has feature parity
4. **Safety**: Can restore if code generator has issues

---

## Migration Process

**Phase 1** (Current): Extract field information
- Document all fields from each TaskConfig
- Identify optional vs required fields
- Note default values and special handling

**Phase 2**: Create complete schemas
- Use extracted field info to complete JSON schemas
- Include all fields, types, validation rules

**Phase 3**: Generate fresh code
- Run code generator with complete schemas
- Replace manual implementations with generated code

**Phase 4**: Validation
- Verify generated code compiles
- Run existing tests
- Compare behavior with legacy implementations

**Phase 5**: Cleanup
- Once confident, delete _legacy/ directory
- Update documentation

---

## Key Patterns to Preserve

### ImplicitDependencies
All task configs have `ImplicitDependencies map[string]bool` to track TaskFieldRef usage.

### Functional Options
Most tasks use functional option pattern (e.g., `SetTaskOption`, `HttpCallTaskOption`).

### Builder Functions
Each task has a builder function (e.g., `SetTask()`, `HttpCallTask()`).

---

## Status

- ✅ Files archived
- ⏳ Field extraction in progress
- ⏳ Schema completion pending
- ⏳ Code generation pending

---

**DO NOT DELETE** until migration is complete and validated!
