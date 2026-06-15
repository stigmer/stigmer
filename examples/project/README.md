# Stigmer Project Examples

This directory contains example `stigmer.yaml` configurations demonstrating the Project Track - Stigmer's SDK-based approach to resource lifecycle management.

## What is a Stigmer Project?

A Stigmer project is a directory containing a `stigmer.yaml` file that defines how your resources (agents, workflows, skills, MCP servers) are synthesized and deployed.

Think of it as "Infrastructure as Code" for agentic systems. Instead of manually writing YAML for each resource, you write code that defines resources, and Stigmer automatically discovers, validates, and deploys everything.

> **Status / runtime note.** The runtime is **inferred from the `entry_point`
> extension** (`.ts`/`.js`/`.mts`/`.mjs` → Node, `.go` → Go, `.py` → Python) —
> there is no separate `runtime:` field. Today the **TypeScript** SDK
> (`@stigmer/sdk/synth`) is the implemented authoring API; Go and Python SDK
> synthesis libraries are planned follow-ups. For a complete, runnable project,
> start with [`typescript-quickstart/`](./typescript-quickstart). The Go/Python
> `.yaml` files here illustrate the project *configuration* shape.

### The Big Picture

```
Your SDK Code → Synthesis → Resource Manifests → Backend Reconciliation → Live Resources
```

**Benefits over manual YAML:**
- **Type safety**: Your language's type system catches errors before deployment
- **Programmatic**: Generate resources dynamically with loops, conditionals, functions
- **DRY**: Reuse code across resources, no copy-paste
- **Testable**: Write unit tests for resource generation logic
- **IDE-friendly**: Autocomplete, refactoring, jump-to-definition

## Dual-Track Interface

Stigmer provides two deployment modes:

### Atomic Track (Quick Experiments)

Deploy individual resources directly from YAML files:

```bash
stigmer apply -f agent.yaml
stigmer apply -f workflow.yaml
```

**Use when:**
- Experimenting with a single agent or workflow
- Learning Stigmer for the first time
- Testing configurations quickly
- No dependencies between resources

### Project Track (Production Systems)

Deploy entire resource graphs from SDK code:

```bash
stigmer apply  # Runs SDK, deploys all resources
```

**Use when:**
- Building production systems
- Managing multiple related resources
- Need automatic orphan cleanup (reconciliation)
- Want version-controlled resource definitions
- Resources have dependencies (agents → workflows → MCP servers)

**Key difference**: Project Track provides **reconciliation** - resources removed from your code are automatically deleted from the backend. Atomic Track requires manual cleanup.

## File Structure

```
my-project/
├── stigmer.yaml       # Project configuration (this file)
├── main.go            # Entry point with SDK code (Go example)
├── go.mod             # Language-specific dependencies
└── README.md          # Project documentation
```

The `stigmer.yaml` file is minimal - just metadata and runtime configuration. All resource definitions live in your SDK code.

## The stigmer.yaml File

### Minimal Example

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Project
metadata:
  name: my-project
  org: my-org
spec:
  entry_point: index.ts
```

That's it! Everything else has sensible defaults.

### Complete Example with All Fields

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Project

metadata:
  # Required: Project identifier (unique within organization)
  name: customer-analytics
  
  # Required: Organization slug or ID
  org: data-team
  
  # Optional: Labels for organization and filtering
  labels:
    team: data-engineering
    environment: production
    cost-center: analytics
  
  # Optional: Tags for categorization
  tags:
    - etl
    - customer-data
    - daily-job

spec:
  # Required: Entry point file. The runtime is inferred from its extension
  # (.ts/.js/.mts/.mjs -> Node, .go -> Go, .py -> Python).
  entry_point: pipelines/main.py
  
  # Optional: Human-readable description
  description: |
    Daily customer analytics pipeline processing transaction data.
    Orchestrates data ingestion, validation, feature extraction, and reporting.
```

### Field Reference

#### metadata.name

**Type**: string (required)  
**Format**: lowercase letters, numbers, hyphens; must start with letter  
**Length**: 1-63 characters

**Valid examples:**
- `data-pipeline`
- `api-gateway`
- `ml-trainer`

**Invalid examples:**
- `Data_Pipeline` (uppercase, underscore)
- `123-project` (starts with number)
- `my project` (contains space)

**Reserved names** (cannot be used):
- `default`, `system`, `admin`, `root`, `stigmer`, `test`

#### metadata.org

