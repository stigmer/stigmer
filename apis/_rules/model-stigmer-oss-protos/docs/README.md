# Proto API Documentation

**Rule**: Model Stigmer OSS Protos  
**Location**: `apis/_rules/model-stigmer-oss-protos/`

---

## Overview

This directory contains documentation for creating Stigmer proto APIs. Documentation is split into:
- **Learning Log**: Historical record of proto APIs created and patterns discovered
- **Topic Docs**: Reusable standards and patterns (created as patterns stabilize)

---

## Documentation Files

### Learning & Evolution

- **[Learning Log](learning-log.md)** - Chronicle of proto API creation and pattern discovery
  - Organized by topic (API Resource Standards, File Organization, Validation, etc.)
  - Captures each proto API created with structure, decisions, and learnings
  - Source of truth for proto evolution

### Topic-Specific Standards

_Topic docs will be created as patterns stabilize (used 2-3+ times)_

**Planned topics**:
- Organization Patterns - 5-file structure guide
- API Resource Standards - Kubernetes-inspired resource structure
- Validation Patterns - buf.validate best practices
- Authorization Configuration - RPC authorization patterns
- Common Mistakes - Error catalog and prevention

---

## How to Use

### For Proto API Creation

1. Read main rule: `../model-stigmer-oss-protos.mdc`
2. Reference learning log for examples
3. Follow topic docs (when they exist)
4. Document your learnings after creation

### For Learning Documentation

1. Add entry to `learning-log.md` under appropriate topic
2. Create topic doc if pattern used 2-3+ times
3. Update main rule's "Reference Documentation" section
4. Update this index

---

## Current Status

**Learning Log Entries**: 2
- Spec/Status separation pattern (2026-01-22)
- Common mistake: System state in Input (2026-01-22)

**Topic Docs**: None yet (early stage)

**Next**: Topic docs will be extracted as patterns stabilize through repeated use

---

**Last Updated**: 2026-01-22
