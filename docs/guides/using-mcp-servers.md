# Using MCP Servers

Complete guide to creating and using MCP (Model Context Protocol) servers in Stigmer.

## What are MCP Servers?

MCP servers provide tools and capabilities to AI agents through a standardized protocol. They enable agents to:
- Interact with external systems (GitHub, Slack, databases)
- Access local resources (filesystem, processes)
- Execute custom operations (API calls, data processing)

Think of MCP servers as "plugins" that extend what your agent can do.

## Quick Start

### 1. Create an MCP Server Configuration

Create `mcpserver.yaml`:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: GitHub MCP Server
  slug: github
  owner_scope: platform
spec:
  description: "GitHub operations: repos, PRs, code search"
  icon_url: "https://github.githubassets.com/favicons/favicon.svg"
  tags: ["git", "vcs", "code-review"]
  
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
  
  env_spec:
    data:
      GITHUB_TOKEN:
        is_secret: true
        description: "GitHub personal access token with repo scope"
```

### 2. Apply the Configuration

```bash
# Apply from file
stigmer mcpserver apply mcpserver.yaml

# Or from stdin
cat mcpserver.yaml | stigmer mcpserver apply -

# Validate without applying
stigmer mcpserver apply --dry-run mcpserver.yaml
```

### 3. Use in an Agent

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: Code Assistant
  slug: code-assistant
spec:
  description: "Helps with code reviews and GitHub operations"
  instructions: "You are a code assistant. Help users with GitHub operations."
  
  mcp_server_usages:
    - mcp_server_ref:
        scope: platform
        slug: github
      enabled_tools: [search_code, get_file, create_pr]
```

## Server Types

McpServer supports three transport mechanisms:

### Stdio (Subprocess)

Most common type. Runs MCP server as a subprocess.

```yaml
spec:
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    working_dir: /optional/working/directory
```

**When to use**:
- Node.js MCP servers (via npx)
- Python MCP servers
- Go binaries
- Any CLI-based MCP server

**Examples**:

```yaml
# Node.js server via npx
stdio:
  command: npx
  args: ["-y", "@modelcontextprotocol/server-github"]

# Python server
stdio:
  command: python
  args: ["-m", "mcp_server_sqlite", "--db-path", "/data/db.sqlite"]

# Go binary
stdio:
  command: ./mcp-server-custom
  args: ["--config", "config.yaml"]
```

### HTTP (Remote Service)

MCP server accessible via HTTP + Server-Sent Events.

```yaml
spec:
  http:
    url: https://mcp.example.com/v1
    headers:
      Authorization: "Bearer ${API_TOKEN}"
      X-API-Version: "2024-01"
    query_params:
      region: "${AWS_REGION}"
    timeout_seconds: 60
```

**When to use**:
- Managed MCP services
- Shared MCP servers
- Cloud-hosted integrations
- MCP servers behind API gateways

**Environment Variable Placeholders**:

Headers and query params support `${VAR_NAME}` syntax:

```yaml
spec:
  http:
    url: https://api.example.com/mcp
    headers:
      Authorization: "Bearer ${API_TOKEN}"
      X-Tenant-ID: "${TENANT_ID}"
      X-User-Email: "${USER_EMAIL}"
```

These are resolved at runtime from the AgentInstance's Environment.

### Docker (Containerized)

MCP server running in a Docker container.

```yaml
spec:
  docker:
    image: ghcr.io/org/mcp-server:v1.2.3
    args: ["--verbose"]
    
    volumes:
      - host_path: /home/user/data
        container_path: /data
        read_only: false
      
      - host_path: /home/user/config
        container_path: /config
        read_only: true
    
    ports:
      - host_port: 8080
        container_port: 8080
        protocol: tcp
    
    network: bridge
    container_name: mcp-custom-server
```

**When to use**:
- MCP servers with complex dependencies
- Isolated execution environments
- Reproducible setups
- Custom/proprietary MCP servers

## Ownership Scopes

Choose the right scope based on who should access the MCP server:

### Platform Scope

**Visibility**: Public to all users

**Use for**:
- Generic MCP servers (GitHub, Slack, AWS)
- Community contributions
- Reference examples

```yaml
metadata:
  owner_scope: platform
```

**Who can manage**: Platform operators only

**Who can use**: Everyone (marketplace)

### Organization Scope

**Visibility**: Organization members only

**Use for**:
- Internal APIs
- Proprietary tools
- Organization-specific integrations

```yaml
metadata:
  owner_scope: organization
  org: acme-corp  # Required when owner_scope = organization
```