**Type**: string (required)  
**Format**: Organization slug or ID

**Source priority:**
1. Explicitly specified in stigmer.yaml
2. `--org` flag when running `stigmer apply`
3. Current organization in CLI context

**Example:**
```yaml
metadata:
  org: acme-corp  # Deploy to acme-corp organization
```

#### metadata.labels

**Type**: map[string]string (optional)  
**Purpose**: Structured key-value metadata for filtering and organization

**Common patterns:**
```yaml
labels:
  team: platform-engineering    # Owning team
  environment: production        # Deployment environment
  cost-center: infrastructure    # Budget allocation
  tier: critical                 # Service criticality
```

**Use labels for:**
- Querying projects: "Show all production projects"
- Access control: "data-engineering team can access all team=data-engineering projects"
- Cost allocation: "Report costs by cost-center label"
- Automation: "Run security scans on all tier=critical projects"

#### metadata.tags

**Type**: []string (optional)  
**Purpose**: Unstructured identifiers for flexible categorization

**Example:**
```yaml
tags:
  - notifications
  - webhooks
  - real-time
  - typescript
```

**Tags vs Labels:**
- **Labels**: Structured (key-value), for filtering and organization
- **Tags**: Unstructured (strings), for flexible categorization

#### spec.entry_point

**Type**: string (required for the SDK track)

Path to the file that will be executed for SDK synthesis. The **runtime is
inferred from its extension** — there is no separate `runtime:` field:

- `.go` → `go run <entry_point>`
- `.py` → `python3 <entry_point>`
- `.ts` / `.mts` → `npx tsx <entry_point>`
- `.js` / `.mjs` → `node <entry_point>`

See [multi-runtime-comparison.md](multi-runtime-comparison.md) for a comparison.

**Validation rules:**
- Must be a relative path (absolute paths rejected for security)
- Cannot contain `..` (directory traversal blocked)
- Extension must match runtime:
  - Go: `.go`
  - Python: `.py`
  - Node.js: `.ts`, `.js`, `.mjs`, `.mts`

**Examples:**
```yaml
# Go with cmd/ directory structure (runtime inferred: Go)
spec:
  entry_point: cmd/deploy/main.go

# Python with src/ layout (runtime inferred: Python)
spec:
  entry_point: src/workflows.py

# Node.js TypeScript project (runtime inferred: Node)
spec:
  entry_point: src/index.ts
```

#### spec.description

**Type**: string (optional)  
**Purpose**: Human-readable explanation of what this project does

**Best practices:**
- First line: One-sentence summary
- Following lines: Key capabilities, deployment info, dependencies
- Keep under 300 characters for table display
- Use multi-line YAML for longer descriptions

**Example:**
```yaml
spec:
  description: |
    Real-time notification delivery service.
    
    Capabilities: multi-channel delivery (email/SMS/push),
    priority queuing, template rendering, delivery tracking.
    
    Deployed to Kubernetes with autoscaling.
```

## Examples in This Directory

### [minimal-go.yaml](minimal-go.yaml)

The simplest valid stigmer.yaml configuration using Go runtime. Perfect for getting started.

**Use this when:**
- You're new to Stigmer projects
- You want a clean starting template
- You're building a simple Go-based project

**Key features:**
- Minimal required fields only
- Inline comments explain each field
- Uses default entry_point (main.go)

### [python-data-pipeline.yaml](python-data-pipeline.yaml)

A realistic Python project for data processing workflows.

**Use this when:**
- Building ETL pipelines
- Processing batch data
- Orchestrating ML workflows
- Working with data science teams

**Key features:**
- Custom entry_point (pipelines/main.py)
- Rich label set for organization
- Multi-line description with detailed context
- Python-specific patterns and conventions

### [node-api-service.yaml](node-api-service.yaml)

A TypeScript-based microservice project demonstrating service architecture.

**Use this when:**
- Building API backends
- Creating webhook handlers
- Developing real-time services
- Working with TypeScript/JavaScript teams

**Key features:**
- Node.js runtime with TypeScript entry point
- Labels for service categorization
- Tags for flexible classification
- Microservice deployment patterns

### [multi-runtime-comparison.md](multi-runtime-comparison.md)

Side-by-side comparison of Go, Python, and Node.js runtimes with decision guidance.

## Common Workflows

### Creating a New Project

1. **Initialize project directory:**
```bash
mkdir my-project
cd my-project
```

