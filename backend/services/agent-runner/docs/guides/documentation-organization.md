# Documentation Organization

This guide explains how documentation is organized in the agent-runner service.

## Structure

All documentation lives in the `docs/` folder, organized by purpose:

```
docs/
├── README.md                              # Complete documentation index
├── architecture/                          # System design and patterns
│   └── data-model.md                     # Resource hierarchy and relationships
├── implementation/                        # Implementation details and reports
│   ├── type-checking.md                  # mypy validation setup
│   └── agent-instance-migration.md       # AgentInstance layer implementation
└── guides/                               # How-to guides and tutorials
    └── documentation-organization.md     # This file
```

## File Naming Convention

All documentation files use **lowercase with hyphens**:

- ✅ `data-model.md`
- ✅ `type-checking.md`
- ✅ `agent-instance-migration.md`
- ❌ `DataModel.md` (no mixed case)
- ❌ `TYPE_CHECKING.md` (no uppercase)
- ❌ `agent_instance_migration.md` (no underscores)

This ensures consistency across platforms and follows open-source conventions.

## Categories

### Architecture (`architecture/`)

System design, data models, and architectural patterns.

**When to use**: Explaining how the system is structured and why design decisions were made.

**Examples**:
- Resource hierarchy and relationships
- Service communication patterns
- Security architecture

### Implementation (`implementation/`)

Detailed implementation reports, migration guides, and technical specifications.

**When to use**: Recording what was built, how it was built, and why.

**Examples**:
- Feature implementation reports
- Migration guides with before/after
- Technical specifications

### Guides (`guides/`)

Step-by-step how-to guides and tutorials.

**When to use**: Teaching someone to do something specific.

**Examples**:
- Setup and configuration guides
- Troubleshooting guides
- Development workflows

## Root README

The root `README.md` provides:

- Concise service overview (1-2 paragraphs)
- Quick start commands
- Key features (bulleted list)
- Environment variables table
- Basic deployment instructions
- Link to complete documentation (`docs/README.md`)

**What doesn't belong in root README**:
- Extensive architecture explanations → `docs/architecture/`
- Detailed implementation notes → `docs/implementation/`
- Step-by-step tutorials → `docs/guides/`

## Documentation Index

`docs/README.md` serves as the complete documentation index:

- **Quick Links** section for most-used documents
- Categorized sections (Architecture, Implementation, Guides)
- Brief descriptions for each document
- Service overview and key patterns
- Contributing guidelines

## Adding New Documentation

When creating new documentation:

1. **Determine the category** based on purpose:
   - System design? → `architecture/`
   - What was built? → `implementation/`
   - How to do it? → `guides/`

2. **Create the file** with a lowercase hyphenated name

3. **Update `docs/README.md`** to include your new document

4. **Update root `README.md`** if it's a key document

## Migration from Old Structure

Previously, documentation files were scattered in the root directory:

```
❌ OLD (scattered):
backend/services/agent-runner/
├── README.md (300+ lines, everything mixed in)
├── ARCHITECTURE_NOTES.md (uppercase, in root)
├── TYPE_CHECKING_IMPLEMENTATION.md (uppercase, in root)
└── AGENT_INSTANCE_MIGRATION.md (uppercase, in root)
```

```
✅ NEW (organized):
backend/services/agent-runner/
├── README.md (concise, links to docs)
└── docs/
    ├── README.md (complete index)
    ├── architecture/
    │   └── data-model.md
    ├── implementation/
    │   ├── type-checking.md
    │   └── agent-instance-migration.md
    └── guides/
        └── documentation-organization.md
```

## Benefits

**Before**:
- Hard to find specific documentation
- Root directory cluttered with docs
- Inconsistent naming (UPPERCASE, mixed case)
- No clear index or navigation

**After**:
- Clear categories make docs easy to find
- Clean root directory
- Consistent lowercase-hyphen naming
- Complete index in `docs/README.md`
- Scales well as documentation grows

## References

- **Documentation Standards**: See monorepo rule at `stigmer/.cursor/rules/documentation-standards.md`
- **Writing Guidelines**: See Planton workspace rule `@general-writing-guidelines.mdc`
- **Example Service**: `backend/services/workflow-runner/docs/` (well-organized reference)
