# Blog Post: Infrastructure Stack Defined as Plain YAML

**Date**: April 4, 2026

## Summary

Published the second engineering blog post on stigmer.ai — a deep-dive into how the production infrastructure (9 components across GKE and Cloudflare) is defined, deployed, and managed from a single directory of short YAML templates using Planton.

## Problem Statement

The first blog post ("Write Once, Render Everywhere") covered the demo video pipeline. The engineering blog had only one post, covering one aspect of the platform. The infrastructure setup — how nine production components are defined as parameterized YAML templates with dependency-aware deployment — is a distinct engineering story worth sharing.

### Pain Points

- The engineering blog had only one post, giving a narrow view of the platform's engineering depth
- The infrastructure architecture (template/values split, DAG-based deployment, multi-cloud resource model) was undocumented outside of internal files
- No public content explained how the platform manages production infrastructure

## Solution

A narrative-driven blog post that walks through the infrastructure directory structure, shows real YAML templates from the codebase, explains the dependency graph, and demonstrates the tuning and deployment workflow.

## Implementation Details

### Blog Post Structure

The post (`blog/infrastructure-as-yaml.mdx`) follows 8 sections:

1. **Opening hook** — establishes the 9-component, 2-cloud-provider scope
2. **What we run** — names every component and its role in the platform
3. **The layout** — shows the `infra-charts` / `infra-project` directory split
4. **What a template looks like** — real namespace and PostgreSQL templates with pattern callouts (parameterization, `value_from` dependencies, database provisioning)
5. **Multi-cloud in one model** — Kubernetes and Cloudflare R2 resources side by side
6. **The dependency graph** — mermaid DAG diagram with deployment phases and the R2 serialization story
7. **Tuning from one file** — `prod.yaml` excerpt showing single-line parameter changes
8. **The deployment workflow** — two-command publish + install workflow

### Content Approach

- All code snippets are real YAML from `stigmer-cloud/_ops/planton/infra-hub/`
- Planton is mentioned naturally (it is the tool) without promotional framing
- No mention of team size — framing is engineering discipline, not resource constraints
- Mermaid dependency DAG diagram included
- Sensitive content check: no secrets in any shown YAML (credentials use `secretRef` indirection)

## Benefits

- **Engineering visibility**: Second blog post demonstrates infrastructure competence alongside the demo pipeline post
- **Genuine Planton feedback**: Shows the tool through concrete examples without promotional language
- **Documentation by example**: The templates shown in the post serve as real documentation of the production stack
- **Blog momentum**: Engineering blog now covers two distinct engineering domains (frontend pipeline, infrastructure)

## Impact

- **Blog content**: Second post on stigmer.ai engineering blog
- **Content diversity**: Covers backend infrastructure, complementing the frontend-focused first post
- **No infrastructure changes**: Blog post only — no changes to routes, navigation, or blog collection config

## Related Work

- `2026-04-04-160327-engineering-blog-and-demo-pipeline-post.md` — First blog post and blog infrastructure setup

---

**Status**: ✅ Production Ready
**Timeline**: Single session