**Who can manage**: Org admins + owner

**Who can use**: Organization members

### Identity Account Scope

**Visibility**: Owner only

**Use for**:
- Personal development tools
- Localhost services
- Experimental configurations

```yaml
metadata:
  owner_scope: identity_account
```

**Who can manage**: Owner only

**Who can use**: Owner only

## Environment Variables

MCP servers often need environment variables for authentication and configuration.

### Declaring Requirements (env_spec)

In the McpServer definition, declare WHAT environment variables are needed:

```yaml
spec:
  env_spec:
    data:
      GITHUB_TOKEN:
        is_secret: true
        description: "GitHub personal access token with repo scope"
      
      GITHUB_OWNER:
        is_secret: false
        description: "Default GitHub organization or user"
      
      GITHUB_API_URL:
        is_secret: false
        description: "GitHub API base URL (default: https://api.github.com)"
```

This serves as:
- Documentation for users
- Validation at runtime
- Schema for Environment resources

### Providing Values (Environment)

Create a separate Environment resource with actual values:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: Production Environment
  slug: prod-env
  owner_scope: organization
  org: acme-corp
spec:
  data:
    GITHUB_TOKEN:
      value: "ghp_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
    
    GITHUB_OWNER:
      value: "acme-corp"
    
    GITHUB_API_URL:
      value: "https://api.github.com"
```

### Binding at Runtime (AgentInstance)

Connect the Environment to an AgentInstance:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: Code Assistant Instance
spec:
  agent_ref:
    scope: organization
    org: acme-corp
    slug: code-assistant
  
  environment_ref:
    scope: organization
    org: acme-corp
    slug: prod-env
```

**Flow**:
1. AgentInstance references Agent (which uses McpServer)
2. AgentInstance references Environment (which has secrets)
3. Runtime resolves McpServer config + Environment values
4. MCP server starts with actual environment variables

### Runtime Environment Override

Override environment variables at execution time using CLI flags:

```bash
# Override environment variables for this execution
stigmer run code-assistant \
  --secret "GITHUB_TOKEN=ghp_xxxxxxxxxxxx" \
  --env "GITHUB_OWNER=my-org"
```

**Precedence** (highest to lowest):
1. CLI runtime flags (`--secret`, `--env`)
2. CLI runtime files (`--secret-file`, `--env-file`)
3. AgentInstance Environment reference
4. Agent default env_spec
5. McpServer default env_spec

This allows:
- **Development**: Override production secrets with dev credentials
- **Testing**: Use mock/sandbox API endpoints
- **Debugging**: Enable verbose logging temporarily

**Example: Development Override**

```bash
# Production AgentInstance uses prod-env
# Override for local development:
stigmer run code-assistant \
  --secret "GITHUB_TOKEN=ghp_dev_token" \
  --env "GITHUB_API_URL=http://localhost:8080"
```

See [Environment Variables Guide](environment-variables.md) for complete CLI documentation.

## Placeholder Resolution

MCP server configurations support `${VAR_NAME}` placeholders that are resolved at runtime.

### Supported Locations

Placeholders can be used in:

**HTTP Servers:**
- `headers` - Authorization, custom headers
- `query_params` - API keys, configuration parameters

**Future Support:**
- Stdio servers: `env` map (when added to proto)
- Docker servers: `env` map (when added to proto)

### Syntax

```yaml
${VARIABLE_NAME}
```

**Rules:**
- Case-sensitive: `${API_KEY}` ≠ `${api_key}`
- Alphanumeric + underscore only
- Must start with letter or underscore
- No spaces or special characters

### Example: HTTP Server with Placeholders

```yaml
spec:
  http:
    url: https://api.github.com
    headers:
      Authorization: "Bearer ${GITHUB_TOKEN}"
      X-GitHub-Api-Version: "2022-11-28"
      X-Custom-Header: "${CUSTOM_VALUE}"
    query_params:
      api_key: "${API_KEY}"
      region: "${AWS_REGION}"
```

### Runtime Resolution

At execution time:

1. **Merge environment sources** (precedence order):
   - CLI runtime flags (`--secret`, `--env`)
   - CLI runtime files (`--secret-file`, `--env-file`)
   - AgentInstance Environment reference
   - Agent default env_spec
   - McpServer default env_spec

2. **Resolve placeholders** in MCP config:
   ```
   Authorization: "Bearer ${GITHUB_TOKEN}"
   → Authorization: "Bearer ghp_xxxxxxxxxxxx"
   ```

3. **Validate required variables**:
   - If placeholder cannot be resolved → fail fast with error
   - Clear error message indicates missing variables

