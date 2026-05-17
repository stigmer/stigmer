# Migrate KubernetesDeployment env vars from map to array format

**Date**: May 16, 2026

## Summary

Converted all `variables` and `secrets` fields in KubernetesDeployment service.yaml files from the map format (`KEY: {value: ...}`) to the Planton-standard array format (`- name: KEY, value: ...`). This aligns with the latest Planton CLI expectations and fixes `dot-env` generation failures.

## Problem Statement

Running `planton service dot-env --env local` for stigmer-service failed with:

```
Expected an array for secrets but found {map}
```

The Planton backend now requires `variables` and `secrets` under `spec.container.app.env` to be arrays of `{name, value}` objects, matching the format used in Planton's own service deployments.

### Pain Points

- Local development was blocked — `dot-env` generation failed for stigmer-service
- All three services (stigmer-service, agent-runner, workflow-runner) used the outdated map format

## Solution

Converted all nine `_kustomize/**/service.yaml` files across both repos from map format to array format, matching the reference implementation in the Planton monorepo.

## Implementation Details

**Format change** applied to `variables` and `secrets` sections:

```yaml
# Before (map format)
variables:
  MONGO_DB_HOST:
    value: $variables-group/stigmer-mongodb-config/prod.host

# After (array format)
variables:
  - name: MONGO_DB_HOST
    value: $variables-group/stigmer-mongodb-config/prod.host
```

**Files changed in stigmer repo** (6 files):
- `backend/services/agent-runner/_kustomize/base/service.yaml`
- `backend/services/agent-runner/_kustomize/overlays/prod/service.yaml`
- `backend/services/agent-runner/_kustomize/overlays/local/service.yaml`
- `backend/services/workflow-runner/_kustomize/base/service.yaml`
- `backend/services/workflow-runner/_kustomize/overlays/prod/service.yaml`
- `backend/services/workflow-runner/_kustomize/overlays/local/service.yaml`

**Files changed in stigmer-cloud repo** (3 files):
- `backend/services/stigmer-service/_kustomize/base/service.yaml`
- `backend/services/stigmer-service/_kustomize/overlays/prod/service.yaml`
- `backend/services/stigmer-service/_kustomize/overlays/local/service.yaml`

## Benefits

- Unblocks local development with `planton service dot-env`
- Aligns with the Planton platform's current schema expectations
- Consistent format across all three services

## Impact

All deployment configurations for stigmer-service, agent-runner, and workflow-runner are updated. No functional changes to the services themselves — only the YAML structure that Planton reads.

---

**Status**: ✅ Production Ready
