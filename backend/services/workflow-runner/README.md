# Workflow Runner

CNCF Serverless Workflow interpreter for Temporal, integrated into Stigmer.

## Overview

This service executes workflow definitions dynamically without requiring code deployment.
Based on [mrsimonemms/zigflow](https://github.com/mrsimonemms/zigflow).

Zigflow implements the [CNCF Serverless Workflow specification](https://github.com/serverlessworkflow/specification) 
on top of Temporal, enabling declarative workflow orchestration for AI agents and deterministic tasks.

## Build Strategy

**Note**: workflow-runner uses **Bazel builds** following Stigmer monorepo patterns. See [Build Strategy Guide](./docs/guides/build-strategy.md) for details.

## Quick Start

### Build

```bash
make build
# OR
go build ./cmd/worker
```

### Test

Two comprehensive test scripts cover all scenarios:

```bash
# Test 1: gRPC mode (direct execution)
./tools/test-grpc-mode.sh

# Test 2: Temporal mode (workflow execution)
./tools/test-temporal-mode.sh
```

### Run Locally (Docker)

```bash
docker build -t workflow-runner .
docker run --env-file .env workflow-runner
```

### Run Locally (Bazel)

**Note**: Requires a running Temporal server (see Temporal setup documentation).

```bash
# Run with example workflow (use absolute path)
bazel run //backend/services/workflow-runner:workflow_runner -- \
  --file $(pwd)/backend/services/workflow-runner/example-workflow.yaml \
  --temporal-address localhost:7233 \
  --temporal-namespace default

# Or run with a specific test workflow
bazel run //backend/services/workflow-runner:workflow_runner -- \
  --file $(pwd)/backend/services/workflow-runner/test/golden/01-operation-basic.yaml \
  --temporal-address localhost:7233 \
  --temporal-namespace default
```

**Quick Test** (validates workflow without Temporal):
```bash
bazel run //backend/services/workflow-runner:workflow_runner -- \
  --file $(pwd)/backend/services/workflow-runner/example-workflow.yaml \
  --validate
```

### Deploy to Dev

```bash
# Via Planton Service Hub
cd _kustomize/overlays/local
kustomize build . | kubectl apply -f -
```

## Documentation

**Complete documentation**: [docs/README.md](./docs/README.md)

**Quick Links:**
- [Quick Reference](./docs/getting-started/quick-reference.md) - Environment variables and common commands
- [Architecture Overview](./docs/architecture/overview.md) - Complete system architecture
- [Configuration Guide](./docs/getting-started/configuration.md) - Detailed configuration
- [Phase 1.5 Guide](./docs/guides/phase-1.5.md) - Implementation guide
- [Security Audit](./docs/references/security-audit.md) - Security considerations
- [Upstream Tracking](./docs/references/upstream-notes.md) - Changes from upstream Zigflow

## Configuration

The workflow-runner follows the same configuration pattern as stigmer-service:
- **Reuses `stigmer-temporal-config`** for Temporal connection settings
- **Direct values** in base for simple config (no unnecessary variables-group references)
- **Environment overlays** for local vs prod differences

Key environment variables:
- `TEMPORAL_SERVICE_ADDRESS`: From stigmer-temporal-config (external for local, kube-endpoint for prod)
- `TEMPORAL_NAMESPACE`: From stigmer-temporal-config (default)
- `WORKER_TASK_QUEUE`: `zigflow-tasks` (direct value)
- `MAX_CONCURRENT_ACTIVITIES`: `50` (direct value)
- `MAX_CONCURRENT_WORKFLOW_TASKS`: `10` (direct value)

See [Configuration Guide](./docs/getting-started/configuration.md) for detailed configuration.

## Golden Test Suite

Run comprehensive CNCF workflow tests:

```bash
make golden-tests
```

Tests cover all CNCF state types:
- Operation (function calls)
- Switch (conditional branching)
- ForEach (loops)
- Parallel (concurrent execution)
- Event (external signals)
- Sleep (delays)
- Inject (data transformation)

## Architecture

Zigflow uses the **Interpreter Pattern** to execute CNCF workflows dynamically:

1. Parse YAML workflow definition
2. Build internal state machine
3. Execute as Temporal workflow
4. Invoke activities for non-deterministic operations

Key advantage: Change workflows without redeploying code.

## Claim Check Pattern (Phase 2)

**Status**: Core Infrastructure Complete ✅

The Claim Check pattern prevents Temporal payload overflow errors when AI agents generate massive contexts (100K+ tokens ≈ 400KB).

### How It Works

Large activity outputs are automatically:
1. **Compressed** with gzip (70%+ compression on text)
2. **Uploaded** to Cloudflare R2 storage
3. **Replaced** with lightweight references in workflow state
4. **Retrieved** automatically when needed by next activity

```yaml
# Activity generates 400KB result
states:
  - name: research
    type: operation
    actions:
      - functionRef: research_agent  # Returns 400KB
    
  - name: analyze
    type: operation
    actions:
      - functionRef: analyst_agent   # Receives 400KB ✅
        arguments:
          input: "${.research.output}"  # Reference auto-resolved
```

### Configuration

```bash
# Enable Claim Check
CLAIMCHECK_ENABLED=true
CLAIMCHECK_THRESHOLD_BYTES=51200  # 50KB

# Cloudflare R2 Configuration
R2_BUCKET=your-bucket-name
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
```

### Documentation

- [Architecture Guide](./docs/architecture/claimcheck.md) - Detailed design and data flow
- [Package README](./pkg/claimcheck/README.md) - API reference and usage
- [Implementation Summary](./docs/implementation/claimcheck.md) - Current status

### Performance

- **Upload**: <500ms for 1MB payload
- **Download**: <200ms for 1MB payload  
- **Compression**: 70%+ for text payloads
- **Total Overhead**: <1 second per large payload

**Benefits**:
- ✅ Supports payloads up to 10MB+
- ✅ Temporal history stays under 50KB
- ✅ Zero egress fees (Cloudflare R2)
- ✅ Transparent to workflow logic

## Integration with Stigmer

Zigflow is the execution engine for Stigmer's workflow orchestration:

- **Phase 1** ✅ Complete: Stable fork with security validation
- **Phase 2** 🚧 In Progress: Claim Check pattern for large AI payloads (Core complete, integration pending)
- **Phase 3** (Planned): AI task primitives (agents, vector DB, prompts)
- **Phase 4** (Planned): Stigmer DSL compiler integration

## Documentation Guidelines

When adding or updating documentation, please follow the monorepo guidelines in [docs/documentation-guidelines.md](../../../docs/documentation-guidelines.md).

**Key points:**
- All docs go in `docs/` folder (organized by category)
- Use lowercase filenames with hyphens
- Test scripts go in `tools/` folder (not root)
- Update `docs/README.md` when adding new docs

## Team Contacts

- **Project Owner**: Suresh Donepudi
- **Questions**: #stigmer-engineering Slack channel

## License

Apache 2.0 (inherited from upstream Zigflow)