4. **Start MCP server** with resolved configuration

### Validation

**Strict Mode** (default for executions):

```bash
stigmer run my-agent

# Error: MCP server 'github' missing required environment variables:
#   - GITHUB_TOKEN
#   - API_KEY
#
# Provide via CLI:
#   stigmer run my-agent --secret "GITHUB_TOKEN=ghp_xxx" --secret "API_KEY=key_yyy"
```

**Required vs Optional:**

- Variables in `env_spec` without default values → **required**
- Variables in `env_spec` with default values → **optional**
- Placeholders with no corresponding `env_spec` entry → **required**

### Example: Complete Flow

**1. McpServer definition:**

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: GitHub MCP Server
  slug: github
spec:
  http:
    url: https://api.github.com
    headers:
      Authorization: "Bearer ${GITHUB_TOKEN}"
  
  env_spec:
    data:
      GITHUB_TOKEN:
        is_secret: true
        description: "GitHub personal access token"
```

**2. Environment resource:**

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: Production Environment
  slug: prod-env
spec:
  data:
    GITHUB_TOKEN:
      value: "ghp_prod_token_xxxxxxxxxxxx"
      is_secret: true
```

**3. AgentInstance binding:**

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: Code Assistant Instance
spec:
  agent_ref:
    slug: code-assistant
  environment_ref:
    slug: prod-env
```

**4. Runtime execution:**

```bash
# Uses prod-env GITHUB_TOKEN
stigmer run code-assistant

# Or override for testing:
stigmer run code-assistant \
  --secret "GITHUB_TOKEN=ghp_dev_token"
```

**5. Result:**

```
✓ Environment loaded: 1 variable (1 secret)
✓ MCP server 'github' configured
  - Authorization: Bearer ghp_dev_token
✓ Agent execution started
```

### Debugging Placeholders

**Check environment resolution:**

```bash
# Verbose logging (future enhancement)
stigmer run my-agent --verbose

# Output:
# ✓ Merged environment:
#   - GITHUB_TOKEN=*** (secret, from --secret flag)
#   - API_KEY=*** (secret, from prod-env)
#   - LOG_LEVEL=debug (from --env flag)
# ✓ Resolved placeholders for MCP server 'github':
#   - Authorization: Bearer *** (GITHUB_TOKEN)
#   - X-API-Key: *** (API_KEY)
```

### Security Considerations

**1. Secrets in headers:**

```yaml
# Good - Secret properly marked and encrypted
headers:
  Authorization: "Bearer ${API_KEY}"

env_spec:
  data:
    API_KEY:
      is_secret: true  # Encrypted at rest
```

**2. Never hardcode secrets:**

```yaml
# BAD - Secret exposed in plain text
headers:
  Authorization: "Bearer ghp_hardcoded_secret"

# GOOD - Use placeholder
headers:
  Authorization: "Bearer ${GITHUB_TOKEN}"
```

**3. Least privilege:**

Only include required placeholders:

```yaml
# Good - Only necessary tokens
headers:
  Authorization: "Bearer ${GITHUB_TOKEN}"

# Bad - Unnecessary secrets exposed
headers:
  Authorization: "Bearer ${GITHUB_TOKEN}"
  X-Database-Password: "${DATABASE_PASSWORD}"  # Not needed!
```

## Tool Filtering

Control which tools from an MCP server are available to agents.

### Server-Level Default

In McpServer, declare default enabled tools:

```yaml
spec:
  default_enabled_tools: [search_code, get_file, create_pr, list_repos]
```

**Empty list = all tools enabled by default**

### Agent-Level Restriction

In Agent, restrict to a subset:

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        scope: platform
        slug: github
      enabled_tools: [search_code, create_pr]  # Subset of server's defaults
```

**Empty list = use server's defaults**

### SubAgent-Level Restriction

SubAgents can further restrict:

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        scope: platform
        slug: github
      enabled_tools: [search_code, get_file, create_pr]
  
  sub_agents:
    - name: code-reviewer
      instructions: "Review code changes for security issues"
      mcp_access:
        - mcp_server: github
          enabled_tools: [search_code, get_file]  # Subset of parent
```

**Hierarchy**:

```
McpServer.default_enabled_tools: [A, B, C, D, E]
           ↓ (restricts)
Agent.enabled_tools: [A, B, C, D]
           ↓ (restricts)
