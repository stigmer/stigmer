# Managing Agents

Complete guide to discovering, listing, searching, and managing agent resources using the Stigmer CLI.

## Quick Start

```bash
# List all agents in your organization
stigmer agent list

# Search for specific agents
stigmer agent search "code review"

# Get details about an agent
stigmer agent get my-agent

# Apply an agent from YAML
stigmer agent apply agent.yaml

# Delete an agent
stigmer agent delete my-agent
```

## Discovering Agents

### List All Agents

List agents in your current organization:

```bash
stigmer agent list
```

**Example output:**

```
NAME                      DESCRIPTION                                    ORG      VISIBILITY  CREATED
stigmer/code-reviewer     Reviews code for best practices...            stigmer  public      2 days ago
acme/api-tester          Tests REST APIs and validates responses        acme     private     5 days ago
local/custom-agent       Custom agent for data processing               local    private     1 week ago

Page 1 of 3 (total: 47)
Use --page 2 to see more results
```

### List from Specific Organization

Scope the list to a specific organization:

```bash
stigmer agent list --org acme-corp
```

### List from All Accessible Organizations

See agents from all organizations you have access to:

```bash
stigmer agent list --all-orgs
```

This includes:
- Agents from your organization
- Public platform agents (from `stigmer` org)
- Agents from organizations where you have access

### Pagination

Control the number of results and navigate pages:

```bash
# Show 50 results per page
stigmer agent list --page-size 50

# View page 2
stigmer agent list --page 2

# Combine both
stigmer agent list --page 2 --page-size 50
```

**Default**: 20 results per page  
**Maximum**: 100 results per page

## Searching for Agents

### Text Search

Search for agents by name, description, or tags:

```bash
stigmer agent search "code review"
```

**What gets searched:**
- Agent name
- Agent description/instructions
- Agent tags

**Results are sorted by relevance** (best matches first).

**Example output:**

```
Found 5 agents matching 'code review'

NAME                      DESCRIPTION                                    ORG      VISIBILITY  CREATED
stigmer/code-reviewer     Reviews code for best practices...            stigmer  public      2 days ago
acme/pr-checker          Automated pull request validation              acme     private     1 week ago

Page 1 of 1 (total: 5)
```

### Search within Organization

Limit search to a specific organization:

```bash
stigmer agent search "kubernetes" --org stigmer
```

### Exclude Public Agents

Search only your own agents (exclude platform/public agents):

```bash
stigmer agent search "deploy" --exclude-public
```

This only returns agents from organizations you're a member of.

### Search with Pagination

Paginate search results like list:

```bash
stigmer agent search "security" --page 2 --page-size 50
```

## Output Formats

All list and search commands support multiple output formats.

### Table Format (Default)

Human-readable table with key information:

```bash
stigmer agent list
stigmer agent search "test"
```

Best for: Interactive terminal use

### YAML Format

Full resource details as YAML:

```bash
stigmer agent list --output yaml
stigmer agent search "test" --output yaml
```

**Use cases:**
- Reviewing complete resource configuration
- Piping to other tools
- Saving agent definitions locally

**Example output:**

```yaml
- id: agt_01abc123
  name: code-reviewer
  slug: code-reviewer
  qualified_slug: stigmer/code-reviewer
  org: stigmer
  description: Reviews code for best practices and security
  visibility: visibility_public
  tags:
    - code-review
    - security
  created_at: "2026-01-28T10:30:00Z"
  updated_at: "2026-01-30T15:45:00Z"
  score: 0.95
```

### JSON Format

Full resource details as JSON:

```bash
stigmer agent list --output json
stigmer agent search "test" --output json
```

**Use cases:**
- Scripting and automation
- Integration with other tools
- Programmatic processing

**Example output:**

```json
[
  {
    "id": "agt_01abc123",
    "name": "code-reviewer",
    "slug": "code-reviewer",
    "qualified_slug": "stigmer/code-reviewer",
    "org": "stigmer",
    "description": "Reviews code for best practices and security",
    "visibility": "visibility_public",
    "tags": ["code-review", "security"],
    "created_at": "2026-01-28T10:30:00Z",
    "updated_at": "2026-01-30T15:45:00Z",
    "score": 0.95
  }
]
```

## Getting Agent Details

Retrieve complete details about a specific agent:

```bash
stigmer agent get my-agent
```

### Reference Formats

Stigmer supports multiple ways to reference agents:

**By slug (current org):**
```bash
stigmer agent get my-agent
```

**By qualified slug (org/slug):**
```bash
stigmer agent get stigmer/code-reviewer
stigmer agent get acme-corp/custom-agent
```

**By resource ID:**
```bash
stigmer agent get agt_01abc123xyz
```

### Get Output Formats

Same format options as list/search:

```bash
# Table (default) - human-readable summary
stigmer agent get my-agent

# YAML - full configuration for editing
stigmer agent get my-agent --output yaml

# JSON - for scripts
stigmer agent get my-agent --output json
```

