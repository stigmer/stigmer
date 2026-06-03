# Remote Stigmer MCP Server (mcp.stigmer.ai)

**Date**: June 3, 2026

## Summary

The Stigmer MCP server can now run as a hosted, network-reachable service at
`https://mcp.stigmer.ai`, deployed through Planton with the same split-repo
pattern as the web console. The built-in "Stigmer" marketplace entry now points
at this hosted endpoint over Streamable HTTP instead of spawning a local stdio
process. Authentication is deliberately provider-agnostic: the server forwards
the caller's `Authorization: Bearer` token unchanged to `stigmer-server`, so it
works with Stigmer API keys, Auth0 tokens, and bring-your-own-IdP org tokens
alike.

## Problem Statement

The MCP server already supported a Streamable HTTP transport in code, but there
was no hosted deployment of it. Using Stigmer's MCP tools from a remote MCP
client meant every user had to run the server locally over stdio.

### Pain Points

- No shared, always-on MCP endpoint for Stigmer resources.
- Remote MCP clients had no Stigmer server to point at.
- The built-in "Stigmer" seedpack entry only described the local stdio mode.

## Solution

Deploy the existing HTTP transport as a hosted Planton service and make the
built-in marketplace entry reference it. No new transport or auth code was
required — the server stays a stateless protocol bridge that passes the bearer
token through to `stigmer-server`, which performs all validation.

An OAuth bridge was explored but intentionally dropped: a single hardwired
authorization server (e.g. one Auth0 tenant) would only work for one identity
provider and would break orgs that bring their own IdP. Bearer passthrough keeps
the server issuer-agnostic.

## Implementation Details

- **Kustomize manifests (OSS repo):** `mcp-server/_kustomize/` with a
  `KubernetesDeployment` base plus `local` and `prod` overlays, mirroring
  `client-apps/web/_kustomize`. The `prod` overlay runs `STIGMER_MCP_TRANSPORT=http`,
  points `STIGMER_SERVER_ADDRESS` at the internal `stigmer-server` service
  (`$variables-group/stigmer-api/prod.kube-endpoint`), adds `/health` probes,
  and exposes `mcp.stigmer.ai` via ingress. The full env list is repeated in the
  prod overlay because the CRD has no merge-key schema and kustomize replaces the
  list wholesale.
- **Planton service (cloud repo):**
  `_ops/planton/service-hub/services/stigmer-mcp.yaml` builds `mcp-server/Dockerfile`
  via the platform pipeline into `ghcr.io/stigmer/stigmer/mcp-server` and deploys
  the kustomize overlay. Registered with `planton apply`.
- **Built-in marketplace entry:** `seedpack/mcp-servers/stigmer.yaml` now uses the
  `http` transport (`url: https://mcp.stigmer.ai`,
  `Authorization: Bearer ${STIGMER_API_KEY}`). The separate local stdio entry was
  removed so there is a single "Stigmer" server.
- **Docs:** `mcp-server/README.md` gained a "Hosted Remote Server" section, and
  the CLI reference (`stigmer mcp-server`) documents the hosted endpoint and the
  Claude Desktop OAuth-GUI caveat.

## Benefits

- A single always-on MCP endpoint any header-capable client can use.
- Works across all Stigmer identity providers without per-IdP configuration.
- Image build and deploy are owned by the existing Planton platform pipeline.

## Impact

- Stigmer agents referencing the built-in "Stigmer" MCP server now connect to
  the hosted HTTP endpoint (with a token) rather than spawning a local stdio
  process.
- Claude Desktop's OAuth-based "Add custom connector" GUI is not supported; use a
  client that accepts a manual `Authorization` header, or run locally over stdio.

## Related Work

- Mirrors the `stigmer-web` deployment pattern (OSS kustomize + cloud Planton
  service).

---

**Status**: ✅ Production Ready
