# Stigmer OSS Documentation

Complete documentation index for the Stigmer open-source project.

## Quick Navigation

### Getting Started
- [Local Mode](getting-started/local-mode.md) - Running Stigmer locally for development
- [Agent Runner: Local Mode](agent-runner-local-mode.md) - Running the agent runner in local vs cloud mode

### Architecture
- [Backend Abstraction](architecture/backend-abstraction.md) - Backend interface design and abstraction layers
- [Open Core Model](architecture/open-core-model.md) - Open source vs enterprise architecture
- [Request Pipeline Context Design](architecture/request-pipeline-context-design.md) - Multi-context vs single-context architectural analysis
- [Agent Runner: Local Mode](agent-runner-local-mode.md) - Mode-aware execution architecture (local vs cloud)

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
2. [Backend Abstraction](architecture/backend-abstraction.md) - Understand the architecture
3. [Open Core Model](architecture/open-core-model.md) - Understand OSS vs enterprise split

### Understanding Design Decisions
When you wonder "why was it built this way?":
- [Request Pipeline Context Design](architecture/request-pipeline-context-design.md) - Why Go uses single context vs Java multi-context
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
