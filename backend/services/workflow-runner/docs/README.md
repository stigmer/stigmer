# Workflow Runner Documentation

Complete documentation for the Workflow Runner service - a CNCF Serverless Workflow interpreter for Temporal, integrated into Stigmer.

## Getting Started

Start here if you're new to the Workflow Runner:

- **[Quick Reference](./getting-started/quick-reference.md)** - Fast overview, environment variables, and common commands
- **[Configuration Guide](./getting-started/configuration.md)** - Detailed configuration for local, staging, and production
- **[Temporal Search Attributes Setup](./getting-started/temporal-search-attributes-setup.md)** - Setting up required Temporal search attributes

## Architecture

Understand how the Workflow Runner works:

- **[Architecture Overview](./architecture/overview.md)** - Complete system architecture and dual gRPC implementation
- **[gRPC Architecture](./architecture/grpc.md)** - gRPC server (commands) and client (callbacks)
- **[Callback Integration](./architecture/callbacks.md)** - How progress reporting works
- **[Claim Check Pattern](./architecture/claim-check-pattern.md)** - Large payload handling with R2 storage
- **[Continue-As-New Pattern](./architecture/continue-as-new-pattern.md)** - Unbounded workflows and state preservation across runs

## Guides

Step-by-step guides for common tasks:

- **[Testing Guide](./guides/testing-guide.md)** - How to properly test the workflow-runner service
- **[Phase 1.5 Implementation](./guides/phase-1.5.md)** - Complete Phase 1.5 implementation guide
- **[Build Strategy](./guides/build-strategy.md)** - Bazel build system and CI/CD pipeline
- **[Environment Loading](./guides/environment-loading.md)** - Environment variable loading patterns

## Implementation Details

Deep dives into specific implementations:

- **[Implementation Status](./implementation/implementation-status.md)** - Current implementation status and completed features
- **[Phase 2: Backend Integration](./implementation/phase-2-backend-integration.md)** - Backend integration completion report
- **[Execute Workflow Activity](./implementation/execute-workflow-activity.md)** - ExecuteWorkflowActivity implementation details
- **[Execution ID Propagation](./implementation/execution-id-propagation.md)** - How execution IDs propagate through workflows
- **[Execution ID Propagation Summary](./implementation/execution-id-propagation-summary.md)** - Quick summary of ID propagation
- **[Temporal Search Attribute Automation](./implementation/temporal-search-attribute-automation.md)** - Automated search attribute setup
- **[Search Attribute Naming Fix](./implementation/search-attribute-naming-fix.md)** - CustomStringField → WorkflowExecutionID rename
- **[Testing Consolidation](./implementation/testing-consolidation.md)** - How we simplified testing from 7+ scripts to 2
- **[Phase 1.5 Completion](./implementation/phase-1.5-completion.md)** - Phase 1.5 completion report and status
- **[Phase 1.5 Summary](./implementation/phase-1.5-summary.md)** - Implementation summary and lessons learned  
- **[Phase 3 Day 3 Completion](./implementation/phase-3-day-3-completion.md)** - Progress reporting enhancement completion report
- **[Phase 3 Day 3 Summary](./implementation/phase-3-day-3-summary.md)** - Quick summary of progress reporting implementation
- **[Claim Check Implementation](./implementation/claimcheck.md)** - Claim Check pattern implementation details
- **[Agent Runner Pattern Migration](./implementation/agent-runner-pattern-migration.md)** - Migration to agent-runner patterns
- **[Day 4: gRPC to Temporal Fix](./implementation/day-4-grpc-to-temporal-fix.md)** - gRPC to Temporal integration fixes
- **[Day 4: gRPC Temporal Fix Complete](./implementation/day-4-grpc-temporal-fix-complete.md)** - Completion report for gRPC fixes
- **[Progress Reporting Mock Mode](./implementation/progress-reporting-mock-mode.md)** - Mock mode for progress reporting testing

## References

Additional reference materials:

- **[Upstream Notes](./references/upstream-notes.md)** - Tracking changes from upstream Zigflow
- **[Security Audit](./references/security-audit.md)** - Security considerations and audit results
- **[Original Architecture](./references/architecture-original.md)** - Original architecture documentation (archived)

### Archived Documentation

Historical documents for reference:

- **[Archived: Implementation Summary](./references/archived-implementation-summary.md)** - Original updateStatus pattern implementation (superseded by implementation-status.md)
- **[Archived: Migration Complete](./references/archived-migration-complete.md)** - WorkflowProgressEvent to updateStatus migration (completed)
- **[Archived: Migration Progress](./references/archived-migration-progress.md)** - Migration tracking document (completed)
- **[Archived: UpdateStatus Pattern TODO](./references/archived-update-status-pattern-todo.md)** - Original TODO list for updateStatus pattern (completed)

## Quick Links

**Building & Running:**
```bash
# Generate proto stubs
cd apis && make go-stubs

# Build with Bazel
bazel build //backend/services/workflow-runner/cmd/grpc-server

# Run locally
bazel run //backend/services/workflow-runner/cmd/grpc-server
```

**Key Concepts:**
- The Workflow Runner is **both** a gRPC server (receives commands) and client (sends progress)
- No database dependencies - all data comes from proto input
- Progress reporting is resilient - failures don't stop workflow execution
- Claim Check pattern handles large AI payloads (100KB+)
- Continue-As-New enables unbounded workflows by periodically starting fresh runs with preserved state

**Environment Variables:**
```bash
GRPC_PORT=9090                                          # Server port
STIGMER_SERVICE_ENDPOINT=stigmer-prod-api.planton.live:443  # Callback endpoint
STIGMER_SERVICE_API_KEY=<secret>                        # Auth token
TEMPORAL_SERVICE_ADDRESS=temporal:7233                  # Temporal connection
```

## Documentation Organization

This documentation follows a clear structure:

- **getting-started/** - Quick starts and configuration
- **architecture/** - System design and patterns
- **guides/** - How-to guides and tutorials
- **implementation/** - Implementation details and post-mortems
- **references/** - Additional reference materials

## Contributing to Documentation

When adding documentation:

1. **Use lowercase file names** with hyphens (e.g., `my-new-doc.md`)
2. **Place in appropriate folder** based on content type
3. **Update this README** to include new documents
4. **Follow markdown conventions** (see general writing guidelines)
5. **Keep docs focused** - one topic per document

For detailed documentation guidelines, see the workspace rule: `.cursor/rules/documentation-guidelines.mdc`

---

**Last Updated**: January 16, 2026  
**Maintained By**: Stigmer Engineering Team

## Documentation Organization

This documentation follows the Stigmer documentation standards:
- All files use **lowercase with hyphens** (e.g., `my-document.md`)
- Organized by purpose: `getting-started/`, `architecture/`, `guides/`, `implementation/`, `references/`
- Historical documents archived in `references/` with `archived-` prefix
- See `.cursor/rules/documentation-standards.md` for complete guidelines