SubAgent.enabled_tools: [A, B]
```

**Rules**:
- Each level can only restrict (not expand)
- Empty list = inherit from parent
- SubAgents cannot access tools parent doesn't have

## CLI Commands

### Apply

Create or update MCP server from YAML:

```bash
# From file
stigmer mcpserver apply mcpserver.yaml

# Auto-detect mcpserver.yaml in current directory
stigmer mcpserver apply

# From stdin
cat mcpserver.yaml | stigmer mcpserver apply -

# Dry-run (validate without applying)
stigmer mcpserver apply --dry-run mcpserver.yaml

# Short alias
stigmer mcp apply mcpserver.yaml
```

**Auto-detection**: Searches for `mcpserver.yaml` or `MCPSERVER.yaml` in current directory.

### Get

Retrieve MCP server by slug or ID:

```bash
# Get by slug (default: table output)
stigmer mcpserver get github

# Get by ID
stigmer mcpserver get mcp-abc123

# YAML output
stigmer mcpserver get github --output yaml

# JSON output
stigmer mcpserver get github --output json

# Short alias
stigmer mcp get github
```

**Smart detection**: Automatically determines if argument is slug or ID.

### Delete

Delete MCP server:

```bash
# Delete by slug
stigmer mcpserver delete github

# Delete by ID
stigmer mcpserver delete mcp-abc123

# Short alias
stigmer mcp delete github
```

### List

List MCP servers (coming soon):

```bash
stigmer mcpserver list
stigmer mcp list
```

## Common Patterns

### Personal Development Server

For local development tools:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: Local Filesystem
  slug: filesystem-local
  owner_scope: identity_account
spec:
  description: "Local filesystem access for development"
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/projects"]
```

### Organization Internal API

For company-specific integrations:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: ACME Internal API
  slug: acme-internal
  owner_scope: organization
  org: acme-corp
spec:
  description: "Internal APIs and tools"
  http:
    url: https://internal-api.acme-corp.com/mcp
    headers:
      Authorization: "Bearer ${INTERNAL_API_TOKEN}"
      X-Department: "engineering"
```

### Marketplace Server

For public, reusable servers:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: Slack Integration
  slug: slack
  owner_scope: platform
spec:
  description: "Slack messaging and channel operations"
  icon_url: "https://slack.com/favicon.ico"
  tags: ["messaging", "collaboration", "notifications"]
  
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-slack"]
  
  env_spec:
    data:
      SLACK_TOKEN:
        is_secret: true
        description: "Slack bot token"
```

## Best Practices

### 1. Separate Configuration from Secrets

**Do**: Use env_spec to declare requirements, Environment for values

```yaml
# McpServer (shareable)
spec:
  env_spec:
    data:
      API_TOKEN:
        is_secret: true
```

**Don't**: Put secrets in MCP server config

```yaml
# BAD - Don't do this
spec:
  http:
    headers:
      Authorization: "Bearer ghp_xxxxxxxxxxxx"  # Exposed secret!
```

### 2. Use Meaningful Slugs

**Do**: Descriptive, readable slugs

```yaml
metadata:
  slug: github-enterprise
  slug: slack-notifications
  slug: aws-s3
```

**Don't**: Cryptic or overly generic slugs

```yaml
metadata:
  slug: mcp1
  slug: server
  slug: x
```

### 3. Document Environment Variables

**Do**: Provide clear descriptions

```yaml
env_spec:
  data:
    GITHUB_TOKEN:
      is_secret: true
      description: "GitHub personal access token with repo and read:org scopes"
```

**Don't**: Leave descriptions empty

```yaml
env_spec:
  data:
    GITHUB_TOKEN:
      is_secret: true
      # No description - users don't know what this is for
```

### 4. Tag Appropriately

**Do**: Use descriptive, searchable tags

```yaml
spec:
  tags: ["git", "vcs", "code-review", "github"]
```

**Don't**: Over-tag or use meaningless tags

```yaml
spec:
  tags: ["server", "mcp", "tool", "thing", "stuff"]
```

### 5. Restrict Tools When Appropriate

**Do**: Enable only needed tools for SubAgents

```yaml
sub_agents:
  - name: read-only-reviewer
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code, get_file]  # Read-only
```

**Don't**: Give full access when SubAgent needs limited tools

```yaml
sub_agents:
  - name: read-only-reviewer
    mcp_access:
      - mcp_server: github
        # Empty = all tools, including destructive ones!
```

### 6. Choose Appropriate Scope

| Scope | When to Use |
|-------|-------------|
| **Platform** | Generic, reusable servers for marketplace |
| **Organization** | Internal/proprietary integrations |
| **Identity Account** | Personal, experimental, or localhost servers |

