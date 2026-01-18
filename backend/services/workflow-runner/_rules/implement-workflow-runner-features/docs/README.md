# Workflow Runner Rule Documentation

Complete documentation for the `implement-workflow-runner-features` rule and workflow-runner implementation patterns.

## Quick Links

**Start Here**:
- [Main Implementation Rule](../implement-workflow-runner-features.mdc) - Complete implementation guide
- [Learning Log](./learning-log.md) - Solutions to common problems (check BEFORE implementing)

**Related Rules**:
- [Improve This Rule](../improve-this-rule.mdc) - Self-improvement process

## Documentation Organization

### Rule Documentation (This Folder)

**Learning Resources**:
- [`learning-log.md`](./learning-log.md) - Lessons learned from real implementations
  - Organized by topic for quick lookup
  - Real-world problems and tested solutions
  - Prevention patterns and best practices

**Meta Documentation**:
- [`README.md`](./README.md) - This file, documentation index

### Service Documentation (Parent Folders)

The workflow-runner service has comprehensive documentation in `../docs/`:

**Architecture**:
- [`docs/architecture/overview.md`](../../docs/architecture/overview.md) - Complete system architecture
- [`docs/architecture/claimcheck.md`](../../docs/architecture/claimcheck.md) - Claim check pattern for large payloads
- [`docs/architecture/grpc.md`](../../docs/architecture/grpc.md) - gRPC server architecture
- [`docs/architecture/callbacks.md`](../../docs/architecture/callbacks.md) - Callback mechanism
- [`docs/architecture/continue-as-new-pattern.md`](../../docs/architecture/continue-as-new-pattern.md) - Workflow continuation

**Getting Started**:
- [`docs/getting-started/configuration.md`](../../docs/getting-started/configuration.md) - Configuration guide
- [`docs/getting-started/quick-reference.md`](../../docs/getting-started/quick-reference.md) - Environment variables and commands

**Implementation Guides**:
- [`docs/guides/phase-1.5.md`](../../docs/guides/phase-1.5.md) - Implementation roadmap
- [`docs/guides/build-strategy.md`](../../docs/guides/build-strategy.md) - Bazel build patterns
- [`docs/guides/testing-guide.md`](../../docs/guides/testing-guide.md) - Testing strategies
- [`docs/guides/yaml-format-reference.md`](../../docs/guides/yaml-format-reference.md) - CNCF workflow syntax

**Implementation History**:
- [`docs/implementation/claimcheck.md`](../../docs/implementation/claimcheck.md) - Claim check implementation status
- [`docs/implementation/phase-*.md`](../../docs/implementation/) - Phase completion summaries

**References**:
- [`docs/references/security-audit.md`](../../docs/references/security-audit.md) - Security considerations
- [`docs/references/upstream-notes.md`](../../docs/references/upstream-notes.md) - Changes from upstream Zigflow

## How Documentation Works Together

### For New Implementations

1. **Start**: Read [Main Rule](../implement-workflow-runner-features.mdc) for patterns and examples
2. **Check**: Search [Learning Log](./learning-log.md) for similar problems
3. **Deep Dive**: Read relevant service docs from `../docs/` for architecture and details
4. **Implement**: Follow patterns from rule and service docs
5. **Document**: Add learnings to learning log if you discovered something new

### For Troubleshooting

1. **Learning Log**: Check [learning-log.md](./learning-log.md) first - organized by topic
2. **Main Rule**: Check [Troubleshooting Guide](../implement-workflow-runner-features.mdc#troubleshooting-guide)
3. **Service Docs**: Check architecture docs for deeper understanding
4. **Add Entry**: If you solved something new, add it to learning log

### For Understanding Architecture

1. **Overview**: Start with [`docs/architecture/overview.md`](../../docs/architecture/overview.md)
2. **Specific Topics**: Read focused architecture docs (claim check, gRPC, etc.)
3. **Implementation**: Check phase summaries to understand what was built and why

## Documentation Principles

**Learning Log**:
- ✅ Topic-organized (not chronological)
- ✅ Real problems with tested solutions
- ✅ Code examples and prevention patterns
- ✅ Links to related documentation

**Main Rule**:
- ✅ Comprehensive patterns and examples
- ✅ Common use cases covered
- ✅ Troubleshooting guide
- ✅ Links to service documentation

**Service Docs** (`../docs/`):
- ✅ Architecture and design decisions
- ✅ Implementation guides and references
- ✅ Complete system understanding

## Keeping Documentation Fresh

**When to Update**:
- ✅ You solved a non-trivial problem → Add to learning log
- ✅ You discovered a pattern not in docs → Update main rule
- ✅ Architecture changed → Update service docs
- ✅ You found outdated/wrong info → Fix it immediately

**How to Update**:
1. For learning log entries: Add under appropriate topic
2. For rule improvements: Invoke `@improve-this-rule.mdc`
3. For service docs: Update directly in `../docs/`

## Related Documentation

**Stigmer Monorepo**:
- [`backend/services/workflow-runner/README.md`](../../README.md) - Service overview
- [`backend/services/workflow-runner/docs/README.md`](../../docs/README.md) - Complete service docs

**Other Services**:
- [`backend/services/agent-runner/_rules/`](../../../agent-runner/_rules/) - Python agent execution rule (similar structure)
- [`backend/services/stigmer-service/_rules/`](../../../stigmer-service/_rules/) - Backend handlers rule

**Global Rules**:
- [`_projects/_rules/complete-stigmer-work.mdc`](../../../../../_projects/_rules/complete-stigmer-work.mdc) - Workflow orchestrator that triggers rule improvement

---

**Remember**: Check the [Learning Log](./learning-log.md) BEFORE implementing. The solution you need might already be documented!
