# Remove Stigmer Service from Infrastructure Stack

**Date**: March 23, 2026

## Summary

Removed the stigmer-service Kubernetes deployment from the infrastructure stack Helm chart. The service deployment template and all associated configuration parameters have been deleted from the chart's default values and the production override file, decoupling the application service lifecycle from the infrastructure provisioning pipeline.

## Problem Statement

The stigmer-service was bundled into the infrastructure stack chart alongside foundational components (PostgreSQL, MongoDB, Redis, Temporal, OpenFGA). This tight coupling meant any change to the service (image tag, resource limits, replica count) required an infrastructure stack deployment, and infrastructure changes risked unintended service redeployments.

### Pain Points

- Service release cadence was locked to infrastructure provisioning cadence
- Risk of accidental service disruption during infrastructure-only changes
- Unclear separation of concerns between platform infrastructure and application workloads

## Solution

Cleanly remove all stigmer-service artifacts from the infrastructure stack chart:

1. Delete the `stigmer-service.yaml` deployment template
2. Remove all `service_*` parameters from the chart's `values.yaml`
3. Remove all `service_*` parameters from the production `prod.yaml` override

## Implementation Details

**Deleted file:**
- `_ops/planton/infra-hub/infra-charts/stigmer-infrastructure-stack/templates/stigmer-service.yaml` — 109-line KubernetesDeployment manifest including container spec, environment variables, secrets references, resource limits, and ingress port configuration.

**Modified files:**
- `_ops/planton/infra-hub/infra-charts/stigmer-infrastructure-stack/values.yaml` — removed 8 parameters: `service_image_repository`, `service_image_tag`, `service_version`, `service_replicas`, `service_cpu_request`, `service_cpu_limit`, `service_memory_request`, `service_memory_limit`.
- `_ops/planton/infra-hub/infra-project/prod.yaml` — removed the same 8 production-override parameters.

## Benefits

- Infrastructure stack changes no longer risk touching the service deployment
- Service can be deployed independently with its own release cadence
- Cleaner separation of infrastructure-as-code concerns

## Impact

- **Infrastructure stack chart**: No longer provisions the stigmer-service workload
- **Service deployment**: Must be managed through a separate deployment mechanism going forward
- **Existing production deployment**: The running service is unaffected until the next infrastructure stack apply

---

**Status**: ✅ Production Ready
