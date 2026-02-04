# Multi-Runtime Comparison

This guide compares the three supported runtimes (Go, Python, Node.js) to help you choose the right one for your project.

## Quick Reference Table

| Aspect | Go | Python | Node.js |
|--------|----|---------
|---------|
| **Default entry_point** | `main.go` | `main.py` | `index.ts` |
| **Valid extensions** | `.go` | `.py` | `.ts`, `.js`, `.mjs`, `.mts` |
| **Execution command** | `go run <entry_point>` | `python <entry_point>` | `npx ts-node <entry_point>` (TS)<br>`node <entry_point>` (JS) |
| **Type safety** | Compile-time | Runtime (+ type hints) | Runtime (+ TypeScript) |
| **Package manager** | Go modules (`go.mod`) | pip (`requirements.txt`) | npm/yarn/pnpm (`package.json`) |
| **Dependency install** | `go mod tidy` | `pip install -r requirements.txt` | `npm install` |
| **Best for** | Performance-critical,<br>compiled artifacts | Data processing,<br>ML workflows | API services,<br>real-time systems |

## Runtime Details

### Go Runtime

**Characteristics:**
- Statically typed with compile-time safety
- Fast execution and low memory footprint
- Excellent for CPU-intensive resource synthesis
- Built-in concurrency with goroutines

**Typical Project Structure:**
```
my-go-project/
├── stigmer.yaml         # runtime: go
├── main.go              # Entry point (default)
├── go.mod               # Module definition
├── go.sum               # Dependency checksums
└── agents/              # Optional: organize code
    └── support.go
```

**Example Entry Point (main.go):**
```go
package main

import (
    "log"
    "github.com/stigmer/stigmer-sdk/go/stigmer"
    "github.com/stigmer/stigmer-sdk/go/agent"
)

func main() {
    err := stigmer.Run(func(ctx *stigmer.Context) error {
        agent.New(ctx,
            agent.WithName("data-processor"),
            agent.WithInstructions("Process incoming data streams..."),
        )
        return nil
    })
    if err != nil {
        log.Fatal(err)
    }
}
```

**When to Choose Go:**
- Your team is already proficient in Go
- You need maximum synthesis performance
- You want compile-time type checking
- You're building infrastructure tooling
- You value explicit error handling

**Cross-Field Validation:**
- entry_point must end with `.go`
- Example valid: `main.go`, `cmd/deploy/main.go`, `src/project.go`
- Example invalid: `main.py`, `deploy.ts`, `handler.js`

---

### Python Runtime

**Characteristics:**
- Dynamically typed with optional type hints
- Rich ecosystem for data science and ML
- Excellent for data transformation workflows
- Rapid prototyping and iteration

**Typical Project Structure:**
```
my-python-project/
├── stigmer.yaml           # runtime: python
├── main.py                # Entry point (default)
├── requirements.txt       # Dependencies
├── pyproject.toml         # Optional: modern Python config
└── workflows/             # Optional: organize code
    └── etl.py
```

**Example Entry Point (main.py):**
```python
from stigmer import Context, run
from stigmer.workflow import Workflow
from stigmer.agent import Agent

def define_resources(ctx: Context):
    # Define data validation agent
    validator = Agent(
        ctx,
        name="data-validator",
        instructions="Validate data quality and schema compliance..."
    )
    
    # Define ETL workflow
    etl = Workflow(
        ctx,
        name="daily-etl",
        tasks=[
            # Task definitions...
        ]
    )

if __name__ == "__main__":
    run(define_resources)
```

**When to Choose Python:**
- Your team is proficient in Python
- You're building data pipelines or ML workflows
- You need access to Python's data science ecosystem (pandas, numpy, etc.)
- You want rapid iteration during development
- You're processing structured or unstructured data

**Cross-Field Validation:**
- entry_point must end with `.py`
- Example valid: `main.py`, `pipelines/deploy.py`, `src/workflows.py`
- Example invalid: `main.go`, `index.ts`, `handler.js`

**Python-Specific Considerations:**
- Virtual environments: The SDK creates an isolated environment for synthesis
- Dependencies: Both `requirements.txt` and `pyproject.toml` are supported
- Type hints: Recommended for better IDE support, but not required
- Async: Async/await syntax is fully supported in entry points

---

### Node.js Runtime

**Characteristics:**
- JavaScript/TypeScript with dynamic typing
- Event-driven, non-blocking I/O
- Excellent for API services and real-time systems
- Largest package ecosystem (npm)

**Typical Project Structure:**
```
my-node-project/
├── stigmer.yaml           # runtime: node
├── src/
│   └── index.ts           # Entry point (TypeScript)
├── package.json           # Dependencies and scripts
├── tsconfig.json          # TypeScript config (if using TS)
├── package-lock.json      # Dependency lock
└── agents/                # Optional: organize code
    └── routing.ts
```

**Example Entry Point (src/index.ts):**
```typescript
import { Context, run } from '@stigmer/sdk';
import { Agent } from '@stigmer/sdk/agent';
import { Workflow } from '@stigmer/sdk/workflow';

async function defineResources(ctx: Context) {
    // Define notification routing agent
    const router = new Agent(ctx, {
        name: 'notification-router',
        instructions: `
            Route notifications to appropriate channels...
        `,
        mcpServers: ['slack', 'sendgrid']
    });
    
    // Define delivery workflow
    const delivery = new Workflow(ctx, {
        name: 'notification-delivery',
        tasks: [
            // Workflow definition...
        ]
    });
}

run(defineResources);
```

