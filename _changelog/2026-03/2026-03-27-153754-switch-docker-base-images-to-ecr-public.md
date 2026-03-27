# Switch Docker Base Images to AWS ECR Public

**Date**: March 27, 2026

## Summary

Migrated all Docker base images from Docker Hub to AWS ECR Public (`public.ecr.aws`) across the agent-runner, workflow-runner, and web services. This eliminates Docker Hub's unauthenticated pull rate limits that were causing CI pipeline failures.

## Problem Statement

CI pipelines were failing during Docker image builds with `429 Too Many Requests` errors from Docker Hub's registry (`registry-1.docker.io`). Docker Hub enforces strict rate limits on unauthenticated pulls (100 pulls per 6 hours per IP), which are easily exhausted in CI environments with shared egress IPs.

### Pain Points

- Pipeline builds failing intermittently due to rate limiting
- No Docker Hub authentication configured in CI
- Failures masked real build issues, slowing down development velocity

## Solution

Replaced all Docker Hub image references with their AWS ECR Public equivalents. ECR Public mirrors official Docker Hub images under `public.ecr.aws/docker/library/` with significantly more generous rate limits (10 pulls/second unauthenticated), and the official nginx image is available at `public.ecr.aws/nginx/nginx`.

## Implementation Details

### agent-runner/Dockerfile (3 changes)

| Layer | Before | After |
|-------|--------|-------|
| Base builder | `python:3.11-slim` | `public.ecr.aws/docker/library/python:3.11-slim` |
| Runtime | `python:3.11-slim` | `public.ecr.aws/docker/library/python:3.11-slim` |
| Go toolchain (COPY --from) | `golang:1.25` | `public.ecr.aws/docker/library/golang:1.25` |

`ghcr.io/astral-sh/uv:latest` was already on GitHub Container Registry — no change needed.

### workflow-runner/Dockerfile (2 changes)

| Layer | Before | After |
|-------|--------|-------|
| Builder | `golang:1.25` | `public.ecr.aws/docker/library/golang:1.25` |
| Runtime | `alpine:3.19` | `public.ecr.aws/docker/library/alpine:3.19` |

### web/Dockerfile (2 changes)

| Layer | Before | After |
|-------|--------|-------|
| Builder | `node:22-alpine` | `public.ecr.aws/docker/library/node:22-alpine` |
| Runtime | `nginx:alpine` | `public.ecr.aws/nginx/nginx:alpine` |

### Not changed

- `backend/services/agent-runner/sandbox/Dockerfile.sandbox.full` — reference Dockerfile, not used in CI
- `backend/services/agent-runner/sandbox/Dockerfile.sandbox.basic` — reference Dockerfile, not used in CI
- stigmer-cloud — uses Bazel for OCI image builds, no Dockerfiles

## Benefits

- CI pipelines no longer blocked by Docker Hub rate limits
- No authentication tokens required for base image pulls
- ECR Public is backed by AWS infrastructure with high availability
- Zero functional change — identical images, different registry

## Impact

All three service Docker builds (agent-runner, workflow-runner, web) now pull from ECR Public. Existing image behavior, layers, and runtime characteristics are unchanged.

---

**Status**: ✅ Production Ready
