# Task T01: SDK Documentation Auto-Generation -- Strategy and Design

**Created**: 2026-04-03
**Status**: PENDING REVIEW
**Type**: Strategy / Design

---

## Context

The docs site (`docs/index.mdx`) explicitly lists "SDK Reference" as "Coming soon." Today, SDK usage only appears in the getting-started tutorials (quickstart, connect-tools, create-agent). There are no dedicated reference pages for SDK methods, types, or resources.

Meanwhile, the codegen pipeline already produces rich intermediate data:

- **18 service schema files** (`tools/codegen/schemas/services/*.json`) with resource name, methods, input/output types, descriptions, streaming flags
- **Resource schemas** with field definitions, types, validation rules, descriptions
- **Proto comments** that flow through `proto2schema` into JSON schemas
- **Generated SDK code** in 4 languages (Go, TS, Python, Java) with consistent method naming

The infrastructure to auto-generate SDK docs is 80% built; we need to add a doc-generation target.

---

## Strategy: Three Layers

### Layer 1 -- Generated API Reference (fully automated)

A new generator target reads `schemas/services/*.json` + resource schemas and emits MDX files into `docs/sdk/`. Each resource page contains:

- Client accessor in each language (`stigmer.agent` / `client.Agent` / `client.agents`)
- Method reference table (name, input type, output type, description, streaming flag)
- Method detail sections with signatures in all 4 languages via `SDKTabs`
- Input type definitions with field tables (name, type, required/optional, description, validation)
- Related enums and nested messages

### Layer 2 -- Enriched Proto Comments (semi-automated, later)

After seeing the generated output, audit proto comments to ensure every RPC method has:
- One-line summary
- Behavior description
- Authorization requirements
- Error conditions
- Example usage context

### Layer 3 -- Human-Curated Guides (manual)

Pages that cannot be auto-generated:
- SDK overview (install, auth, error handling, pagination)
- Streaming guide (subscribe on AgentExecution / WorkflowExecution)
- React SDK docs (`@stigmer/react` is hand-written, not proto-generated)

---

## Proposed Task Sequence

| Task | Title | Description |
|------|-------|-------------|
| **T01** | Strategy and Design (this document) | Finalize approach, confirm design decisions |
| **T02** | POC: Generate docs for `session` resource | Build the generator (Go target or TS script), produce one MDX page, validate layout |
| **T03** | Design the MDX page template | Refine layout based on POC output -- method tables, SDKTabs, type definitions |
| **T04** | Expand generator to all 18 resources | Generate full `docs/sdk/` with meta.json, wire into docs nav |
| **T05** | Proto comment audit | Targeted enrichment of thin descriptions informed by generated output |
| **T06** | Manual pages | SDK overview, streaming guide, React SDK docs |
| **T07** | Makefile integration and CI | Add `sdk-docs` to `make codegen`, add CI staleness check |

---

## Key Design Decision: Generator Approach

### Option A: New Go generator target (recommended)

Add `sdk-docs` target in `tools/codegen/generator/` (new file `sdk_docs.go`), alongside existing `sdk_client_ts.go`, `sdk_client_python.go`, etc.

**Pros:**
- Fits the existing pipeline -- same `make codegen` triggers it
- Access to the same rich schema data all other generators use
- Single source of truth: proto change -> schema change -> SDK code + docs in one run
- Consistent with how all other codegen targets work

**Cons:**
- Go is not the natural language for MDX templating

### Option B: TypeScript script in `site/scripts/`

Add `site/scripts/generate-sdk-docs.ts` that reads the JSON schemas and emits MDX.

**Pros:**
- Closer to the docs team's toolchain
- Can import Fumadocs utilities
- Easier to iterate on MDX formatting

**Cons:**
- Duplicates schema parsing already done in Go
- Separate from codegen pipeline, could drift

### Option C: Hybrid (Go emits consolidated JSON, TS renders MDX)

Go generator emits a single `docs-data.json`, lightweight TS script reads it and generates MDX.

**Pros:**
- Schema extraction stays in Go (single source of truth)
- MDX templating in TS (easier to maintain)
- Clean separation of concerns

**Cons:**
- One more intermediate artifact

**Recommendation**: Option A (Go generator target) for consistency with the existing pipeline. The other generators already produce language-specific code via programmatic emission in Go -- MDX is just another output format.

---

## Proposed Docs Information Architecture

```
docs/
  meta.json                    -- add "sdk" after "concepts"
  sdk/
    meta.json                  -- nav ordering
    index.mdx                  -- (manual) overview, install, auth, errors
    streaming.mdx              -- (manual) streaming/subscribe patterns
    react.mdx                  -- (manual or TypeDoc-based) React SDK
    --- Resources ---          -- separator
    agent.mdx                  -- (generated)
    agent-execution.mdx        -- (generated)
    agent-instance.mdx         -- (generated)
    api-key.mdx                -- (generated)
    environment.mdx            -- (generated)
    execution-context.mdx      -- (generated)
    iam-policy.mdx             -- (generated)
    identity-account.mdx       -- (generated)
    identity-provider.mdx      -- (generated)
    mcp-server.mdx             -- (generated)
    organization.mdx           -- (generated)
    project.mdx                -- (generated)
    session.mdx                -- (generated)
    skill.mdx                  -- (generated)
    workflow.mdx               -- (generated)
    workflow-execution.mdx     -- (generated)
    workflow-instance.mdx      -- (generated)
```

---

## Generated MDX Page Structure (per resource)

```mdx
---
title: Session
description: Create and manage sessions for agent interactions.
---

{/* Auto-generated -- do not edit manually */}

## Overview

Sessions represent... (from proto package/resource description)

## Client Access

<SDKTabs>
  <Tab value="TypeScript">
    const session = await stigmer.session.get("session-id");
  </Tab>
  <Tab value="Go">
    session, err := client.Session.Get(ctx, "session-id")
  </Tab>
  <Tab value="Python">
    session = client.sessions.get("session-id")
  </Tab>
  <Tab value="Java">
    Session session = client.session().get("session-id");
  </Tab>
</SDKTabs>

## Methods

### create

Create a new session for an agent.
Requires can_create_session permission in the organization.

<SDKTabs>
  <Tab value="TypeScript">
    await stigmer.session.create({ name: "my-session", org: "acme", ... })
  </Tab>
  ...
</SDKTabs>

**Parameters**

<TypeTable
  type={{
    name: { type: "string", description: "Session name", required: true },
    org: { type: "string", description: "Organization slug", required: true },
    agentInstanceId: { type: "string", description: "Agent instance to use" },
    ...
  }}
/>

**Returns**: `Session`

### get
...

### list
...

## Types

### SessionInput

<TypeTable type={{ ... }} />

### ListSessionsRequest

<TypeTable type={{ ... }} />
```

---

## Success Criteria for T01

- [ ] Generator approach confirmed (Option A, B, or C)
- [ ] MDX page layout approved
- [ ] Docs IA (information architecture) approved
- [ ] Task sequence confirmed
- [ ] Ready to begin T02 (POC generator for session)

---

## Next Task Preview

**T02: POC Generator for `session` resource** -- Build the generator targeting one resource, produce `docs/sdk/session.mdx`, validate the layout renders correctly in the Fumadocs site.
