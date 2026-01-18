# Zigflow Worker Configuration Guide

## Overview

The workflow-runner follows the same configuration pattern as stigmer-service, using:
- **Base configuration**: Minimal, with sensible defaults
- **Overlays**: Environment-specific overrides (local, prod)
- **Existing variables-groups**: Reuses stigmer-temporal-config

## Configuration Structure

### Base (`_kustomize/base/service.yaml`)

Contains minimal configuration with prod values as defaults:
- Uses `stigmer-temporal-config` for Temporal connection
- Direct values for worker settings (no variables-group needed)
- Minimal resources (50m CPU, 100Mi memory)
- 1 replica by default

### Local Overlay (`_kustomize/overlays/local/service.yaml`)

For local development:
- Uses **external endpoint** for Temporal (`prod.external-endpoint`)
- Debug logging enabled
- Same minimal resources as base

### Prod Overlay (`_kustomize/overlays/prod/service.yaml`)

For production deployment:
- Uses **internal Kubernetes endpoint** (`prod.kube-endpoint`)
- Higher resources (60m-2 CPU, 100Mi-2Gi memory)
- 3 replicas minimum with autoscaling (up to 10)
- Health probes (readiness, liveness, startup)
- Zero-downtime deployment strategy
- Pod disruption budget

## Environment Variables

### Temporal Configuration

**From stigmer-temporal-config variables-group:**
- `TEMPORAL_SERVICE_ADDRESS`: Uses existing temporal-config
  - Base: `stigmer-temporal-config/prod.host`
  - Local: `stigmer-temporal-config/prod.external-endpoint`
  - Prod: `stigmer-temporal-config/prod.kube-endpoint`
- `TEMPORAL_NAMESPACE`: Uses `stigmer-temporal-config/namespace` (default)

### Workflow Configuration

**Direct values in base:**
- `WORKFLOW_FILE`: Path to the workflow YAML file
  - Base/Prod: `/app/workflows/workflow.yaml`
  - Local: `/app/test/golden/01-operation-basic.yaml` (for testing)

### Worker Configuration

**Direct values in base (no variables-group):**
- `WORKER_TASK_QUEUE`: `"zigflow-tasks"`
- `MAX_CONCURRENT_ACTIVITIES`: `"50"`
- `MAX_CONCURRENT_WORKFLOW_TASKS`: `"10"`

### Logging

**Direct values in base:**
- `LOG_LEVEL`: `info` (base), `debug` (local)
- `LOG_FORMAT`: `json`

### OpenTelemetry

**Direct values in base:**
- `OTEL_SERVICE_NAME`: `workflow-runner`
- `OTEL_METRICS_EXPORTER`: `none`
- `OTEL_LOGS_EXPORTER`: `none`
- `OTEL_EXPORTER_OTLP_TRANSPORT`: `grpc` (base), `http` (local)

## Why This Structure?

### Reuse Existing Temporal Config

Instead of duplicating temporal configuration in `zigflow-config.yaml`, we reuse the existing `stigmer-temporal-config` which already has:
- Namespace configuration
- Host endpoints (internal/external)
- Port configuration

This eliminates duplication and maintains a single source of truth.

### Simple Values Directly in Base

Values like `MAX_CONCURRENT_ACTIVITIES`, `LOG_LEVEL`, etc. are directly in the kustomize base because:
- They don't change per environment (or have simple overrides)
- No need to jump to variables-group to see/change them
- Reduces complexity and indirection
- Easy to override in overlays if needed

### Environment-Specific Endpoints

- **Local development**: Uses external endpoints to connect from local machine to cluster
- **Production**: Uses internal Kubernetes service endpoints for faster, secure communication

## Comparison with stigmer-service

The workflow-runner now follows the exact same pattern as stigmer-service:

| Aspect | stigmer-service | workflow-runner |
|--------|----------------|----------------|
| Base config | Minimal, prod defaults | ✅ Same |
| Temporal config | Uses stigmer-temporal-config | ✅ Same |
| Simple values | Direct in base | ✅ Same |
| Local overlay | External endpoints | ✅ Same |
| Prod overlay | Kube endpoints, health probes | ✅ Same |
| Variables-group | Only for shared config | ✅ Same |

## Deployment

```bash
# Local development
cd backend/services/workflow-runner/_kustomize/overlays/local
kustomize build . | kubectl apply -f -

# Production
cd backend/services/workflow-runner/_kustomize/overlays/prod
kustomize build . | kubectl apply -f -
```

## Future Configuration

If zigflow-specific configuration is needed in the future (e.g., zigflow-specific feature flags), add them to `stigmer-zigflow-config` variables-group. For now, it's mostly empty as we reuse existing configuration.

