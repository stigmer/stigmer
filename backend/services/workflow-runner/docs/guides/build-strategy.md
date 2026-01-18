# Zigflow Worker Build Strategy

## Current Approach: Bazel Build (Integrated)

The workflow-runner now uses **Bazel build** following the same pattern as other services in the Stigmer monorepo, with Go-specific rules.

### Why Bazel Now?

1. **Unified Build System**: 
   - Stigmer monorepo uses **Bazel** for all services
   - The root pipeline (`stigmer-java-backend-service-pipeline`) supports both Java and Go
   - Consistent build experience across all services

2. **Go + Bazel Integration**:
   - Planton repositories already use `rules_go` successfully
   - Stigmer can leverage the same patterns
   - BUILD.bazel provides:
     - Hermetic builds
     - Dependency caching
     - Reproducible builds
     - Integration with OCI image rules

3. **Reference Implementation**:
   - Planton Cloud monorepo has Go services with Bazel
   - project-planton CLI uses `rules_go` + `gazelle`
   - Proven pattern we can follow

### Current Pipeline Configuration

**Service Definition** (`_ops/planton/service-hub/services/workflow-runner.yaml`):
```yaml
pipelineConfiguration:
  pipelineProvider: self
  tektonPipelineYamlFile: .planton/pipeline.yaml
  params:
    service-name: workflow-runner
```

This uses the **root Bazel pipeline** (`.planton/pipeline.yaml`) which:
- Clones the repository
- Builds using Bazel: `//backend/services/workflow-runner:workflow_runner_image`
- Pushes using Bazel: `//backend/services/workflow-runner:workflow_runner_push`
- Same pipeline used by stigmer-service

### Comparison with stigmer-service

| Aspect | stigmer-service | workflow-runner |
|--------|----------------|----------------|
| Language | Java | Go |
| Build System | Bazel | Bazel |
| Pipeline | stigmer-java-backend-service-pipeline | stigmer-java-backend-service-pipeline |
| BUILD.bazel | ✅ Required | ✅ Required |
| Dockerfile | ❌ Not used | ✅ Kept for local dev |

### BUILD.bazel Structure

The workflow-runner BUILD.bazel follows Planton patterns:

```bazel
# Go library with all source code
go_library(
    name = "workflow_runner_lib",
    srcs = glob(["cmd/**/*.go", "pkg/**/*.go"]),
    importpath = "github.com/leftbin/stigmer-cloud/backend/services/workflow-runner",
    deps = [
        # External dependencies from go.mod
        "@com_github_spf13_cobra//:cobra",
        "@io_temporal_go_sdk//client",
        # ... more deps
    ],
)

# Binary target
go_binary(
    name = "workflow_runner",
    embed = [":workflow_runner_lib"],
)

# OCI image
oci_image(
    name = "workflow_runner_image",
    base = "@alpine_linux_amd64",
    entrypoint = ["/app/workflow_runner"],
    tars = [":workflow_runner_binary_layer"],
)

# Push to registry
oci_push(
    name = "workflow_runner_push",
    image = ":workflow_runner_image",
    repository = "ghcr.io/leftbin/stigmer-cloud/backend/services/workflow-runner",
)
```

### Bazel + Go.mod Coexistence

- **go.mod**: Kept for local development (`go build`, `go run`)
- **BUILD.bazel**: Used for CI/CD and production builds
- **Dependencies**: Managed by Bazel's MODULE.bazel (or WORKSPACE)
- **Gazelle**: Can auto-generate BUILD files from go.mod if needed

### Build Commands

```bash
# Local development (Go tooling)
cd backend/services/workflow-runner
go build ./cmd/worker
make build

# Bazel build (production)
cd ~/scm/github.com/leftbin/stigmer
bazel build //backend/services/workflow-runner:workflow_runner
bazel build //backend/services/workflow-runner:workflow_runner_image

# Bazel push (CI/CD)
bazel run //backend/services/workflow-runner:workflow_runner_push --stamp --define TAG=v1.0.0

# Via Planton (production)
# Automatically triggered on push to main
# Uses root .planton/pipeline.yaml
```

### CI/CD Flow

```mermaid
flowchart LR
    A[Push to main] --> B[Planton Service Hub]
    B --> C[stigmer-java-backend-service-pipeline]
    C --> D[Clone repo]
    D --> E[Bazel build image]
    E --> F[Bazel push to GHCR]
    F --> G[Kustomize build]
    G --> H[Deploy to K8s]
```

## Conclusion

The workflow-runner now uses **Bazel build** following the same pattern as other Stigmer services. This provides:

- ✅ **Unified build system** across Java and Go services
- ✅ **Hermetic, reproducible builds**
- ✅ **Dependency caching** for faster builds
- ✅ **Same CI/CD pipeline** as stigmer-service
- ✅ **OCI image rules** for container packaging
- ✅ **Proven pattern** from Planton Cloud repositories

The Dockerfile is kept for local development convenience, but production builds use Bazel.

