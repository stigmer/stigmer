# Managing Agents

Complete guide to discovering, listing, searching, and managing agent resources using the Stigmer CLI.

## Quick Start

```bash
# List all agents in your organization
stigmer list agent

# Search for specific agents
stigmer search agent "code review"

# Get details about an agent
stigmer get agent my-agent

# Apply an agent from YAML
stigmer apply -f agent.yaml

# Validate an agent YAML without applying
stigmer validate -f agent.yaml

# Delete an agent
stigmer delete agent my-agent
```

## Discovering Agents

### List All Agents

List agents in your current organization:

```bash
stigmer list agent
```

**Example output:**

```
NAME                      DESCRIPTION                                    ORG      VISIBILITY  CREATED
stigmer/code-reviewer     Reviews code for best practices...            stigmer  public      2 days ago
acme/api-tester          Tests REST APIs and validates responses        acme     private     5 days ago
local/custom-agent       Custom agent for data processing               local    private     1 week ago

Showing 20 of 47 results
Use --limit to adjust number of results
```

### List from Specific Organization

Scope the list to a specific organization:

```bash
stigmer list agent --org acme-corp
```

### Limiting Results

Control the number of results returned:

```bash
# Show up to 50 results
stigmer list agent --limit 50

# Show only 10 for a quick overview
stigmer list agent --limit 10
```

**Default**: 50 results

## Searching for Agents

### Text Search

Search for agents by name, description, or tags:

```bash
stigmer search agent "code review"
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
stigmer search agent "kubernetes" --org stigmer
```

### Exclude Public Agents

Search only your own agents (exclude platform/public agents):

```bash
stigmer search agent "deploy" --exclude-public
```

This only returns agents from organizations you're a member of.

### Search with Pagination

Paginate search results:

```bash
stigmer search agent "security" --page 2 --page-size 50
```

**Default**: 20 results per page  
**Maximum**: 100 results per page

## Output Formats

All list and search commands support multiple output formats.

### Table Format (Default)

Human-readable table with key information:

```bash
stigmer list agent
stigmer search agent "test"
```

Best for: Interactive terminal use

### YAML Format

Full resource details as YAML:

```bash
stigmer list agent --output yaml
stigmer search agent "test" --output yaml
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
stigmer list agent --output json
stigmer search agent "test" --output json
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
stigmer get agent my-agent
```

### Reference Formats

Stigmer supports multiple ways to reference agents:

**By slug (current org):**
```bash
stigmer get agent my-agent
```

**By qualified slug (org/slug):**
```bash
stigmer get agent stigmer/code-reviewer
stigmer get agent acme-corp/custom-agent
```

**By resource ID:**
```bash
stigmer get agent agt_01abc123xyz
```

### Get Output Formats

Same format options as list/search:

```bash
# Table (default) - human-readable summary
stigmer get agent my-agent

# YAML - full configuration for editing
stigmer get agent my-agent --output yaml

# JSON - for scripts
stigmer get agent my-agent --output json
```

## Applying Agents

Create or update agents from YAML configuration files:

```bash
stigmer apply -f agent.yaml
```

### File Mode

Specify a YAML file or directory with the `-f` flag:

```bash
# Apply a single file
stigmer apply -f agent.yaml

# Apply all YAML files in a directory
stigmer apply -f ./manifests/
```

### Project Mode

Without the `-f` flag, the command operates in project mode and looks for a `stigmer.yaml` project file:

```bash
cd my-project-dir
stigmer apply
```

### Dry Run

Validate configuration without applying:

```bash
stigmer apply -f agent.yaml --dry-run
```

### Validation Only

Validate YAML files without applying:

```bash
stigmer validate -f agent.yaml
stigmer validate -f ./manifests/
```

### Organization Override

Apply to a specific organization:

```bash
stigmer apply -f agent.yaml --org acme-corp
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
stigmer delete agent my-agent
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
stigmer delete agent my-agent --force
```

## Running Agents

Execute an agent interactively:

```bash
stigmer run agent my-agent
```

### With an Initial Message

Provide a prompt to start the agent:

```bash
stigmer run agent my-agent --message "Review the latest PR for security issues"
```

### With Environment Variables

