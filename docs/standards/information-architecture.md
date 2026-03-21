# Information Architecture

This document defines the navigation hierarchy, URL scheme, and sidebar ordering for the Stigmer documentation site. It is the authoritative reference for Phase 2 (framework integration) when building `meta.json` files and route structures.

---

## Sidebar Navigation Tree

```
Docs Home (/docs)
│
├── Quickstarts (/docs/quickstarts)
│   ├── CLI Quickstart
│   ├── Go SDK (Coming Soon)
│   ├── TypeScript SDK (Coming Soon)
│   └── Python SDK (Coming Soon)
│
├── Concepts (/docs/concepts)
│   ├── What is Stigmer?
│   ├── Agents
│   ├── Agent Instances
│   ├── Agent Executions
│   ├── Sessions
│   ├── Skills
│   ├── Workflows
│   ├── Workflow Executions
│   ├── MCP Servers
│   ├── Organizations
│   ├── Environments
│   ├── Projects
│   ├── Workspaces
│   ├── Seedpacks
│   ├── Identity Accounts
│   ├── IAM Policies
│   ├── Identity Providers
│   ├── API Keys
│   ├── Stigmer Server
│   ├── Agent Runner
│   └── Workflow Runner
│
├── Guides (/docs/guides)
│   ├── Environment Variables
│   ├── Using MCP Servers
│   ├── Deploying with Apply
│   ├── Durable Execution
│   ├── Creating and Versioning Skills
│   ├── Context Management
│   ├── Distribution
│   ├── Packaging Quickstart
│   └── ...
│
├── CLI Reference (/docs/cli)
│   ├── Configuration
│   ├── Managing Agents
│   ├── Running Agents and Workflows
│   ├── Server and Logs
│   └── ...
│
├── SDK Guides (/docs/sdk)
│   ├── Go SDK (/docs/sdk/go)
│   │   ├── Proto Integration
│   │   ├── Agent Skill Struct Args API
│   │   └── Workflow Fluent API
│   ├── TypeScript SDK (/docs/sdk/typescript)
│   └── Python SDK (/docs/sdk/python)
│
└── Architecture (/docs/architecture)
    ├── Backend Modes
    ├── Temporal Integration
    ├── Agent Execution Lifecycle
    ├── Skill Versioning
    ├── Build System
    ├── Error Propagation
    └── ...
```

ADRs are not shown in the main sidebar. They are accessible at `/docs/adr/{slug}` but linked from architecture docs rather than appearing as a top-level navigation section. This keeps the sidebar focused on docs that serve active development tasks.

---

## URL Scheme

Every content type maps to a predictable URL pattern:

| Content Type | Directory | URL Pattern | Example |
|---|---|---|---|
| Docs landing | `docs/index.mdx` | `/docs` | `/docs` |
| Quickstart | `docs/quickstarts/{slug}.mdx` | `/docs/quickstarts/{slug}` | `/docs/quickstarts/cli` |
| Concept | `docs/concepts/{slug}.mdx` | `/docs/concepts/{slug}` | `/docs/concepts/agent` |
| How-to Guide | `docs/guides/{slug}.mdx` | `/docs/guides/{slug}` | `/docs/guides/environment-variables` |
| CLI Reference | `docs/cli/{slug}.mdx` | `/docs/cli/{slug}` | `/docs/cli/configuration` |
| SDK Guide | `docs/sdk/{language}/{slug}.mdx` | `/docs/sdk/{language}/{slug}` | `/docs/sdk/go/proto-integration` |
| Architecture | `docs/architecture/{slug}.mdx` | `/docs/architecture/{slug}` | `/docs/architecture/backend-modes` |
| ADR | `docs/adr/{slug}.mdx` | `/docs/adr/{slug}` | `/docs/adr/local-backend-sqlite` |

### Slug Conventions

- Lowercase with hyphens: `agent-execution-lifecycle`, not `AgentExecutionLifecycle`.
- Use the resource name for concept docs: `agent.mdx`, `skill.mdx`, `mcp-server.mdx`.
- Use the command or topic name for CLI docs: `configuration.mdx`, `managing-agents.mdx`.
- Use descriptive action phrases for guides: `deploying-with-apply.mdx`, `using-mcp-servers.mdx`.

---

## Directory-to-Route Mapping

