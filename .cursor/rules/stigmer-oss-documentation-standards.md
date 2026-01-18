# Stigmer OSS Documentation Standards

All documentation in the Stigmer OSS repository follows standardized organization and naming conventions.

## Organization Principle

All service/project documentation (except the root README.md) should live in a `docs/` folder, organized by purpose:

```
docs/
├── README.md                    # Complete documentation index
├── getting-started/             # Quick starts and configuration
├── architecture/                # System design and patterns
├── guides/                      # How-to guides and tutorials
├── implementation/              # Implementation details and reports
└── references/                  # Additional references and notes
```

## File Naming Convention

**All documentation files use lowercase with hyphens:**
- ✅ `quick-reference.md`
- ✅ `grpc-architecture.md`
- ✅ `phase-1.5-completion.md`
- ❌ `QUICK-REFERENCE.md` (no uppercase)
- ❌ `GrpcArchitecture.md` (no mixed case)
- ❌ `Phase_1_5_Completion.md` (no underscores)

This ensures consistency across platforms and follows open-source conventions.

## Script Organization

- Test scripts → `tools/` folder
- Build scripts → `tools/` or `scripts/` folder
- Never scatter scripts in root directory

## Adding New Documentation

When creating new documentation:

1. **Determine the category** based on purpose:
   - Teaching someone to use it? → `getting-started/`
   - Explaining how it works? → `architecture/`
   - Step-by-step instructions? → `guides/`
   - Recording what was built? → `implementation/`
   - Additional reference? → `references/`

2. **Create the file** with a lowercase hyphenated name

3. **Update docs/README.md** to include your new document

4. **Update root README.md** if it's a key document

5. **Follow writing guidelines** from the workspace rule: `@general-writing-guidelines.mdc`

## Documentation Categories Explained

### `getting-started/`
**Purpose**: Help new users get up and running quickly

**Examples**:
- `local-mode.md` - Running Stigmer locally
- `quick-start.md` - First steps with Stigmer
- `configuration.md` - Configuration options

**Characteristics**:
- Practical, step-by-step
- Assumes minimal knowledge
- Focused on "how do I..."

### `architecture/`
**Purpose**: Explain system design, patterns, and technical decisions

**Examples**:
- `backend-abstraction.md` - Backend interface design
- `open-core-model.md` - Open source vs enterprise architecture
- `workflow-engine.md` - Workflow execution design

**Characteristics**:
- Conceptual and technical
- Explains "why" and "how it works"
- Includes diagrams and design decisions

### `guides/`
**Purpose**: How-to guides for specific tasks

**Examples**:
- `adding-new-skill.md` - How to add a new skill
- `debugging-agents.md` - Debugging guide
- `writing-workflows.md` - Workflow authoring guide

**Characteristics**:
- Task-oriented
- Step-by-step instructions
- Includes examples and best practices

### `implementation/`
**Purpose**: Document implementation details, phase completions, technical reports

**Examples**:
- `phase-1-completion.md` - Phase 1 summary
- `proto-generation-setup.md` - Proto infrastructure setup
- `backend-migration.md` - Backend migration details

**Characteristics**:
- Technical and detailed
- Records what was built and why
- Includes decisions made during implementation

### `references/`
**Purpose**: Additional references, notes, and supplementary material

**Examples**:
- `temporal-patterns.md` - Temporal workflow patterns
- `proto-style-guide.md` - Proto file conventions
- `testing-strategy.md` - Testing approach

**Characteristics**:
- Reference material
- Can be referenced from other docs
- Supplementary to main documentation

## Root README.md

The root README.md provides:
- Concise project overview
- Quick start commands
- Link to complete documentation (`docs/README.md`)
- Quick links to key documents

It should NOT contain extensive documentation - that belongs in `docs/`.

## Why This Organization?

