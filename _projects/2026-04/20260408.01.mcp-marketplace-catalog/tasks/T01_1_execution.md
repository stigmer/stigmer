# T01 Step 1 Execution: Schema Study & Marketplace Template

**Started**: 2026-04-08
**Status**: COMPLETE

## Schema Study Summary

Studied the McpServer resource defined across 6 proto files at
`apis/ai/stigmer/agentic/mcpserver/v1/` and the single existing seedpack entry
at `seedpack/mcp-servers/mcp-server-stigmer.yaml`.

### Proto files reviewed

| File | Purpose |
|------|---------|
| `api.proto` | Top-level `McpServer` and `McpServerList` messages |
| `spec.proto` | `McpServerSpec`, `StdioServerConfig`, `HttpServerConfig`, `ToolApprovalPolicy` |
| `status.proto` | `McpServerStatus`, `DiscoveredCapabilities`, `DiscoveredTool`, `DiscoveredResourceTemplate` |
| `io.proto` | `McpServerId`, `UpdateDiscoveredCapabilitiesInput`, `DiscoverCapabilitiesInput` |
| `command.proto` | Command RPC service |
| `query.proto` | Query RPC service |

### Key imported types

| Proto | Type | Used by |
|-------|------|---------|
| `environment/v1/spec.proto` | `EnvironmentSpec`, `EnvironmentValue` | `McpServerSpec.env_spec` |
| `commons/apiresource/metadata.proto` | `ApiResourceMetadata` | `McpServer.metadata` |

### Existing seedpack entry analysis (`mcp-server-stigmer.yaml`)

- System server identified by `stigmer.ai/system: "true"` label
- Uses `spec.tags` but not `metadata.tags` (tags not searchable — pre-existing gap)
- Omits `metadata.org` (auto-resolved from project manifest)
- Omits `metadata.slug` (auto-generated from name)
- No `icon_url` (system server, not displayed in marketplace)
- Has 6 `default_tool_approvals` for destructive Stigmer resource operations

---

## Confirmed Design Decisions

### 1. Naming: follow upstream, no "MCP Server" suffix

`metadata.name` uses whatever name the upstream source gives (repo name, registry
name). `metadata.slug` is omitted — auto-generated from name.

### 2. Org: omit, auto-resolved

`metadata.org` is omitted from marketplace YAMLs. The seedpack project manifest
(`stigmer.yaml`) declares `org: stigmer`, applied during bootstrap. Consistent
with the existing `mcp-server-stigmer.yaml`.

### 3. Tags: `metadata.tags` only, skip `spec.tags`

`metadata.tags` powers the FTS5 search index and search results (confirmed in
`backend/services/stigmer-server/pkg/query/search/extractor/mcpserver_extractor.go`).
`spec.tags` is only used for CLI display output — a secondary concern.

Marketplace entries populate only `metadata.tags`.

### 4. Labels: `stigmer.ai/category` for structured filtering

Single label per marketplace entry:

```yaml
labels:
  stigmer.ai/category: "<category>"
```

Category values:
- `developer` — GitHub, GitLab, Linear, Jira
- `database` — PostgreSQL, SQLite, MySQL, MongoDB
- `communication` — Slack, Discord, Gmail
- `productivity` — Notion, Google Drive, Google Calendar
- `cloud` — AWS, Kubernetes
- `observability` — Sentry
- `search` — Brave Search
- `utility` — Fetch, Puppeteer, Filesystem

### 5. Tests: deferred

`seedpack_test.go` updates deferred. Focus is on YAML definition quality.

---

## Marketplace YAML Template

Canonical template for all marketplace entries:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: <upstream-name>
  visibility: visibility_public
  labels:
    stigmer.ai/category: "<category>"
  tags:
    - <tag1>
    - <tag2>
spec:
  description: "<what it does — 1 sentence, purpose-driven>"
  icon_url: "<publicly accessible icon URL>"
  stdio:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-<name>"
  env_spec:
    data:
      ENV_VAR_NAME:
        is_secret: true
        description: "<what it is, format, required permissions/scopes>"
  default_tool_approvals:
    - tool_name: "<exact-tool-name>"
      message: "<action verb> {{args.key_param}}"
