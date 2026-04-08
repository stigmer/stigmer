# Task T01: MCP Marketplace Catalog — Full Plan

**Created**: 2026-04-08
**Status**: APPROVED
**Type**: Feature Development

## Decisions Made

- **Catalog location**: `seedpack/mcp-servers/` in the stigmer OSS repo (existing directory).
- **Why OSS, not stigmer-cloud**: The catalog is curated metadata for publicly available MCP servers — it's a growth lever, not a revenue lever. Industry precedent (Terraform Registry, Helm charts, Grafana plugins) shows catalogs belong in open source. Cloud value comes from operations: hosted marketplace UI, managed lifecycle, enterprise governance, analytics, RBAC, audit, SSO.
- **Why seedpack, not a new directory**: Seedpack entries are embedded in the CLI binary and auto-applied on bootstrap via `stigmer apply`. Catalog entries are just metadata (they don't install or run anything until a user activates a server and provides credentials). A populated marketplace on day one is better UX than an empty one. The directory name `mcp-servers/` matches the resource kind (`McpServer`), consistent with `agents/`, `skills/`, `organizations/`.
- **System vs marketplace differentiation**: The existing `mcp-server-stigmer.yaml` carries `stigmer.ai/system: "true"`. New marketplace entries omit this label. The UI/CLI uses this label to distinguish built-in system servers from user-installable marketplace offerings.

## Context

Stigmer currently ships a single McpServer definition in the seedpack (`mcp-server-stigmer`). The marketplace is empty beyond that. Platform builders who adopt Stigmer need ready-to-use MCP server integrations so they can deliver immediate value — users should only need to bring their own credentials (API keys) and skills.

The MCP ecosystem already has 200+ open-source servers published as npm/PyPI packages. We don't need to build MCP server implementations — we need to create well-crafted **McpServer YAML resource definitions** that point to them.

### Key resources discovered

| Source | What it provides | URL |
|--------|-----------------|-----|
| Official MCP Registry | REST API with server metadata (name, package, env vars, transport) | `registry.modelcontextprotocol.io` |
| `modelcontextprotocol/servers` repo | Reference implementations (MIT/Apache) | github.com/modelcontextprotocol/servers |
| npm / PyPI | Actual server packages that our YAMLs point to | npmjs.com / pypi.org |

---

## Task Breakdown

### T01: Create First 3 Definitions and Establish the Pattern (this task)

**Goal**: Prove the pattern works end-to-end with 3 real McpServer YAMLs.

1. **Study the existing `mcp-server-stigmer.yaml` and proto schema**
   - Understand the exact YAML structure and all available fields
   - Identify the minimum viable fields for a marketplace-ready definition
   - Document the "good McpServer definition" checklist

2. **Research each server's actual package, env vars, and tools**
   - Check the MCP Registry API, npm pages, and GitHub READMEs
   - Identify exact env var names, required vs optional, and where to get credentials
   - Identify destructive/sensitive tools that need approval prompts

3. **Write the first 3 McpServer YAMLs** in `seedpack/mcp-servers/`
   - **GitHub** — `npx -y @modelcontextprotocol/server-github` (reference server, most popular)
   - **Filesystem** — `npx -y @modelcontextprotocol/server-filesystem` (reference server, simple)
   - **PostgreSQL** — `npx -y @modelcontextprotocol/server-postgres` (reference server, database)
   - Each must have: description, icon_url, tags, stdio config, env_spec, default_tool_approvals
   - No `stigmer.ai/system` label (marketplace entries, not system servers)

4. **Run `stigmer discover` on each** to populate discovered_capabilities
   - This validates the YAML works end-to-end
   - May need a local test environment for some servers

5. **Document the "Add a New Server" workflow**
   - Step-by-step for contributors
   - Where to find MCP servers (registry, npm, GitHub)
   - Required fields and quality bar

### T02: Tier 1 Servers — Developer Tools & Databases

Write McpServer YAMLs for the highest-value developer-facing servers:

| Server | Package | Category |
|--------|---------|----------|
| GitLab | `npx -y @modelcontextprotocol/server-gitlab` | Developer |
| Linear | npm community server | Developer |
| Jira | npm community server | Developer |
| SQLite | `npx -y @modelcontextprotocol/server-sqlite` | Database |
| MySQL | npm community server | Database |
| MongoDB | npm community server | Database |

### T03: Tier 1 Servers — Communication & Productivity

| Server | Package | Category |
|--------|---------|----------|
| Slack | `npx -y @modelcontextprotocol/server-slack` | Communication |
| Discord | npm community server | Communication |
| Gmail | npm community server | Communication |
| Notion | npm community server | Productivity |
| Google Drive | `npx -y @modelcontextprotocol/server-gdrive` | Productivity |
| Google Calendar | npm community server | Productivity |

### T04: Tier 1 Servers — Cloud, Observability & Utility

| Server | Package | Category |
|--------|---------|----------|
| AWS | npm community server | Cloud |
| Kubernetes | npm community server | Cloud |
| Sentry | `npx -y @modelcontextprotocol/server-sentry` | Observability |
| Brave Search | `npx -y @modelcontextprotocol/server-brave-search` | Search |
| Fetch | `npx -y @modelcontextprotocol/server-fetch` | Utility |
| Puppeteer | `npx -y @modelcontextprotocol/server-puppeteer` | Browser |

### T05: Registry Sync Exploration (optional / stretch)

- Explore the MCP Registry API (`GET /v0.1/servers`)
- Map `server.json` schema to `McpServer` YAML
- Prototype a script that generates YAML stubs from registry data
- Evaluate if this should be automated or remain manual curation

---

## What a Good McpServer YAML Looks Like

Based on the existing `mcp-server-stigmer.yaml` and the proto schema:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: <human-readable-name>          # e.g., "GitHub MCP Server"
  slug: <url-friendly-slug>            # e.g., "github"
  visibility: visibility_public
  labels:
    stigmer.ai/category: "<category>"  # developer, database, communication, etc.
spec:
  description: "<what it does and primary use cases>"
  icon_url: "<publicly accessible icon URL>"
  tags:
    - <tag1>
    - <tag2>
  stdio:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-<name>"
  env_spec:
    data:
      API_KEY_OR_TOKEN:
        is_secret: true
        description: "<clear description of what this key is and where to get it>"
  default_tool_approvals:
    - tool_name: "<destructive-tool>"
      message: "<human-readable approval prompt with {{args.*}} placeholders>"
```

---

## Success Criteria for T01

- [x] Catalog location decided — `seedpack/mcp-servers/` in stigmer OSS repo
- [ ] 3 working McpServer YAMLs (GitHub, Filesystem, PostgreSQL)
- [ ] Discovery run on at least 1 server to validate capabilities population
- [ ] "Add a New Server" contributor guide written
- [ ] Ready to batch-produce T02-T04 definitions

## Risks

| Risk | Mitigation |
|------|-----------|
| MCP Registry API is in preview, may change | Use it for discovery/research, but don't hard-depend on it for catalog generation |
| Some servers need Node.js/Python runtime | Document runtime requirements in env_spec description |
| Server tool sets change across versions | Pin package versions in YAML, re-run discovery periodically |
| Discovery requires actual credentials for some servers | Use `--dry-run` mode or mock env where possible; document which servers need live credentials |
