# Fix Infrastructure Stack Slug Validation and R2 Bucket Serialization

**Date**: March 21, 2026

## Summary

Fixed two deployment failures in the Stigmer infrastructure stack: added the required `slug` metadata field to all 10 resource templates, and chained the three Cloudflare R2 bucket resources with `depends_on` relationships to prevent Pulumi state lock conflicts during parallel provisioning.

## Problem Statement

The infrastructure stack deployment was failing at two points, preventing any infrastructure changes from being applied.

### Pain Points

- Every resource template was missing the `slug` metadata field, causing Planton API validation to reject them before IaC operations could begin ("INVALID_ARGUMENT: Input validation failed: slug -- value is required")
- The three R2 buckets (claim-check, skill-artifacts, agent-execution-artifacts) deployed in parallel, causing concurrent Pulumi `pulumi up` operations to compete for the same Cloudflare state backend lock ("the stack is currently locked")

## Solution

Two targeted fixes applied across all infrastructure stack templates:

1. Added `slug` field (matching `name`) to all 10 resource templates, consistent with the convention used by `organization.yaml`, `environment.prod.yaml`, and all service-hub resources.
2. Chained R2 buckets sequentially via explicit `depends_on` relationships: claim-check -> skill-artifacts -> agent-execution-artifacts.

## Implementation Details

### Slug Field Addition (10 files)

Every template in `_ops/planton/infra-hub/infra-charts/stigmer-infrastructure-stack/templates/` received a `slug` field placed directly after `name` in `metadata`, matching the established codebase convention:

- `namespace.yaml` -- `slug: {{ values.org }}-{{ values.env }}-namespace`
- `postgres.yaml` -- `slug: {{ values.org }}-{{ values.env }}-postgres`
- `mongo.yaml` -- `slug: {{ values.org }}-{{ values.env }}-mongo-database`
- `redis.yaml` -- `slug: {{ values.org }}-{{ values.env }}-redis`
- `temporal.yaml` -- `slug: {{ values.org }}-{{ values.env }}-temporal`
- `openfga.yaml` -- `slug: {{ values.org }}-{{ values.env }}-fga`
- `r2-bucket.yaml` -- `slug: {{ values.org }}-{{ values.env }}-claimcheck-r2-bucket`
- `r2-bucket-skill-artifacts.yaml` -- `slug: {{ values.org }}-{{ values.env }}-skill-artifacts-r2-bucket`
- `r2-bucket-agent-execution-artifacts.yaml` -- `slug: {{ values.org }}-{{ values.env }}-agent-execution-artifacts-r2-bucket`
- `stigmer-service.yaml` -- `slug: stigmer-service`

### R2 Bucket Serialization (2 files + dependency doc)

Added `metadata.relationships` with `depends_on` entries:

- `r2-bucket-skill-artifacts.yaml` depends on `claimcheck-r2-bucket`
- `r2-bucket-agent-execution-artifacts.yaml` depends on `skill-artifacts-r2-bucket`

Updated `dependencies.md` with the new DAG, revised deployment phases, and documentation explaining why R2 buckets are serialized.

## Benefits

- Infrastructure stack can now pass Planton API validation and proceed to IaC operations
- R2 buckets deploy sequentially, eliminating Pulumi state lock contention
- Dependency documentation accurately reflects the actual deployment graph
- Consistent metadata conventions across infra-hub and service-hub resources

## Impact

- **Infrastructure deployments**: Unblocked -- the stack can now be deployed end-to-end
- **R2 bucket provisioning**: Reliable -- no more lock contention failures
- **Codebase consistency**: All Planton resource templates now follow the same `slug` convention

## Related Work

- Previous dependency documentation in `dependencies.md` (January 8, 2026)
- Service-hub resources already had `slug` -- this brings infra-hub templates to parity

---

**Status**: Production Ready
**Timeline**: Single session