2. **Create stigmer.yaml:**
```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Project
metadata:
  name: my-project
  org: my-org
spec:
  entry_point: index.ts  # runtime inferred from the extension
```

3. **Create the entry point** (`index.ts`):
```typescript
import { defineProject } from "@stigmer/sdk/synth";

const project = defineProject((ctx) => {
  ctx.agent({
    name: "my-agent",
    org: process.env.STIGMER_ORG_ID ?? "",
    instructions: "You are a helpful assistant...",
  });
});

await project.synth();
```

4. **Validate configuration:**
```bash
stigmer project validate
# ✓ Project configuration is valid
```

5. **Deploy to backend:**
```bash
stigmer apply
# ℹ Executing entry point to discover resources...
# ✓ Synthesis complete: 1 resource(s) discovered
# ✓ Successfully applied 1 resource(s)
```

### Viewing Project Configuration

```bash
# Table format (default)
stigmer project info

# YAML format (for copying/editing)
stigmer project info --output yaml

# JSON format (for automation)
stigmer project info --output json
```

### Validating Before Deploy

```bash
# Validate local stigmer.yaml
stigmer project validate
# Exit code 0 = valid, 1 = invalid

# Dry-run synthesis (validate + preview resources)
stigmer apply --dry-run
# Shows what would be deployed without actually deploying
```

### Iterative Development

```bash
# 1. Edit your SDK code
vim main.go

# 2. Validate changes
stigmer project validate

# 3. Preview deployment
stigmer apply --dry-run

# 4. Deploy for real
stigmer apply
```

### Multi-Environment Deployment

```yaml
# stigmer.yaml (base configuration)
metadata:
  name: api-gateway
  # org not specified - use --org flag for different environments
spec:
  entry_point: index.ts
```

```bash
# Deploy to development
stigmer apply --org dev-team

# Deploy to staging
stigmer apply --org staging-team

# Deploy to production
stigmer apply --org production-team
```

## Track Detection

Stigmer automatically detects whether you're in Atomic Track or Project Track by searching for `stigmer.yaml`.

### How Detection Works

When you run a command, Stigmer:
1. Checks current directory for `stigmer.yaml`
2. If not found, walks up to parent directories (max 10 levels)
3. If `stigmer.yaml` found and valid → **Project Track**
4. If no `stigmer.yaml` found → **Atomic Track**

### Directory Structure Examples

**Single project:**
```
my-project/
├── stigmer.yaml    ← Detected from any subdirectory
├── main.go
└── src/
    └── agents/
        └── (run commands here - walks up to find stigmer.yaml)
```

**Monorepo with multiple projects:**
```
monorepo/
├── service-a/
│   ├── stigmer.yaml    ← Detected only within service-a/
│   └── main.go
└── service-b/
    ├── stigmer.yaml    ← Detected only within service-b/
    └── main.py
```

Each project is isolated - commands run in `service-a/` won't detect `service-b/stigmer.yaml`.

### Troubleshooting Detection

**Problem**: `stigmer apply` says "Stigmer.yaml not found"

**Solution**: Verify file location and name
```bash
# Check if stigmer.yaml exists
ls stigmer.yaml

# Run from project root (where stigmer.yaml is)
cd /path/to/project
stigmer apply

# Or specify directory explicitly
stigmer project info --dir /path/to/project
```

**Note**: Only `stigmer.yaml` (lowercase) is recognized. `STIGMER.yaml`, `Stigmer.yml`, or other variations are ignored.

## Validation Rules

### Schema Validation (via Protobuf)

Automatic validation of:
- `apiVersion` must be `tenancy.stigmer.ai/v1`
- `kind` must be `Project`
- `metadata.name` is required
- `metadata.org` is required
- `spec.runtime` is required and must be valid enum value

### Cross-Field Validation (via CLI)

Business logic validation:
1. **Runtime-EntryPoint Consistency**: Extension must match runtime
   - Go runtime → `.go` extension
   - Python runtime → `.py` extension
   - Node.js runtime → `.ts`, `.js`, `.mjs`, `.mts` extensions

2. **Reserved Names**: Cannot use platform-reserved project names
   - Blocked: `default`, `system`, `admin`, `root`, `stigmer`, `test`

3. **Path Security**: Entry point must be a safe relative path
   - No absolute paths: `/etc/passwd` ❌
   - No directory traversal: `../../secrets/key` ❌
   - Relative paths only: `src/main.py` ✅

### Common Validation Errors

