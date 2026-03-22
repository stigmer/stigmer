# Stigmer SDK Documentation

Complete documentation index for the Stigmer SDK project.

## Overview

The Stigmer SDK provides language-specific SDKs for defining Agent blueprints. This repository contains:

- **Go SDK** - Production-ready Go SDK (`go/`)
- **Python SDK** - Python SDK (`python/`)
- **Shared Proto Contract** - Via Buf Schema Registry (`buf.build/leftbin/stigmer`)

## Quick Links

- **Root README**: [../README.md](../README.md) - Project overview
- **Go SDK README**: [../go/README.md](../go/README.md) - Go SDK documentation
- **Python SDK README**: [../python/README.md](../python/README.md) - Python SDK documentation

## Guides

### Agent and Skill SDK
- [Agent and Skill Struct-Based Args API](./guides/agent-skill-struct-args-api.md) - Complete guide to creating agents and skills using Pulumi-style struct args pattern (2026-01-24)

### Workflow SDK
- [Workflow Fluent API Guide](./guides/workflow-fluent-api.md) - Comprehensive guide to using the Pulumi-style fluent API with functional options pattern for building workflows (2026-01-22)

## Implementation Reports

### Template System
- [Init Template GitHub API Migration](./implementation/init-template-github-api-migration.md) - Migrated `stigmer init` template from JSONPlaceholder to GitHub API (2026-01-18)

### Buf Migration
- [Buf Migration Complete](./implementation/buf-migration-complete.md) - Migration from GitHub to Buf Schema Registry (2026-01-13)

## Language-Specific Documentation

### Go SDK
See [go/docs/README.md](../go/docs/README.md) for Go-specific documentation.

### Python SDK
See [python/docs/README.md](../python/README.md) for Python-specific documentation.

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines.

## License

See [LICENSE](../LICENSE) for license information.