```

### Fields intentionally omitted

| Field | Reason |
|-------|--------|
| `metadata.slug` | Auto-generated from name |
| `metadata.org` | Auto-resolved from project manifest |
| `metadata.annotations` | No proven need; add later if marketplace UI consumes it |
| `spec.tags` | Using `metadata.tags` instead |
| `spec.default_enabled_tools` | Empty = all tools enabled; agents restrict per use case |
| `status` | System-managed, never set by users |

---

## Checklist: Marketplace-Ready Definition

### Structure
- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1`
- [ ] `kind` is exactly `McpServer`
- [ ] `metadata.name` matches upstream naming
- [ ] `metadata.visibility` is `visibility_public`
- [ ] Exactly one of `spec.stdio` or `spec.http` is set

### Quality
- [ ] `spec.description` is a clear, single sentence explaining purpose and primary use cases
- [ ] `spec.icon_url` points to a stable, publicly accessible image
- [ ] `metadata.tags` include 2-5 relevant search terms (lowercase, hyphenated)
- [ ] `metadata.labels.stigmer.ai/category` is set to exactly one category value
- [ ] No `stigmer.ai/system` label (reserved for built-in system servers)

### Credentials (env_spec)
- [ ] Every env var the server needs is declared
- [ ] `is_secret` is correctly classified for each var
- [ ] No `value` field set for secrets
- [ ] Descriptions specify format, required permissions/scopes, and where to get the credential

### Safety (default_tool_approvals)
- [ ] All destructive tools (delete, write, send) have approval policies
- [ ] Tool names verified against upstream documentation (or marked for post-discovery update)
- [ ] Approval messages use `{{args.field}}` placeholders, are specific, and use action verbs

### Exclusions
- [ ] No `metadata.slug` (auto-generated)
- [ ] No `metadata.org` (auto-resolved)
- [ ] No `spec.tags` (using `metadata.tags`)
- [ ] No `spec.default_enabled_tools` (all tools enabled by default)
- [ ] No `status` block

---

## Surprises Found During Execution

### 1. Positional-arg servers don't fit the marketplace model

PostgreSQL and Filesystem MCP servers take their core configuration (connection
URL, directory paths) as positional CLI args, not environment variables. The
agent-runner (`config_transformer.py`) passes `stdio.args` as-is — no `${VAR}`
interpolation. This means the YAML can't be parameterized per user.

**Decision**: Swapped PostgreSQL and Filesystem for Brave Search and Slack,
which use env vars exclusively. PostgreSQL/Filesystem moved to T02+ pending
a potential `${VAR}` interpolation feature in the agent-runner.

### 2. spec.tags vs metadata.tags — search only uses metadata.tags

The search indexer (`mcpserver_extractor.go`) only indexes `metadata.tags`.
`spec.tags` is only used in CLI display. The existing `mcp-server-stigmer.yaml`
only uses `spec.tags`, so its tags are not searchable. This pre-existing gap
is noted but out of scope for T01.

### 3. GitHub MCP server is deprecated upstream

The `@modelcontextprotocol/server-github` npm package has a deprecation notice —
development moved to `github/github-mcp-server`. The npm package still works
and is the canonical reference server. Can be updated in a future task.

---

## Files Created

| File | Description |
|------|-------------|
| `seedpack/mcp-servers/github.yaml` | GitHub MCP server (developer category) |
| `seedpack/mcp-servers/brave-search.yaml` | Brave Search MCP server (search category) |
| `seedpack/mcp-servers/slack.yaml` | Slack MCP server (communication category) |
| `seedpack/mcp-servers/CONTRIBUTING.md` | "Add a New Server" contributor guide |

## Validation Results

All 3 YAMLs pass `stigmer validate`:
```
✓ github.yaml: MCP Server is valid
✓ brave-search.yaml: MCP Server is valid
✓ slack.yaml: MCP Server is valid
```

Discovery (`stigmer discover`) deferred — requires running stigmer-server and
service credentials. Tool names verified against upstream npm README documentation.

## T01 Success Criteria Status

- [x] Catalog location decided — `seedpack/mcp-servers/`
- [x] 3 working McpServer YAMLs (GitHub, Brave Search, Slack)
- [~] Discovery run — validated via `stigmer validate`; live discovery deferred
- [x] "Add a New Server" contributor guide written
- [x] Ready to batch-produce T02-T04 definitions