**When to Choose Node.js:**
- Your team is proficient in JavaScript/TypeScript
- You're building API services or webhook handlers
- You need real-time or event-driven architectures
- You want to share code between frontend and backend
- You value the npm ecosystem

**Cross-Field Validation:**
- entry_point must end with `.ts`, `.js`, `.mjs`, or `.mts`
- Example valid: `index.ts`, `src/main.js`, `deploy.mts`
- Example invalid: `main.go`, `handler.py`

**Node.js-Specific Considerations:**
- TypeScript: Automatically detected and transpiled via ts-node
- ES Modules: `.mjs` and `.mts` extensions supported for ESM
- Package managers: Works with npm, yarn, and pnpm
- Async: Promises and async/await are first-class

## Choosing the Right Runtime

### Decision Tree

```
Do you have an existing codebase?
├─ YES → Use the language of your existing codebase
└─ NO → Continue...
    │
    Is performance critical (large-scale synthesis)?
    ├─ YES → Choose Go
    └─ NO → Continue...
        │
        Is this primarily data processing or ML?
        ├─ YES → Choose Python
        └─ NO → Continue...
            │
            Is this an API service or real-time system?
            ├─ YES → Choose Node.js
            └─ NO → Choose based on team expertise
```

### Use Case Recommendations

**Go is ideal for:**
- Infrastructure automation projects
- High-performance resource synthesis (100+ resources)
- Projects requiring compiled binaries
- Systems programming backgrounds

**Python is ideal for:**
- Data pipelines and ETL workflows
- ML model orchestration
- Scientific computing integration
- Data science teams

**Node.js is ideal for:**
- API gateways and microservices
- Webhook processors and event handlers
- Real-time notification systems
- Full-stack JavaScript teams

## Mixing Runtimes in an Organization

You can use different runtimes for different projects within the same organization:

```
my-organization/
├── data-pipeline/          # Python runtime
│   └── stigmer.yaml        # runtime: python
├── api-gateway/            # Node.js runtime
│   └── stigmer.yaml        # runtime: node
└── infrastructure/         # Go runtime
    └── stigmer.yaml        # runtime: go
```

Each project is independent. The runtime choice is per-project, not per-organization.

## SDK Compatibility

All three runtimes provide equivalent functionality:
- ✅ Agent definitions
- ✅ Workflow definitions
- ✅ MCP Server configurations
- ✅ Skill management
- ✅ Resource metadata and labels

The SDK APIs are designed to be idiomatic to each language:
- Go: Functional options pattern
- Python: Keyword arguments and dataclasses
- Node.js: Object literals and builder patterns

## Performance Characteristics

**Synthesis Time Comparison** (for a project with 50 resources):

| Runtime | Typical Time | Notes |
|---------|--------------|-------|
| Go | 2-3 seconds | Includes compilation |
| Python | 3-5 seconds | Includes import resolution |
| Node.js | 4-6 seconds | Includes transpilation (TS) |

These times are for reference only. Actual performance depends on:
- Resource complexity
- Number of dependencies
- Host system specifications
- Cache state (modules, packages)

## Migration Between Runtimes

Migrating a project from one runtime to another requires:

1. **Rewrite entry_point** in the target language
2. **Update stigmer.yaml** with new runtime and entry_point
3. **Convert resource definitions** using equivalent SDK APIs
4. **Run `stigmer apply`** - the backend doesn't care about runtime

The resource IDs and backend state are preserved. Only the synthesis mechanism changes.

## Common Patterns

### Default Entry Points

If you omit `entry_point` in stigmer.yaml, these defaults apply:

```yaml
# Go project
spec:
  runtime: go
  # entry_point: main.go (implicit)

# Python project
spec:
  runtime: python
  # entry_point: main.py (implicit)

# Node.js project
spec:
  runtime: node
  # entry_point: index.ts (implicit)
```

### Custom Entry Points

Override the default when your project structure differs:

```yaml
# Go with cmd/ directory
spec:
  runtime: go
  entry_point: cmd/deploy/main.go

# Python with src/ layout
spec:
  runtime: python
  entry_point: src/main.py

# Node.js with TypeScript
spec:
  runtime: node
  entry_point: src/index.ts
```

### Validation Errors

Common cross-field validation errors:

```yaml
# ❌ INVALID: Python runtime with Go entry point
spec:
  runtime: python
  entry_point: main.go
# Error: entry_point extension .go incompatible with runtime python

# ❌ INVALID: Go runtime with TypeScript entry point
spec:
  runtime: go
  entry_point: src/index.ts
# Error: entry_point extension .ts incompatible with runtime go

# ✅ VALID: Runtime and extension match
spec:
  runtime: node
  entry_point: src/index.ts
```

## Summary

All three runtimes are production-ready and fully supported. Your choice should be based on:

1. **Team expertise** - Use what your team knows best
2. **Ecosystem fit** - Leverage existing libraries and tools
3. **Use case** - Match runtime characteristics to workload

There's no "best" runtime - only the right runtime for your specific needs.
