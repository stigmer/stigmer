# Stigmer CLI Learning Log

This document captures lessons learned during Stigmer CLI development, organized by topic for quick reference.

## Purpose

Before solving a problem, check here first:
- Has this issue been solved before?
- Is there a documented pattern?
- What was the root cause last time?

After solving a new problem, add it here to help future work.

---

## Module & Dependencies

### [To be populated during development]

**Purpose**: Document Go module issues, proto stub imports, dependency conflicts, and build errors.

---

## CLI Commands

### [To be populated during development]

**Purpose**: Document Cobra command patterns, flag handling, argument parsing, and command organization.

---

## Backend Communication

### [To be populated during development]

**Purpose**: Document gRPC connection issues, health checks, error handling, and TLS configuration.

---

## Daemon Management

### [To be populated during development]

**Purpose**: Document daemon binary download, process lifecycle, secret management, and health monitoring.

---

## Configuration

### [To be populated during development]

**Purpose**: Document config file issues, YAML parsing, environment variables, and file permissions.

---

## Output & Errors

### [To be populated during development]

**Purpose**: Document error message patterns, output formatting, progress indicators, and UX issues.

---

## Testing

### [To be populated during development]

**Purpose**: Document unit test patterns, integration tests, mocking strategies, and test organization.

---

## Build & Release

### [To be populated during development]

**Purpose**: Document build issues, Bazel/Gazelle problems, cross-compilation, and release processes.

---

## How to Use This Log

1. **Before implementing**: Search this log for similar issues
2. **During implementation**: Reference solutions from past learnings
3. **After solving**: Add new learnings under appropriate topic
4. **When stuck**: Check if the issue was solved before

---

## Entry Template

When adding a new learning:

```markdown
### [Date] - [Brief Title]

**Problem**: [What went wrong or what needed solving]

**Root Cause**: [Why it happened]

**Solution**: [How to fix it]

**Prevention**: [How to avoid in future]

**Related Docs**: [Links to relevant sections]

**Example**:
```go
// Code example showing the fix
```
```

---

*This log is continuously updated as we learn from real development work.*