Pass runtime configuration:

```bash
stigmer run agent my-agent --env API_URL=https://api.example.com
stigmer run agent my-agent --env-file .env
```

### With Secrets

Pass sensitive configuration (encrypted):

```bash
stigmer run agent my-agent --secret API_KEY=sk_live_xxx
stigmer run agent my-agent --secret-file .env.secret
```

### With File Attachments

Attach files as input:

```bash
stigmer run agent data-analyzer --attach ./data.csv --attach ./config.yaml
```

### Download Artifacts on Completion

Automatically download output artifacts:

```bash
stigmer run agent report-generator --download ./results
```

### Detached Mode

Start an execution and return immediately without streaming output:

```bash
stigmer run agent my-agent --detach
```

### Auto-Approve Tool Calls

Set a default approval action for tool call prompts:

```bash
stigmer run agent my-agent --approve-default approve
```

## Common Workflows

### Discover Platform Agents

Find public agents provided by the platform:

```bash
# List all public agents from stigmer org
stigmer list agent --org stigmer

# Search platform agents
stigmer search agent "web search" --org stigmer
```

### Find Your Team's Agents

List agents from your organization:

```bash
# List from current org
stigmer list agent

# Search within your org
stigmer search agent "deploy"
```

### Find Private Agents Only

Exclude public/platform agents:

```bash
stigmer search agent "api" --exclude-public
```

### Copy Agent Configuration

Get agent as YAML for editing:

```bash
# Get agent configuration
stigmer get agent stigmer/code-reviewer --output yaml > my-agent.yaml

# Edit locally
vim my-agent.yaml

# Apply as new agent
stigmer apply -f my-agent.yaml
```

## Agent References

Stigmer uses the `org/slug` model for referencing agents.

### Qualified Slug (Recommended)

Most portable and clear:

```bash
stigmer get agent stigmer/code-reviewer
stigmer get agent acme-corp/custom-agent
```

**Benefits:**
- ✅ Works in all contexts
- ✅ Clear ownership
- ✅ No ambiguity

### Slug Only (Context-Based)

When you have an organization context set:

```bash
stigmer get agent code-reviewer
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
stigmer get agent agt_01abc123xyz
stigmer delete agent agt_01abc123xyz
```

**When to use:**
- Scripts and automation
- Cross-org references
- Debugging

## Tips and Best Practices

### 1. Use Qualified Slugs in Shared Code

```bash
# ✅ Good - portable
stigmer get agent stigmer/code-reviewer

# ⚠️ Avoid - depends on context
stigmer get agent code-reviewer
```

### 2. Search Before Creating

Check if an agent already exists:

```bash
stigmer search agent "code review"
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

### 4. Validate Before Applying

```bash
# Validate without applying
stigmer validate -f agent.yaml

# Or use dry-run
stigmer apply -f agent.yaml --dry-run
```

### 5. Combine Search with Output Formats

```bash
# Search and export matching agents as YAML
stigmer search agent "deploy" --output yaml > deploy-agents.yaml
```

### 6. Discover Available Resource Types

```bash
# List all resource types
stigmer resources

# Show types that support a specific verb
stigmer resources --verb run
```

## Organization Context

The `--org` flag overrides the default organization for any command:

```bash
stigmer list agent --org acme-corp
stigmer get agent my-agent --org acme-corp
stigmer apply -f agent.yaml --org acme-corp
```

Manage your default organization via CLI configuration:

```bash
# View current configuration
stigmer config list

# Set default organization
stigmer config set org acme-corp

# Check a specific setting
stigmer config get org
```

Organization resolution priority:
1. `--org` flag (highest priority)
2. Configuration file setting
3. Default (`local`)

## Next Steps

- [Running Agents](running-agents-workflows.md) - Execute agents with `stigmer run agent`
- [Using MCP Servers](../guides/using-mcp-servers.md) - Configure MCP servers for agents
- [Creating Skills](../guides/creating-and-versioning-skills.md) - Create reusable skills
- [CLI Configuration](configuration.md) - CLI configuration and context management

---

**Remember**: Use `stigmer list agent` to browse all agents and `stigmer search agent <query>` to find specific ones. The search looks across names, descriptions, and tags for best matches.
