# CLI Usage Examples

Comprehensive examples of Stigmer CLI commands for managing agents.

## Quick Reference

```bash
# List agents
stigmer list agent
stigmer list agent --org acme-corp
stigmer list agent --limit 50

# Search agents
stigmer search agent "code review"
stigmer search agent "kubernetes" --org stigmer
stigmer search agent "deploy" --exclude-public

# Get agent details
stigmer get agent my-agent
stigmer get agent stigmer/code-reviewer
stigmer get agent agt_01abc123xyz

# Apply agent
stigmer apply -f agent.yaml
stigmer apply -f ./manifests/
stigmer apply -f agent.yaml --dry-run

# Validate agent
stigmer validate -f agent.yaml

# Delete agent
stigmer delete agent my-agent
stigmer delete agent my-agent --force

# Run agent
stigmer run agent my-agent
stigmer run agent my-agent --message "Review this code"
```

## Listing Agents

### Basic List

List all agents in your current organization:

```bash
stigmer list agent
```

Output:
```
NAME                      DESCRIPTION                                    ORG      VISIBILITY  CREATED
stigmer/code-reviewer     Reviews code for best practices...            stigmer  public      2 days ago
acme/api-tester          Tests REST APIs and validates responses        acme     private     5 days ago
local/custom-agent       Custom agent for data processing               local    private     1 week ago

Showing 20 of 47 results
Use --limit to adjust number of results
```

### Organization-Scoped List

List agents from a specific organization:

```bash
stigmer list agent --org acme-corp
```

### With Result Limit

Control the number of results:

```bash
# Show up to 50 results
stigmer list agent --limit 50

# Show only 10 for quick overview
stigmer list agent --limit 10
```

Default limit: 50 results

### Output Formats

**Table format (default)**:
```bash
stigmer list agent
```

**YAML format**:
```bash
stigmer list agent --output yaml
```

Output:
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

**JSON format**:
```bash
stigmer list agent --output json
```

Output:
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
    "updated_at": "2026-01-30T15:45:00Z"
  }
]
```

## Searching Agents

### Text Search

Search across agent names, descriptions, and tags:

```bash
stigmer search agent "code review"
```

Output:
```
Found 5 agents matching 'code review'

NAME                      DESCRIPTION                                    ORG      VISIBILITY  CREATED
stigmer/code-reviewer     Reviews code for best practices...            stigmer  public      2 days ago
acme/pr-checker          Automated pull request validation              acme     private     1 week ago

Page 1 of 1 (total: 5)
```

Results are sorted by relevance (best matches first).

### Organization-Scoped Search

Search within a specific organization:

```bash
stigmer search agent "kubernetes" --org stigmer
```

### Exclude Public Agents

Search only private/organization agents:

```bash
stigmer search agent "deploy" --exclude-public
```

Returns only agents from organizations you're a member of.

### Search with Pagination

```bash
stigmer search agent "security" --page 2 --page-size 50
```

- Default page size: 20 results
- Maximum page size: 100 results

### Search Output Formats

Same format options as list:

```bash
stigmer search agent "test" --output yaml
stigmer search agent "test" --output json
```

## Getting Agent Details

### By Slug (Current Organization)

```bash
stigmer get agent my-agent
```

Resolves to `<current-org>/my-agent`

### By Qualified Slug (org/slug)

```bash
stigmer get agent stigmer/code-reviewer
stigmer get agent acme-corp/custom-agent
```

Most portable and clear reference method.

### By Resource ID

```bash
stigmer get agent agt_01abc123xyz
```

Immutable reference, useful for scripts.

### Get Output Formats

**Table format (default)** - Summary view:
```bash
stigmer get agent my-agent
```

**YAML format** - Full configuration:
```bash
stigmer get agent my-agent --output yaml
```

Output includes complete Agent YAML suitable for editing.

**JSON format** - Programmatic access:
```bash
stigmer get agent my-agent --output json
```

## Applying Agents

### Apply from File

Create or update agent from YAML file:

```bash
stigmer apply -f agent.yaml
```

### Apply from Directory

Apply all YAML files in a directory:

```bash
stigmer apply -f ./manifests/
```

Processes all `.yaml` and `.yml` files in the directory.

### Project Mode

Without `-f` flag, looks for `stigmer.yaml` project file:

```bash
cd my-project-dir
stigmer apply
```

### Dry Run

Preview changes without applying:

```bash
stigmer apply -f agent.yaml --dry-run
```

Shows what would be created/updated without making changes.

### Organization Override

Apply to a specific organization:

```bash
stigmer apply -f agent.yaml --org acme-corp
```

### Apply Examples

**Example 1: Simple agent**

File: `simple-agent.yaml`
```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: helper
spec:
  description: "A simple helper agent"
  instructions: "You are a helpful assistant."