**Error**: `cannot infer runtime from entry point 'main.rb' (extension '.rb')`
```yaml
# ❌ Unsupported extension
spec:
  entry_point: main.rb
```

**Fix** (use a supported extension — `.go`, `.py`, `.ts`, `.js`, `.mts`, `.mjs`):
```yaml
# ✅ Correct
spec:
  entry_point: main.go
```

**Error**: `project name 'default' is reserved for platform use`
```yaml
# ❌ Reserved name
metadata:
  name: default
```

**Fix**:
```yaml
# ✅ Use descriptive name
metadata:
  name: customer-service
```

**Error**: `entry_point cannot be an absolute path`
```yaml
# ❌ Absolute path
spec:
  entry_point: /opt/app/main.go
```

**Fix**:
```yaml
# ✅ Relative path
spec:
  entry_point: src/main.go
```

## Best Practices

### Naming Conventions

**Project names:**
- Use descriptive, domain-specific names
- Include function or purpose: `customer-analytics`, `notification-service`
- Avoid generic names: `project-1`, `test`, `my-app`

**Labels:**
- Use consistent key names across projects
- Standard keys: `team`, `environment`, `tier`, `cost-center`
- Values should be enumerable: `production/staging/dev`, not `prod-use-carefully`

### Organization Strategy

**Single organization:**
```yaml
# Suitable for small teams or single-product companies
metadata:
  org: acme-corp
  labels:
    environment: production  # Differentiate via labels
```

**Multi-organization:**
```yaml
# Suitable for enterprise with multiple teams/products
metadata:
  org: platform-team     # Deploy to platform-team org
  labels:
    product: core-api
    team: platform
```

### Entry Point Patterns

**Simple projects:**
```yaml
spec:
  entry_point: index.ts
```

**Organized codebases** (custom entry points):
```yaml
spec:
  entry_point: src/workflows.py  # runtime inferred: Python
```

**Monorepo patterns** (scoped entry points):
```yaml
spec:
  entry_point: packages/notifications/src/index.ts
```

### Description Guidelines

**Good descriptions** answer these questions:
1. What does this project do? (one sentence)
2. What are the key capabilities?
3. How/when is it deployed?
4. What systems does it integrate with?

**Example:**
```yaml
spec:
  description: |
    Customer analytics pipeline processing daily transaction data.
    
    Extracts features from transactions, validates data quality,
    generates aggregated reports, and uploads to data warehouse.
    
    Runs daily at 2 AM UTC via scheduled workflow execution.
```

### Security Considerations

**Never commit secrets to stigmer.yaml:**
```yaml
# ❌ NEVER DO THIS
spec:
  description: "API key: sk-abc123..."  # ❌ Secret in plain text
```

**Use environment variables or secret management:**
- Secrets injected at runtime via MCP server configurations
- API keys managed through organization-level secret storage
- Credentials never in stigmer.yaml or SDK code

**Path validation:**
- Entry points are validated to prevent directory traversal
- Only relative paths allowed
- CLI rejects `../`, `/`, and other escape attempts

## Troubleshooting

### "Stigmer.yaml not found"

**Cause**: CLI cannot find stigmer.yaml in current directory or parents

**Solutions:**
1. Verify you're in the project directory: `ls stigmer.yaml`
2. Check file name is exactly `stigmer.yaml` (lowercase)
3. Run from project root: `cd /path/to/project && stigmer apply`
4. Use `--dir` flag: `stigmer project info --dir /path/to/project`

### "Invalid YAML syntax"

**Cause**: Malformed YAML (indentation, quotes, etc.)

**Example error:**
```
Error: yaml: line 5: mapping values are not allowed in this context
```

**Solutions:**
1. Validate YAML syntax: Use a YAML validator or IDE
2. Check indentation: YAML uses spaces (not tabs), 2-space indent standard
3. Quote special characters: Colons, quotes in strings need quotes

### "Runtime-entry_point mismatch"

**Cause**: Entry point extension doesn't match runtime

**Example:**
```yaml
spec:
  entry_point: main.rb  # Unsupported extension
```

**Solution**: Use a supported extension (the runtime is inferred from it)
- Go: `.go`
- Python: `.py`
- Node.js: `.ts`, `.js`, `.mjs`, `.mts`

### "Project name is reserved"

**Cause**: Using a platform-reserved name

**Reserved names:**
- `default`, `system`, `admin`, `root`, `stigmer`, `test`

**Solution**: Choose a descriptive, domain-specific name
- ❌ `default`, `test`
- ✅ `customer-analytics`, `notification-service`