**Benefits:**
- Easy to find documentation (clear categories)
- Consistent structure across services/components
- Scales well (won't clutter root directory)
- Clear separation of concerns
- Follows open-source conventions

**Anti-patterns we avoid:**
- Uppercase filenames scattered in root
- Mixing documentation with source code
- Inconsistent naming (UPPERCASE, camelCase, snake_case mix)
- No clear organization or index

## Example: Well-Organized Service Documentation

See `backend/services/stigmer-server/` for an example of properly organized documentation.

**Structure:**
- `docs/getting-started/` - Quick reference, local mode setup
- `docs/architecture/` - Backend abstraction, open core model
- `docs/guides/` - Development guides, testing strategies
- `docs/implementation/` - Phase completions, migration reports
- `docs/references/` - Proto patterns, Temporal notes
- `tools/` - Test scripts and utilities (not in root!)

## Documentation Quality Standards

All documentation MUST follow the general writing guidelines from `@general-writing-guidelines.mdc`:

### Core Principles

1. **Grounded in Truth** - Write based on actual implementation, not speculation
2. **Developer-Friendly** - Write for developers who enjoy reading
3. **Concise** - Balance depth with brevity
4. **Timeless** - Explain concepts and systems, not conversations
5. **Use Examples** - Include analogies and concrete examples
6. **Context First** - Explain "why" before "how"

### Mermaid Diagrams

**⚠️ IMPORTANT: Include Mermaid diagrams wherever they add clarity.**

Use Mermaid diagrams for:
- Workflows and processes (flowcharts)
- Architecture (component diagrams)
- Sequences (interaction diagrams)
- State machines (status transitions)
- Data flows

**Example**:

\`\`\`markdown
## Workflow Execution Flow

\`\`\`mermaid
flowchart TB
    A[Submit Workflow] --> B{Validate Spec}
    B -->|Valid| C[Create Workflow Instance]
    B -->|Invalid| D[Return Error]
    C --> E[Execute Tasks]
    E --> F{All Tasks Complete?}
    F -->|Yes| G[Mark Complete]
    F -->|No| E
\`\`\`
\`\`\`

### Formatting Guidelines

- Use clear, descriptive headers
- Specify language for code blocks
- Keep list items parallel
- Use tables to compare options
- Use bold for key concepts
- Use code formatting for technical terms
- Include white space for readability

## Adding New Documentation (Step-by-Step)

### Step 1: Determine Category

Ask yourself:
- Is this teaching how to use something? → `getting-started/`
- Is this explaining architecture? → `architecture/`
- Is this a how-to guide? → `guides/`
- Is this documenting what was built? → `implementation/`
- Is this reference material? → `references/`

### Step 2: Create the File

```bash
# Example: Adding an architecture document
touch docs/architecture/agent-lifecycle.md
```

Use lowercase with hyphens for the filename.

### Step 3: Write Content

Follow the writing guidelines:
- Start with clear purpose (1-2 sentences)
- Explain why it exists (context)
- Explain how it works (high-level)
- Include diagrams where helpful
- Add examples and code blocks
- Keep it concise and scannable

### Step 4: Update Index

Add entry to `docs/README.md`:

```markdown
## Architecture

- [Agent Lifecycle](architecture/agent-lifecycle.md) - How agents are created and managed
```

### Step 5: Link from Root (if important)

If it's a key document, add to root `README.md`:

```markdown
## Documentation

- 📚 [Complete Documentation](docs/README.md)
- 🏗️ [Architecture Overview](docs/architecture/README.md)
- 🤖 [Agent Lifecycle](docs/architecture/agent-lifecycle.md) ← New link
```

## Maintenance

When updating documentation:
- Keep `docs/README.md` in sync
- Update cross-references in related docs
- Archive outdated docs (move to `references/` with note)
- Follow the general writing guidelines
- Update diagrams if architecture changes

## Centralized Documentation

**IMPORTANT**: Avoid repetitive documentation across the repository.

### Documentation Registry

Maintain a centralized registry in `docs/README.md` that links to ALL documentation:

```markdown
# Stigmer OSS Documentation

## Quick Navigation

### Getting Started
- [Local Mode](getting-started/local-mode.md)
- [Configuration](getting-started/configuration.md)

### Architecture
- [Backend Abstraction](architecture/backend-abstraction.md)
- [Agent Lifecycle](architecture/agent-lifecycle.md)

### Guides
- [Adding Skills](guides/adding-skills.md)
- [Writing Workflows](guides/writing-workflows.md)

### Implementation
- [Phase 1 Summary](implementation/phase-1-summary.md)
- [Proto Setup](implementation/proto-generation-setup.md)

### References
- [Temporal Patterns](references/temporal-patterns.md)
- [Proto Style Guide](references/proto-style-guide.md)
```

### Avoid Duplication

**Before writing new documentation**:
1. Check `docs/README.md` for existing docs on the topic
2. Review existing documentation
3. Either update existing doc OR create new one (not both)
4. Link to existing docs instead of duplicating content

**Example - Good Practice**:

Instead of duplicating agent configuration details in multiple places:

```markdown
<!-- In guides/adding-skills.md -->
## Agent Configuration

For agent configuration details, see [Agent Lifecycle](../architecture/agent-lifecycle.md#configuration).
```

**Example - Bad Practice**:

```markdown
<!-- DON'T DO THIS - Duplicating content -->
## Agent Configuration

Agents are configured using YAML files with the following fields:
- name: Agent name
- skills: List of skills
[... 50 lines of duplicated content ...]
```

### Single Source of Truth

Each concept should have ONE authoritative document:

| Concept | Authoritative Document | Other Docs |
|---------|----------------------|------------|
| Agent Lifecycle | `architecture/agent-lifecycle.md` | Link to it |
| Local Setup | `getting-started/local-mode.md` | Link to it |
| Workflow Spec | `references/workflow-spec.md` | Link to it |

### Reference Existing Documentation

When you need to mention a documented concept:

```markdown
<!-- Good: Reference with context -->
Agents use the workflow engine to execute tasks. 
See [Workflow Engine Architecture](../architecture/workflow-engine.md) 
for details on how workflows are parsed and executed.

<!-- Bad: Copying content -->
Agents use the workflow engine. The workflow engine parses YAML specs, 
validates them, and creates Temporal workflows... [duplicated content]
```

## Documentation in Project Progress

When updating project progress (`@update-next-project-progress`), reference existing documentation:

**In checkpoint files**:
```markdown
## Documentation Updates

- Updated [Agent Lifecycle](../docs/architecture/agent-lifecycle.md) with new state transitions
- Added [Debugging Guide](../docs/guides/debugging-agents.md) for troubleshooting

See [Documentation Index](../docs/README.md) for all available documentation.
```

**In next-task.md**:
```markdown
## Reference Documentation

Before continuing, review:
- [Backend Abstraction](docs/architecture/backend-abstraction.md) - Understand interface design
- [Proto Style Guide](docs/references/proto-style-guide.md) - Follow proto conventions
```

## Documentation in Rule Improvements

When improving rules (`improve-this-rule.mdc`), reference documentation standards:

**In learning-log.md**:
```markdown
## 2026-01-18: Agent State Management Pattern

**Context**: Discovered complex state transition pattern for agent lifecycle.

**Learning**: [Documented in architecture/agent-lifecycle.md]

**Reference**: See [Agent Lifecycle](../../docs/architecture/agent-lifecycle.md#state-transitions)
```

**In rule docs**:
```markdown
## Reference Documentation

### Architecture
- [Backend Abstraction](../../docs/architecture/backend-abstraction.md)
- [Agent Lifecycle](../../docs/architecture/agent-lifecycle.md)

### Guides
- [Adding Skills](../../docs/guides/adding-skills.md)
- [Debugging Agents](../../docs/guides/debugging-agents.md)
```

## Quality Checklist

Before finalizing any documentation:

- [ ] File uses lowercase-with-hyphens naming
- [ ] File is in appropriate category folder
- [ ] `docs/README.md` updated with link
- [ ] Root `README.md` updated if key document
- [ ] Follows general writing guidelines
- [ ] Includes diagrams where helpful
- [ ] No duplication of existing content
- [ ] Links to related documentation
- [ ] Grounded in actual implementation
- [ ] Concise and scannable
- [ ] Would help someone at 2 AM debugging

## Resources

- **Example Service**: `backend/services/stigmer-server/docs/`
- **Writing Guidelines**: Workspace rule `@general-writing-guidelines.mdc`
- **Documentation Index**: `docs/README.md`

---

**Remember**: Good documentation is grounded, developer-friendly, concise, timeless, and well-organized. Write for the person who will read this at 2 AM trying to understand or fix something.