```

Command:
```bash
stigmer apply -f simple-agent.yaml
```

**Example 2: Agent with skills**

File: `code-reviewer.yaml`
```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
  tags:
    - code-review
spec:
  description: "Reviews code for quality"
  instructions: "You review code for best practices."
  skill_refs:
    - kind: skill
      org: platform
      slug: code-analysis
```

Command:
```bash
stigmer apply -f code-reviewer.yaml
```

**Example 3: Multiple agents from directory**

Directory structure:
```
manifests/
├── agent1.yaml
├── agent2.yaml
└── agent3.yaml
```

Command:
```bash
stigmer apply -f ./manifests/
```

## Validating Agents

### Validate without Applying

Check YAML validity without creating/updating resources:

```bash
stigmer validate -f agent.yaml
```

### Validate Directory

Validate all YAML files in a directory:

```bash
stigmer validate -f ./manifests/
```

### Validation Checks

The validate command checks:
- YAML syntax and structure
- Required fields (apiVersion, kind, metadata.name, spec.description, spec.instructions)
- Field value constraints (instruction length >= 10, valid naming)
- Reference integrity (skill kind=43, mcp_server kind=44)
- Sub-agent permission model (tool subsets)

### Validation Output

**Valid agent**:
```bash
$ stigmer validate -f agent.yaml
✓ agent.yaml: Valid Agent configuration
```

**Invalid agent**:
```bash
$ stigmer validate -f agent.yaml
✗ agent.yaml: Validation failed
  - spec.instructions: Must be at least 10 characters
  - metadata.name: Must be lowercase with hyphens only
  - spec.skill_refs[0]: kind must equal 'skill'
```

## Deleting Agents

### Interactive Delete

Delete with confirmation prompt:

```bash
stigmer delete agent my-agent
```

Prompt:
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

Skip confirmation (for scripts):

```bash
stigmer delete agent my-agent --force
```

### Delete by Different References

```bash
# By slug (current org)
stigmer delete agent my-agent

# By qualified slug
stigmer delete agent acme-corp/my-agent

# By resource ID
stigmer delete agent agt_01abc123xyz
```

## Running Agents

### Basic Run

Execute agent interactively:

```bash
stigmer run agent my-agent
```

Starts an interactive session with the agent.

### With Initial Message

Provide a prompt to start:

```bash
stigmer run agent my-agent --message "Review the latest PR"
```

### With Environment Variables

Pass runtime configuration:

```bash
# Single variable
stigmer run agent my-agent --env API_URL=https://api.example.com

# Multiple variables
stigmer run agent my-agent \
  --env API_URL=https://api.example.com \
  --env DEBUG_MODE=true

# From file
stigmer run agent my-agent --env-file .env
```

### With Secrets

Pass sensitive configuration (encrypted):

```bash
# Single secret
stigmer run agent my-agent --secret API_KEY=sk_live_xxx

# Multiple secrets
stigmer run agent my-agent \
  --secret API_KEY=sk_live_xxx \
  --secret DB_PASSWORD=secret123

# From file
stigmer run agent my-agent --secret-file .env.secret
```

### With File Attachments

Attach input files:

```bash
# Single file
stigmer run agent data-analyzer --attach ./data.csv

# Multiple files
stigmer run agent report-generator \
  --attach ./data.csv \
  --attach ./config.yaml \
  --attach ./template.docx
```

### Download Artifacts

Automatically download output artifacts:

```bash
stigmer run agent report-generator --download ./results
```

Output files created by the agent are saved to the specified directory.

### Detached Mode

Start execution and return immediately:

```bash
stigmer run agent my-agent --detach
```

Agent runs in the background. Use execution ID to check status later.

### Auto-Approve Tools

Set default approval action for tool calls:

```bash
# Automatically approve all tool calls
stigmer run agent my-agent --approve-default approve

# Automatically deny all tool calls
stigmer run agent my-agent --approve-default deny

# Prompt for each tool call (default)
stigmer run agent my-agent --approve-default prompt
```

### Combined Run Examples

**Example 1: Data analysis with files and environment**

```bash
stigmer run agent data-analyzer \
  --attach ./sales_data.csv \
  --env API_KEY=abc123 \
  --message "Analyze Q4 sales trends" \
  --download ./results
```

**Example 2: Deployment with secrets and auto-approve**

```bash
stigmer run agent deploy-manager \
  --secret KUBE_TOKEN=xyz789 \
  --env CLUSTER_URL=https://k8s.example.com \
  --approve-default approve \
  --message "Deploy version 2.3.0 to staging"
```

**Example 3: Code review with detached execution**

```bash
stigmer run agent code-reviewer \
  --attach ./pull_request.patch \
  --detach \
  --message "Review security aspects of this PR"
