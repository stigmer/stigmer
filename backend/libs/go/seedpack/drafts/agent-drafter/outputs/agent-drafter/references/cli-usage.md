# Stigmer CLI Usage for Agents

This reference provides CLI commands for managing Stigmer Agent resources. Use this when you need to explain to users how to apply, list, search, or manage their agents.

## Quick Start

```bash
# Apply an agent from YAML
stigmer apply -f agent.yaml

# List all agents
stigmer list agent

# Search for agents
stigmer search agent "code review"

# Get agent details
stigmer get agent my-agent

# Delete an agent
stigmer delete agent my-agent

# Run an agent
stigmer run agent my-agent
```

## Applying Agents

Create or update agents from YAML configuration files.

### File Mode

Specify a YAML file or directory with the `-f` flag:

```bash
# Apply a single file
stigmer apply -f agent.yaml

# Apply all YAML files in a directory
stigmer apply -f ./manifests/
```

### Project Mode

Without the `-f` flag, operates in project mode and detects `stigmer.yaml`:

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

## Listing Agents

### List from Current Organization

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

**Default:** 50 results

## Searching for Agents

### Text Search

Search by name, description, or tags:

```bash
stigmer search agent "code review"
```

**What gets searched:**
- Agent name
- Agent description/instructions
- Agent tags

**Results sorted by relevance.**

### Search within Organization

```bash
stigmer search agent "kubernetes" --org stigmer
```

### Exclude Public Agents

Search only your own agents:

```bash
stigmer search agent "deploy" --exclude-public
```

### Search with Pagination

```bash
stigmer search agent "security" --page 2 --page-size 50
```

**Default:** 20 results per page, maximum 100 per page

## Output Formats

All commands support multiple output formats.

### Table Format (Default)

Human-readable table:

```bash
stigmer list agent
stigmer search agent "test"
```

### YAML Format

Full resource details as YAML:

```bash
stigmer list agent --output yaml
stigmer search agent "test" --output yaml
```

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
```

**Use cases:**
- Reviewing complete configuration
- Piping to other tools
- Saving agent definitions locally

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

## Getting Agent Details

Retrieve complete details about a specific agent:

```bash
stigmer get agent my-agent
```

### Reference Formats

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

### Output Formats for Get

```bash
# Table (default) - human-readable summary
stigmer get agent my-agent

# YAML - full configuration for editing
stigmer get agent my-agent --output yaml

# JSON - for scripts
stigmer get agent my-agent --output json
```

## Deleting Agents

Remove agents that are no longer needed:

```bash
stigmer delete agent my-agent
```

### Interactive Confirmation

Default behavior asks for confirmation:

```
⚠ You are about to delete the following agent:

  ID:   agt_01abc123
  Name: Code Review Agent
  Slug: code-reviewer
  Org:  acme-corp

⚠ This action cannot be undone.

? Delete agent 'code-reviewer'? (y/N)
```

### Force Delete

Skip confirmation for scripts:

```bash
stigmer delete agent my-agent --force
```

## Running Agents

Execute an agent interactively:

```bash
stigmer run agent my-agent
```

### With an Initial Message

```bash
stigmer run agent my-agent --message "Review the latest PR for security issues"
```

### With Environment Variables

```bash
stigmer run agent my-agent --env API_URL=https://api.example.com
stigmer run agent my-agent --env-file .env
```

### With Secrets

```bash
stigmer run agent my-agent --secret API_KEY=sk_live_xxx
stigmer run agent my-agent --secret-file .env.secret
```

### With File Attachments

```bash
stigmer run agent data-analyzer --attach ./data.csv --attach ./config.yaml
```

### Download Artifacts on Completion

```bash
stigmer run agent report-generator --download ./results
```

### Detached Mode

Start execution and return immediately without streaming output:

```bash
stigmer run agent my-agent --detach
```

### Auto-Approve Tool Calls

```bash
stigmer run agent my-agent --approve-default approve
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

### Slug Only

When organization context is set:

```bash
stigmer get agent code-reviewer
# Resolves to: <current-org>/code-reviewer
```

**When to use:** Quick local development, current org is obvious

**Limitations:** Requires organization context, less portable

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

## Common Workflows

### Discover Platform Agents

```bash
# List all public agents from stigmer org
stigmer list agent --org stigmer

# Search platform agents
stigmer search agent "web search" --org stigmer
```

### Find Your Team's Agents

```bash
# List from current org
stigmer list agent

# Search within your org
stigmer search agent "deploy"
```

### Find Private Agents Only

```bash
stigmer search agent "api" --exclude-public
```

### Copy Agent Configuration

```bash
# Get agent configuration
stigmer get agent stigmer/code-reviewer --output yaml > my-agent.yaml

# Edit locally
vim my-agent.yaml

# Apply as new agent
stigmer apply -f my-agent.yaml
```

### Export Multiple Agents

```bash
# Search and export matching agents
stigmer search agent "deploy" --output yaml > deploy-agents.yaml

# List all and export
stigmer list agent --output yaml > all-agents.yaml
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
# Set default organization
stigmer config set org acme-corp

# View current configuration
stigmer config list

# Check a specific setting
stigmer config get org
```

Organization resolution priority:
1. `--org` flag (highest priority)
2. Configuration file setting
3. Default (`local`)

## Tips and Best Practices

### Use Qualified Slugs in Shared Code

```bash
# ✅ Good - portable
stigmer get agent stigmer/code-reviewer

# ⚠️ Avoid - depends on context
stigmer get agent code-reviewer
```

### Search Before Creating

Check if an agent already exists:

```bash
stigmer search agent "code review"
```

Avoid duplicating existing platform agents.

### Use Tags for Categorization

Add tags to your agents for better searchability:

```yaml
metadata:
  tags:
    - code-review
    - security
    - automation
```

### Validate Before Applying

```bash
# Validate without applying
stigmer validate -f agent.yaml

# Or use dry-run
stigmer apply -f agent.yaml --dry-run
```

### Combine Commands with jq for Processing

```bash
# Extract agent names from JSON output
stigmer list agent --output json | jq -r '.[].name'

# Filter agents by tag
stigmer list agent --output json | jq '.[] | select(.tags[] == "security")'
```

### Discover Available Resource Types

```bash
# List all resource types
stigmer resources

# Show types that support a specific verb
stigmer resources --verb run
```

## Error Handling

### Common Errors

**Agent not found:**
```bash
$ stigmer get agent nonexistent-agent
Error: agent not found: nonexistent-agent
```

**Solution:** Check spelling, try searching, or use qualified slug.

**Invalid YAML:**
```bash
$ stigmer apply -f bad-agent.yaml
Error: invalid YAML: unexpected token at line 10
```

**Solution:** Validate YAML syntax, check indentation (use spaces, not tabs).

**Permission denied:**
```bash
$ stigmer apply -f agent.yaml --org other-org
Error: permission denied: cannot create agents in organization 'other-org'
```

**Solution:** Verify you have write access to the organization.

**Validation failed:**
```bash
$ stigmer apply -f agent.yaml
Error: validation failed: spec.instructions must be at least 10 characters
```

**Solution:** Fix validation errors in YAML and reapply.

## Next Steps

After creating agents:

- **Run agents:** Use `stigmer run agent <agent-name>` to execute agents
- **Configure MCP servers:** Set up external tool access
- **Create skills:** Build reusable knowledge packages
- **Manage executions:** Monitor and control agent runs