## Applying Agents

Create or update agents from YAML configuration files:

```bash
stigmer agent apply agent.yaml
```

### Auto-Detection

If you don't specify a file, the command looks for `agent.yaml` or `AGENT.yaml`:

```bash
cd my-agent-dir
stigmer agent apply
```

### Dry Run

Validate configuration without applying:

```bash
stigmer agent apply agent.yaml --dry-run
```

### Organization Override

Apply to a specific organization:

```bash
stigmer agent apply agent.yaml --org acme-corp
```

### Example Agent YAML

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: Code Review Agent
  tags:
    - code-review
    - security
spec:
  description: "Reviews code for best practices and security issues"
  instructions: |
    You are a code review assistant. Review code for:
    - Code quality and best practices
    - Security vulnerabilities
    - Performance issues
    - Proper error handling
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
  skill_refs:
    - kind: skill
      slug: code-analysis
```

## Deleting Agents

Remove agents that are no longer needed:

```bash
stigmer agent delete my-agent
```

### Interactive Confirmation

By default, you'll be asked to confirm:

```
⚠ You are about to delete the following agent:

  ID:   agt_01abc123
  Name: Code Review Agent
  Slug: code-reviewer
  Org:  acme-corp

⚠ This action cannot be undone.

? Delete agent 'code-reviewer'? (y/N)
```

### Force Delete (Skip Confirmation)

For scripts and automation:

```bash
stigmer agent delete my-agent --force
```

## Common Workflows

### Discover Platform Agents

Find public agents provided by the platform:

```bash
# List all public agents from stigmer org
stigmer agent list --org stigmer

# Search platform agents
stigmer agent search "web search" --org stigmer
```

### Find Your Team's Agents

List agents from your organization:

```bash
# List from current org
stigmer agent list

# Search within your org
stigmer agent search "deploy"
```

### Browse Across Organizations

See all agents you have access to:

```bash
# List from all orgs
stigmer agent list --all-orgs

# Search across all orgs
stigmer agent search "kubernetes"
```

### Find Private Agents Only

Exclude public/platform agents:

```bash
stigmer agent search "api" --exclude-public
```

### Copy Agent Configuration

Get agent as YAML for editing:

```bash
# Get agent configuration
stigmer agent get stigmer/code-reviewer --output yaml > my-agent.yaml

# Edit locally
vim my-agent.yaml

# Apply as new agent
stigmer agent apply my-agent.yaml
```

## Agent References

Stigmer uses the `org/slug` model for referencing agents.

### Qualified Slug (Recommended)

Most portable and clear:

```bash
stigmer agent get stigmer/code-reviewer
stigmer agent get acme-corp/custom-agent
```

**Benefits:**
- ✅ Works in all contexts
- ✅ Clear ownership
- ✅ No ambiguity

### Slug Only (Context-Based)

When you have an organization context set:

```bash
stigmer agent get code-reviewer
# Resolves to: <current-org>/code-reviewer
```

**When to use:**
- Quick local development
- Current org is obvious

**Limitations:**
- Requires organization context
- Less portable

### Resource ID

Use IDs for immutable references:

```bash
stigmer agent get agt_01abc123xyz
stigmer agent delete agt_01abc123xyz
```

**When to use:**
- Scripts and automation
- Cross-org references
- Debugging

## Tips and Best Practices

### 1. Use Qualified Slugs in Shared Code

```bash
# ✅ Good - portable
stigmer agent get stigmer/code-reviewer

# ⚠️ Avoid - depends on context
stigmer agent get code-reviewer
```

### 2. Search Before Creating

Check if an agent already exists:

```bash
stigmer agent search "code review"
```

Avoid duplicating existing platform agents.

### 3. Use Tags for Categorization

Add tags to your agents for better searchability:

```yaml
metadata:
  tags:
    - code-review
    - security
    - automation
```

### 4. List with Smaller Pages for Quick Scanning

```bash
# Quick overview with 10 results
stigmer agent list --page-size 10
```

### 5. Combine Search with Output Formats

```bash
# Search and export matching agents as YAML
stigmer agent search "deploy" --output yaml > deploy-agents.yaml
```

## Organization Context

Set a default organization for all commands:

```bash
# Set organization context
stigmer context set --org acme-corp

# Now commands use this org by default
stigmer agent list  # Lists from acme-corp
```

Check current context:

```bash
stigmer context
```

Override per-command:

```bash
stigmer agent list --org other-org
```

## Next Steps

- [Running Agents](running-agents-workflows.md) - Execute agents with `stigmer run`
- [Using MCP Servers](../guides/using-mcp-servers.md) - Configure MCP servers for agents
- [Creating Skills](../guides/creating-and-versioning-skills.md) - Create reusable skills
- [CLI Configuration](configuration.md) - CLI configuration and context management

---

**Remember**: Use `stigmer agent list` to browse all agents and `stigmer agent search <query>` to find specific ones. The search looks across names, descriptions, and tags for best matches.