```

## Common Workflows

### Copy and Modify Agent

Get existing agent as YAML, modify, and create new:

```bash
# Export agent configuration
stigmer get agent stigmer/code-reviewer --output yaml > my-reviewer.yaml

# Edit the file
vim my-reviewer.yaml

# Change metadata.name to avoid conflict
# Modify spec.instructions as needed

# Apply as new agent
stigmer apply -f my-reviewer.yaml
```

### Search and Export

Find relevant agents and export configurations:

```bash
# Search for deployment agents
stigmer search agent "deploy" --output yaml > deploy-agents.yaml

# Review the exported configurations
cat deploy-agents.yaml

# Extract and modify specific ones as needed
```

### Batch Validation

Validate multiple agent files before applying:

```bash
# Validate all agents in directory
stigmer validate -f ./agents/

# If all valid, apply them
stigmer apply -f ./agents/
```

### Organization Context Management

View and set default organization:

```bash
# View current configuration
stigmer config list

# Set default organization
stigmer config set org acme-corp

# Check specific setting
stigmer config get org
```

Organization resolution priority:
1. `--org` flag (highest)
2. Configuration file setting
3. Default (`local`)

## Reference Format Best Practices

### Qualified Slugs (Recommended)

Most portable and clear:

```bash
# ✅ Good - works in all contexts
stigmer get agent stigmer/code-reviewer
stigmer get agent acme-corp/custom-agent
```

### Slug Only (Context-Dependent)

Quick but requires organization context:

```bash
# ⚠️ Requires current org context
stigmer get agent code-reviewer
# Resolves to: <current-org>/code-reviewer
```

Use when:
- Current org is obvious
- Quick local development

Avoid when:
- Sharing commands
- Writing documentation
- Creating scripts

### Resource IDs (Immutable)

Best for automation:

```bash
# ✅ Immutable reference
stigmer get agent agt_01abc123xyz
stigmer delete agent agt_01abc123xyz
```

Use when:
- Scripting and automation
- Cross-org references
- Need guaranteed uniqueness

## Tips and Tricks

### 1. Validate Before Applying

Always validate first to catch errors:

```bash
stigmer validate -f agent.yaml && stigmer apply -f agent.yaml
```

### 2. Use Dry-Run for Safety

Preview changes before applying:

```bash
stigmer apply -f agent.yaml --dry-run
```

### 3. Search Before Creating

Avoid duplicating existing agents:

```bash
stigmer search agent "code review"
```

Check platform/organization agents first.

### 4. Combine Search with Export

Find and export matching agents:

```bash
stigmer search agent "deploy" --output yaml > reference-agents.yaml
```

### 5. Use Tags for Organization

Add descriptive tags to agents:

```yaml
metadata:
  tags:
    - code-review
    - security
    - automation
```

Makes searching more effective.

### 6. Qualified Slugs in Shared Code

Always use qualified slugs in:
- Documentation
- Shared scripts
- Team workflows

```bash
# ✅ Clear and portable
stigmer run agent stigmer/code-reviewer

# ⚠️ Context-dependent
stigmer run agent code-reviewer
```

### 7. JSON Output for Scripting

Use JSON for programmatic processing:

```bash
# Get agent ID from response
AGENT_ID=$(stigmer get agent my-agent --output json | jq -r '.id')

# Use in subsequent commands
stigmer run agent $AGENT_ID
```

## Error Messages

### Common Validation Errors

**Invalid agent name**:
```
Error: metadata.name must be lowercase with hyphens only
  Got: "MyAgent"
  Expected format: "my-agent"
```

**Instructions too short**:
```
Error: spec.instructions must be at least 10 characters
  Got: "Helper" (6 characters)
```

**Wrong skill kind**:
```
Error: spec.skill_refs[0].kind must equal 'skill'
  Got: kind=42
  Expected: kind=43 (skill)
```

**Wrong MCP server kind**:
```
Error: spec.mcp_server_usages[0].mcp_server_ref.kind must equal 'mcp_server'
  Got: kind=43
  Expected: kind=44 (mcp_server)
```

**Sub-agent tool not in parent**:
```
Error: sub_agents[0].mcp_access[0].enabled_tools contains tools not enabled by parent
  Sub-agent tools: [search_code, delete_repo]
  Parent enabled tools: [search_code, get_file]
  Invalid tools: [delete_repo]
```

### Common Runtime Errors

**Agent not found**:
```
Error: Agent 'my-agent' not found in organization 'acme-corp'
```

**Permission denied**:
```
Error: You do not have permission to modify agent 'stigmer/code-reviewer'
  Platform agents can only be modified by platform administrators
```

**Duplicate agent name**:
```
Error: Agent 'my-agent' already exists in organization 'acme-corp'
  Use 'stigmer get agent my-agent' to view the existing agent
```