### 7. Validate Before Applying

```bash
# Always test with dry-run first
stigmer mcpserver apply --dry-run mcpserver.yaml

# Fix any errors, then apply
stigmer mcpserver apply mcpserver.yaml
```

## Troubleshooting

### Common Issues

#### 1. Server Type Validation Error

**Error**: `server_type is required: exactly one of stdio, http, or docker must be specified`

**Fix**: Ensure exactly one server type is defined:

```yaml
spec:
  stdio:  # Only one!
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
```

#### 2. Missing Required Fields

**Error**: `command is required for stdio server`

**Fix**: Provide required fields for your server type:

```yaml
spec:
  stdio:
    command: npx  # Required!
    args: ["-y", "@modelcontextprotocol/server-github"]
```

#### 3. Invalid Scope Configuration

**Error**: `org is required when owner_scope is organization`

**Fix**: Include org when using organization scope:

```yaml
metadata:
  owner_scope: organization
  org: acme-corp  # Required!
```

#### 4. Tool Not Available

**Error**: Agent can't use a tool from MCP server

**Check**:
1. Is tool in McpServer's `default_enabled_tools`?
2. Is tool in Agent's `enabled_tools`?
3. For SubAgent, is tool in parent's `enabled_tools`?

**Fix**: Add tool to appropriate level:

```yaml
# Agent level
spec:
  mcp_server_usages:
    - mcp_server_ref:
        slug: github
      enabled_tools: [search_code, missing_tool]  # Add here
```

## Examples

### Example 1: GitHub Integration

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: GitHub MCP Server
  slug: github
  owner_scope: platform
spec:
  description: "GitHub repository operations, code search, and PR management"
  icon_url: "https://github.githubassets.com/favicons/favicon.svg"
  tags: ["git", "vcs", "code-review", "github"]
  
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
  
  default_enabled_tools:
    - search_code
    - get_file
    - create_pr
    - list_repos
    - get_pr_status
  
  env_spec:
    data:
      GITHUB_TOKEN:
        is_secret: true
        description: "GitHub personal access token with repo and read:org scopes"
      GITHUB_OWNER:
        is_secret: false
        description: "Default GitHub organization or user"
```

### Example 2: Docker-Based Custom Server

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: Custom Analytics Server
  slug: analytics-custom
  owner_scope: organization
  org: acme-corp
spec:
  description: "Custom analytics and reporting tools"
  tags: ["analytics", "reporting", "data"]
  
  docker:
    image: ghcr.io/acme-corp/mcp-analytics:v2.1.0
    
    volumes:
      - host_path: /data/analytics
        container_path: /app/data
        read_only: false
      
      - host_path: /etc/analytics/config.yaml
        container_path: /app/config.yaml
        read_only: true
    
    ports:
      - host_port: 9000
        container_port: 8080
        protocol: tcp
    
    network: analytics-network
    container_name: mcp-analytics
  
  env_spec:
    data:
      DB_CONNECTION_STRING:
        is_secret: true
        description: "PostgreSQL connection string"
      ANALYTICS_API_KEY:
        is_secret: true
        description: "Analytics API authentication key"
```

### Example 3: HTTP-Based Managed Service

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: AWS Operations
  slug: aws-managed
  owner_scope: platform
spec:
  description: "AWS cloud operations via managed MCP service"
  icon_url: "https://aws.amazon.com/favicon.ico"
  tags: ["cloud", "aws", "infrastructure"]
  
  http:
    url: https://mcp.aws.example.com/v1
    headers:
      Authorization: "Bearer ${AWS_MCP_TOKEN}"
      X-AWS-Region: "${AWS_REGION}"
      X-API-Version: "2024-01"
    timeout_seconds: 120
  
  default_enabled_tools:
    - list_ec2_instances
    - describe_s3_buckets
    - get_cloudwatch_metrics
  
  env_spec:
    data:
      AWS_MCP_TOKEN:
        is_secret: true
        description: "MCP service authentication token"
      AWS_REGION:
        is_secret: false
        description: "Default AWS region (e.g., us-east-1)"
```

## Related Documentation

- [Environment Variables Guide](environment-variables.md) - Complete environment variables and secrets documentation
- [Running Agents and Workflows](../cli/running-agents-workflows.md) - CLI command reference
- [McpServer Architecture](../architecture/mcp-server-resource.md) - Design and patterns
- [Implementation Report](../implementation/mcp-server-api-resource-completion.md) - What was built

---

**Remember**: MCP servers are configuration templates. Actual secrets come from Environment resources at runtime.