This table shows how each `docs/` subdirectory maps to a route in the documentation site.

| Directory | Route | Sidebar Section | Rendered |
|---|---|---|---|
| `docs/` | `/docs` | — (landing page) | Yes |
| `docs/quickstarts/` | `/docs/quickstarts/` | Quickstarts | Yes |
| `docs/concepts/` | `/docs/concepts/` | Concepts | Yes |
| `docs/guides/` | `/docs/guides/` | Guides | Yes |
| `docs/cli/` | `/docs/cli/` | CLI Reference | Yes |
| `docs/sdk/` | `/docs/sdk/` | SDK Guides | Yes |
| `docs/sdk/go/` | `/docs/sdk/go/` | SDK Guides > Go | Yes |
| `docs/sdk/typescript/` | `/docs/sdk/typescript/` | SDK Guides > TypeScript | Yes |
| `docs/sdk/python/` | `/docs/sdk/python/` | SDK Guides > Python | Yes |
| `docs/architecture/` | `/docs/architecture/` | Architecture | Yes |
| `docs/adr/` | `/docs/adr/` | — (not in sidebar) | Yes |
| `docs/standards/` | — | — | No (excluded) |
| `docs/product/` | — | — | No (legacy, to be migrated) |
| `docs/implementation/` | — | — | No (internal) |
| `docs/engineering/` | — | — | No (internal) |
| `docs/deployment/` | — | — | No (internal) |
| `docs/getting-started/` | — | — | No (migrated to quickstarts) |
| `docs/audit-reports/` | — | — | No (internal) |

Directories marked "No" are excluded from Fumadocs content sourcing. They remain in the repo for GitHub browsing but do not appear on the documentation site.

---

## Sidebar Ordering

Fumadocs uses `meta.json` files in each directory to control sidebar ordering. The `sidebar_position` frontmatter field provides per-page ordering within a section.

### Top-Level Section Order

| Position | Section | Rationale |
|---|---|---|
| 1 | Quickstarts | First thing a new user needs |
| 2 | Concepts | Understanding before doing |
| 3 | Guides | Task-oriented docs for practicing developers |
| 4 | CLI Reference | Reference material |
| 5 | SDK Guides | Language-specific guides |
| 6 | Architecture | Deep dives for contributors |

### Within-Section Ordering

**Quickstarts**: Ordered by expected popularity.
1. CLI Quickstart (the primary onboarding path)
2. Go SDK
3. TypeScript SDK
4. Python SDK

**Concepts**: Ordered by dependency — readers encounter foundational concepts before derived ones.
1. What is Stigmer?
2. Agents
3. Agent Instances
4. Agent Executions
5. Sessions
6. Skills
7. Workflows
8. Workflow Executions
9. MCP Servers
10. Organizations
11. Environments
12. Projects
13. Workspaces
14. (remaining concepts alphabetical)

**Guides**: Alphabetical by title. No forced ordering — guides are independent tasks.

**CLI Reference**: Grouped by workflow (configuration → resource management → execution → server operations).

**SDK Guides**: Ordered by language maturity (Go first, then TypeScript, then Python).

**Architecture**: Alphabetical by title.

---

## Index Pages

Every sidebar section has an `index.mdx` that serves as the section landing page. Index pages contain:

- A brief description of what the section covers.
- Card links to the most important pages in the section.
- A "Coming Soon" indicator for planned pages that do not exist yet.

Index pages are visible at the section root URL (e.g., `/docs/concepts`) and as the default page when clicking the section header in the sidebar.

---

## Docs Landing Page (`/docs`)

The docs landing page is the entry point for all documentation. It contains:

1. **Hero**: "Stigmer Docs" heading with the tagline "Build Agents. Skip the Infrastructure." and a one-sentence description.
2. **Quick-link cards**: Six cards linking to the top-level sections:
   - Quickstarts — "Get running in 5 minutes"
   - Concepts — "Core ideas and resource model"
   - Guides — "How-to docs and recipes"
   - CLI Reference — "Command docs and usage"
   - SDK Guides — "Go, TypeScript, Python"
   - Architecture — "Design decisions and internals"
3. **Search bar**: Full-text search across all documentation.

The landing page uses a custom layout (not the standard sidebar + content layout) to present a dashboard-style entry point.
