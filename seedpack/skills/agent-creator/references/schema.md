# Agent YAML Schema Reference

Canonical field reference derived from `ai/stigmer/agentic/agent/v1` proto definitions.

## Document Structure

```yaml
apiVersion: agentic.stigmer.ai/v1   # REQUIRED — exact string
kind: Agent                          # REQUIRED — exact string
metadata:                            # REQUIRED
  name: <string>                     # REQUIRED — human-readable name
  slug: <string>                     # optional — auto-generated from name if omitted
  org: <string>                      # recommended — org slug (e.g., "default", "acme-corp")
  visibility: <enum>                 # optional — visibility_private (default) | visibility_public
  labels: {key: value}               # optional — filtering metadata
  annotations: {key: value}          # optional — non-filtering metadata
  tags: [string]                     # optional — categorization strings
spec:                                # REQUIRED
  description: <string>              # recommended — 1-2 sentence summary for UI/marketplace
  icon_url: <string>                 # optional — publicly accessible image URL
  instructions: <string>             # REQUIRED — min 10 chars, system prompt (use | block scalar)
  mcp_server_usages: []              # optional — MCP server tool integrations
  skill_refs: []                     # optional — skill knowledge references
  sub_agents: []                     # optional — inline delegated sub-agents
  env: {}                             # optional — environment variable declarations
```

## metadata

| Field | Required | Format | Notes |
|---|---|---|---|
| `name` | yes | any string | Human-readable display name |
| `slug` | no | `^[a-z][a-z0-9-]*$`, 1-63 chars | Auto-generated from name if omitted |
| `org` | recommended | `^[a-z][a-z0-9-]*$` | Defaults to CLI context org if omitted |
| `visibility` | no | `visibility_private` or `visibility_public` | Private by default |
| `labels` | no | map<string,string> | For filtering |
| `annotations` | no | map<string,string> | For non-filtering metadata |
| `tags` | no | list of strings | For search/categorization |

## spec.instructions

- **Type**: string, block scalar recommended (`|`)
- **Validation**: minimum 10 characters (proto-enforced)
- **Purpose**: the agent's system prompt — defines behavior, personality, constraints

## spec.mcp_server_usages[]

Each entry declares one MCP server the agent can use.

```yaml
mcp_server_usages:
  - mcp_server_ref:           # REQUIRED
      org: <string>           # optional — omit for same-org (relative reference)
      kind: mcp_server        # REQUIRED — must be literal string "mcp_server"
      slug: <string>          # REQUIRED — slug of the McpServer resource
    enabled_tools: [string]   # optional — empty = all default tools
    tool_approval_overrides:  # optional
      - tool_name: <string>   # REQUIRED — exact case-sensitive match
        requires_approval: <bool>
        message: <string>     # optional — supports {{args.field}} placeholders
```

**Constraints**:
- Each MCP server slug must be **unique** within `mcp_server_usages`
- `kind` must be the string `mcp_server` (not `44`, not `MCP_SERVER`)
- `tool_name` in overrides must match tools/list exactly — typos are **silently ignored**

## spec.skill_refs[]

Each entry references a Skill resource.

```yaml
skill_refs:
  - org: <string>         # optional — omit for same-org reference
    kind: skill            # REQUIRED — must be literal string "skill"
    slug: <string>         # REQUIRED — slug of the Skill resource
    version: <string>      # optional — tag name, "latest", or 64-char hex hash
```

**Constraints**:
- `kind` must be the string `skill` (not `43`, not `Skill`)
- `slug` pattern: `^[a-z][a-z0-9-]*$`, 1-63 chars
- `version` accepts: empty (latest), `latest`, tag name (e.g., `stable`), 64-char hex hash

## spec.sub_agents[]

Inline sub-agents for delegation.

```yaml
sub_agents:
  - name: <string>            # REQUIRED — unique within sub_agents
    description: <string>     # recommended — helps parent route delegation
    instructions: <string>    # REQUIRED — min 10 chars
    mcp_access:               # optional — defaults to NO MCP access
      - mcp_server: <string>  # REQUIRED — slug from parent's mcp_server_usages
        enabled_tools: [str]  # optional — empty = all parent's tools for this server
    skill_refs: []            # optional — independent of parent's skills
```

**Permission model**:
- `mcp_server` must reference a slug from the **parent's** `mcp_server_usages`
- `enabled_tools` must be a **subset** of the parent's enabled tools for that server
- Sub-agents can **restrict** tools, never **expand** beyond parent
- Sub-agents with no `mcp_access` have **zero** tool access
- `skill_refs` are independent — sub-agents can use any skill

## spec.env

Declares environment variables the agent needs (schema only — values provided at runtime via AgentInstance). Each entry is an `EnvVarDeclaration`.

```yaml
env:
  VAR_NAME:
    description: "What this variable is for"
    is_secret: true|false
    optional: true|false     # default: false (required)
```

## ApiResourceReference Format

Used in `mcp_server_ref` and `skill_refs`:

| Field | Required | Format |
|---|---|---|
| `org` | no | `^$\|^[a-z][a-z0-9-]*$` — empty = relative reference |
| `kind` | yes | `skill` or `mcp_server` (lowercase strings only) |
| `slug` | yes | `^[a-z][a-z0-9-]*$`, 1-63 chars |
| `version` | no | Empty, `latest`, tag name, or 64-char hex hash (skills only) |

### Relative vs Absolute References

- **Relative** (recommended): omit `org` — resolved from agent's `metadata.org` at apply time
- **Absolute**: set `org` explicitly — for cross-org references to public marketplace resources