### "Failed to load entry_point"

**Cause**: Entry point file doesn't exist or SDK errors

**Solutions:**
1. Verify file exists: `ls main.go` (or your entry_point)
2. Check file has SDK imports and code
3. Run manually to see errors: `go run main.go`
4. Review compilation/syntax errors
5. Check dependencies are installed

## Migration from Atomic Track

Converting standalone resources to Project Track:

### Before (Atomic Track)

Multiple YAML files, manual management:
```
my-resources/
├── agent-support.yaml
├── agent-sales.yaml
├── workflow-onboarding.yaml
└── (manual deployment of each)
```

```bash
stigmer apply -f agent-support.yaml
stigmer apply -f agent-sales.yaml
stigmer apply -f workflow-onboarding.yaml
# Manual cleanup when removing resources
```

### After (Project Track)

Single project, automatic reconciliation:
```
customer-service/
├── stigmer.yaml
├── main.go    # Defines all resources in SDK
└── go.mod
```

```bash
stigmer apply
# All resources deployed
# Removing resource from main.go = automatic deletion
```

### Migration Steps

1. **Create stigmer.yaml** in project root
2. **Create entry_point** with SDK imports
3. **Convert YAML resources to SDK code**:
   ```yaml
   # Old: agent-support.yaml
   apiVersion: agentic.stigmer.ai/v1
   kind: Agent
   metadata:
     name: support-bot
   spec:
     instructions: "..."
   ```
   
   ```typescript
   // New: index.ts
   import { defineProject } from "@stigmer/sdk/synth";

   const project = defineProject((ctx) => {
     ctx.agent({ name: "support-bot", org: process.env.STIGMER_ORG_ID ?? "", instructions: "..." });
   });

   await project.synth();
   ```

4. **Run `stigmer apply`** to deploy from SDK
5. **Delete old YAML files** once verified

### Rollback Strategy

Keep old YAML files until Project Track is proven:
1. Deploy via Project Track: `stigmer apply`
2. Verify resources match expectations
3. Test functionality
4. Once confident, delete Atomic Track YAML files

## Advanced Patterns

### Monorepo with Multiple Projects

```
company-monorepo/
├── services/
│   ├── api-gateway/
│   │   ├── stigmer.yaml      # Independent project
│   │   └── main.go
│   └── notification-service/
│       ├── stigmer.yaml      # Independent project
│       └── src/index.ts
└── pipelines/
    ├── data-etl/
    │   ├── stigmer.yaml      # Independent project
    │   └── main.py
    └── ml-training/
        ├── stigmer.yaml      # Independent project
        └── train.py
```

Each stigmer.yaml is detected independently. Deploy selectively:
```bash
cd services/api-gateway && stigmer apply
cd services/notification-service && stigmer apply
cd pipelines/data-etl && stigmer apply
```

### Environment-Specific Configurations

Use labels and organization overrides:

```yaml
# stigmer.yaml (base config)
metadata:
  name: customer-api
  labels:
    tier: critical
spec:
  entry_point: index.ts
```

```bash
# Development
stigmer apply --org dev-team
# Resources deployed to dev-team org

# Production
stigmer apply --org production-team
# Same code, production org
```

SDK code can check environment variables for environment-specific behavior:
```typescript
const env = process.env.ENVIRONMENT; // Set in CI/CD
if (env === "production") {
  // Production-specific configuration
}
```

## Next Steps

1. **Choose a runtime**: See [multi-runtime-comparison.md](multi-runtime-comparison.md)
2. **Copy an example**: Start with [minimal-go.yaml](minimal-go.yaml), [python-data-pipeline.yaml](python-data-pipeline.yaml), or [node-api-service.yaml](node-api-service.yaml)
3. **Create entry point**: Write SDK code to define resources
4. **Validate**: Run `stigmer project validate`
5. **Deploy**: Run `stigmer apply`

## Related Documentation

- [Stigmer Projects Guide](../../docs/guides/stigmer-projects.md) - Comprehensive Project Track documentation
- [Deploying with Apply](../../docs/guides/deploying-with-apply.md) - SDK synthesis and deployment
- [Examples README](../README.md) - All example resources (agents, workflows, skills)

---

**Remember**: Project Track is about declaring your desired state in code. Stigmer handles the rest - synthesis, validation, deployment, and reconciliation.

Write code. Run `stigmer apply`. Resources match your code. Always.
