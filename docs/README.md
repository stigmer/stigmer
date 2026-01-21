# Stigmer OSS Documentation

Complete documentation index for the Stigmer open-source project.

## Quick Navigation

### Getting Started
- [Local Mode](getting-started/local-mode.md) - Running Stigmer locally for development

### CLI
- [Running Agents and Workflows](cli/running-agents-workflows.md) - Execute agents and workflows with `stigmer run`
- [Configuration](cli/configuration.md) - CLI configuration and context management
- [Configuration Cascade](cli/configuration-cascade.md) - Complete guide to configuration priority (CLI flags, env vars, config file)
- [Server Logs](cli/server-logs.md) - Viewing and managing server logs

### Guides
- [Deploying with Apply](guides/deploying-with-apply.md) - Deploy agents and workflows from code using `stigmer apply`
- [Distribution Guide](guides/distribution.md) - Complete guide to packaging and distributing Stigmer
- [Packaging Quick Start](guides/packaging-quickstart.md) - Quick reference for packaging strategy
- [Release Workflow](../.github/workflows/RELEASE-WORKFLOW.md) - How to create releases using the build-first pattern
- [Agent Runner: Local Mode](guides/agent-runner-local-mode.md) - Running the agent runner in local vs cloud mode
- [Stigmer New Command](guides/stigmer-new-command.md) - Complete setup for the `stigmer new` command, demo repository, and zero-config quickstart

### Implementation
- [Phase 1 Foundation](implementation/phase-1-foundation.md) - Phase 1 implementation summary: repository structure, gRPC architecture, and database design
- [Cloud Build Alignment](implementation/cloud-build-alignment.md) - Complete alignment of Stigmer OSS with Stigmer Cloud build system and development patterns
- [Task Export Context Fix](implementation/task-export-context-fix.md) - Fix for multi-task workflows with hyphenated names and context merging
- [Task Export Context Fix - Learnings](implementation/task-export-context-fix-learnings.md) - Detailed learnings from the task export context bug fix for SDK and workflow runner improvements
- [Sandbox Implementation](implementation/sandbox-implementation.md) - Three-tier sandbox strategy implementation (local, basic, full)
- [Configuration Cascade Implementation](implementation/configuration-cascade-implementation.md) - Configuration cascade pattern implementation details

### Architecture
- [Backend Modes](architecture/backend-modes.md) - Local vs cloud backend architecture, auto-start daemon, and organization handling
- [Backend Abstraction](architecture/backend-abstraction.md) - Backend interface design and abstraction layers
- [CLI Subprocess Lifecycle](architecture/cli-subprocess-lifecycle.md) - Production-grade subprocess management with lock files, health checks, and auto-restart
- [Go Module Structure](architecture/go-module-structure.md) - Go workspace and module organization pattern for contributors
- [Open Core Model](architecture/open-core-model.md) - Open source vs enterprise architecture
- [Packaging Flow](architecture/packaging-flow.md) - How Stigmer is packaged and distributed (with diagrams)
- [Request Pipeline Context Design](architecture/request-pipeline-context-design.md) - Multi-context vs single-context architectural analysis
- [Temporal Integration](architecture/temporal-integration.md) - Polyglot workflow orchestration with Temporal (Go workflows, Python activities)
- [Update Pipeline and Immutable Fields](architecture/update-pipeline-and-immutable-fields.md) - How updates preserve identity while allowing modifications

### Architecture Decision Records (ADR)
- [Local Backend to Use BadgerDB](adr/20260118-181912-local-backend-to-use-badgerdb.md) - Decision to use BadgerDB for local mode
- [SDK Code Generators](adr/20260118-181912-sdk-code-generators.md) - Code generation approach for SDKs
- [Stigmer Local Daemon](adr/20260118-190513-stigmer-local-deamon.md) - Local daemon architecture
- [Badger Schema Changes](adr/20260118-202523-badger-schema-changes.md) - BadgerDB schema design decisions
- [In-Process gRPC Calls and Agent Instance Creation](adr/20260118-214000-in-process-grpc-calls-and-agent-instance-creation.md) - In-process gRPC architecture
- [Fix Go In-Process gRPC Implementation](adr/20260118-fix-go-inprocess-grpc-implementation.md) - Technical fixes for in-process gRPC
- [Workflow Runner Config](adr/20260119-011111-workflow-runner-config.md) - Workflow runner configuration architecture

**Note**: See `_cursor/adr-doc` for ADR 016: Local Agent Runner Runtime Strategy (implementation guide)

## Documentation by Purpose

### Learning Stigmer
Start here if you're new to Stigmer:
1. [Local Mode](getting-started/local-mode.md) - Get up and running
2. [Running Agents and Workflows](cli/running-agents-workflows.md) - Execute with `stigmer run`
3. [Backend Abstraction](architecture/backend-abstraction.md) - Understand the architecture
4. [Open Core Model](architecture/open-core-model.md) - Understand OSS vs enterprise split

### Distributing Stigmer
If you're working on releases or packaging:
1. [Packaging Quick Start](guides/packaging-quickstart.md) - Quick reference for packaging strategy
2. [Packaging Flow](architecture/packaging-flow.md) - Visual guide to how packaging works
3. [Distribution Guide](guides/distribution.md) - Complete distribution documentation
4. [Release Workflow](../.github/workflows/RELEASE-WORKFLOW.md) - How to create releases using the build-first pattern

### Understanding Design Decisions
When you wonder "why was it built this way?":
- [Request Pipeline Context Design](architecture/request-pipeline-context-design.md) - Why Go uses single context vs Java multi-context
- [Packaging Flow](architecture/packaging-flow.md) - How CLI and server binaries are packaged together
- [ADR Index](adr/) - Browse all architectural decisions

### Contributing
Before making changes:
1. Review [Backend Abstraction](architecture/backend-abstraction.md) for patterns
2. Check [ADRs](adr/) for relevant decisions
3. Follow the architecture patterns demonstrated in existing code

## Contributing to Documentation

When adding new documentation:
1. Place it in the appropriate category folder
2. Use lowercase-with-hyphens for filenames
3. Update this README.md with a link
4. Follow the [Stigmer OSS Documentation Standards](../.cursor/rules/stigmer-oss-documentation-standards.md)

See [Documentation Standards](../.cursor/rules/stigmer-oss-documentation-standards.md) for complete guidelines.

---

**Remember**: Documentation is a love letter to your future self.
