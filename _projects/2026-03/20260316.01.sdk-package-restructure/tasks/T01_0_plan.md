# Task T01: SDK Package Restructure

**Created**: 2026-03-16
**Status**: PENDING REVIEW
**Type**: Refactoring

## Objective

Restructure Stigmer's entire SDK and library surface into four clean published packages (`@stigmer/sdk`, `@stigmer/react`, `@stigmer/theme`, `@stigmer/protos`), clean the Go SDK to 5 core resources with full codegen, and apply the same codegen pattern to TypeScript. Address CSS scoping for embeddable components. The existing release pipeline is broken — we accept that and build a new one after the restructuring is complete.

## Decisions (Confirmed)

| Decision | Resolution |
|----------|------------|
| **Go SDK codegen** | Full codegen. Extend the existing proto → JSON schema → Go pipeline to generate client methods (CRUD, streaming), not just Args structs. Minimal handwritten code. |
| **TypeScript codegen** | Evaluate applying the same codegen pipeline to generate `@stigmer/sdk` client code from proto service definitions. |
| **`@stigmer/protos` on npm** | Yes, keep publishing for convenience alongside Buf Registry. |
| **`@stigmer/rpc-client` retirement** | No external consumers. Remove it. Also clean up all previously published `@stigmer/*` packages on npm to avoid confusion. |
| **CSS strategy** | Address now. Components must adapt to host app's design language using CSS Custom Properties for theming + CSS Modules for scoping. No deferred. |
| **Workflow domain** | Intentionally out of scope. Will add after demonstrating with 5 core resources. |

## Current State (Problems Found)

### Release pipeline is broken (accepted, will fix last)
- `scripts/publish-libs.mjs` references `domain/react-ui` which does not exist
- Root `package.json` references `@stigmer/agent-execution-ui` which does not exist
- Most domain packages lack `publishConfig`
- **Not fixing now.** Package structure is about to change.

### Go SDK is Pulumi-style, needs to become Stripe-style
- Current: `stigmer.Run()` synthesizes protobuf manifests to disk, CLI deploys them
- Target: Direct API client like Stripe Go SDK — CRUD operations, streaming, auth
- Only 5 resources needed initially: agent, skill, mcp-server, session, execution
- Current codegen generates Args structs and task configs but not client methods

### TypeScript packages lack cohesion
- 5 separate domain packages for external developers to discover and install
- No framework-agnostic SDK (`@stigmer/rpc-client` leaks Connect-RPC internals)
- Internal UI primitives (badge, collapsible, button) duplicated across packages
- Tailwind utility classes in components risk style collisions in host apps

### Stale npm packages
- Previously published packages under `@stigmer/*` that no longer match the codebase need to be cleaned up (unpublished or deprecated) to avoid confusion.

## Target Architecture

### Published npm packages

| Package | Purpose | Depends On |
|---------|---------|------------|
| `@stigmer/protos` | Generated proto types (also on Buf Registry) | None |
| `@stigmer/sdk` | Framework-agnostic TypeScript client (transport, auth, typed service APIs). Codegen from proto where possible. | `@stigmer/protos` |
| `@stigmer/react` | React hooks + embeddable components with subpath exports. CSS Custom Properties for host-app theming. | `@stigmer/sdk`, `@stigmer/theme` |
| `@stigmer/theme` | CSS design tokens as Custom Properties, `cn()` utility | None |

### Go SDK

| Module | Purpose |
|--------|---------|
| `github.com/stigmer/stigmer/sdk/go` | Stripe-style Go API client. Full codegen from proto. 5 resources. |

### `@stigmer/react` subpath exports

```
@stigmer/react            → StigmerProvider, core exports
@stigmer/react/agent       → AgentCard, AgentOverview, AgentPicker, useAgentSearch, useAgentQueryService
@stigmer/react/execution   → ExecutionStream, ExecutionStatus, ApprovalControls, ToolCallCard, etc.
@stigmer/react/session     → SessionCard, AgentSessionHistory, useAgentSessionList
@stigmer/react/skill       → useSkillQueryService (components later)
@stigmer/react/mcp-server  → useMcpServerQueryService (components later)
```

### CSS Architecture for Embeddable Components

**Problem**: Current components use Tailwind utility classes directly. When embedded in a host application, these classes can collide with the host's styles, and components look foreign in the host's design language.

**Solution** (aligned with Principal Product Designer mandate, Section 8 — Developer Experience for Integrators):

1. **CSS Custom Properties for theming**: All visual values (colors, typography, spacing, borders, shadows, radii) use `--stigmer-*` CSS custom properties with sensible defaults.
2. **CSS Modules for class name scoping**: Each component uses `.module.css` files. Build output has hashed class names that cannot collide with the host application.
3. **`@stigmer/theme` provides defaults**: The `tokens.css` file defines all `--stigmer-*` variables. Host apps override them to make components match their design language.
4. **No global CSS leakage**: Components never inject global styles. No Tailwind utility classes in published `@stigmer/react` components.

**Host app integration example:**

```css
/* Host app overrides Stigmer tokens to match their brand */
:root {
  --stigmer-color-primary: #0066cc;
  --stigmer-color-surface: #ffffff;
  --stigmer-font-family: 'Inter', sans-serif;
  --stigmer-radius-md: 8px;
  --stigmer-spacing-md: 16px;
}
```

```tsx
// Host app embeds a Stigmer component — it inherits host styling
import { ExecutionStream } from "@stigmer/react/execution";
<ExecutionStream executionId="exec-123" />
```

**Note**: The Stigmer web console (dogfooding) can continue using Tailwind for its own layout/pages. Only `@stigmer/react` components switch to CSS Modules + Custom Properties. The console sets `--stigmer-*` variables via `@stigmer/theme` and everything works.

### Codegen Architecture

**Current pipeline** (Go only):

```
Proto files (apis/) → proto2schema (Stage 1) → JSON schemas → generator (Stage 2) → Go Args structs
```

**Target pipeline** (Go + TypeScript):

```
Proto files (apis/)
    ↓
proto2schema (Stage 1) → JSON schemas (tools/codegen/schemas/)
    ↓                          ↓
Go generator (Stage 2)    TS generator (Stage 2, new)
    ↓                          ↓
sdk/go/gen/               sdk/typescript/gen/
  - Resource types            - Resource types
  - Client methods            - Client methods
  - Request/response types    - Request/response types
```

**What codegen generates** (extended from current):

| Current (Args structs only) | Target (full Stripe-style client) |
|------------------------------|-----------------------------------|
| `AgentArgs` struct | `AgentArgs` struct |
| — | `AgentsClient.Get(ctx, slug)` |
| — | `AgentsClient.List(ctx, params)` |
| — | `AgentsClient.Create(ctx, args)` |
| — | `AgentsClient.Update(ctx, slug, args)` |
| — | `AgentsClient.Delete(ctx, slug)` |
| — | `ExecutionsClient.Subscribe(ctx, id)` (streaming) |

The client methods are generated from proto service definitions (RPC methods already declared in `.proto` files). The generator reads the service definitions and produces typed client code.

## Task Breakdown

### Phase 1: Create `@stigmer/sdk` + Go SDK Cleanup (parallel tracks)

#### Track A: TypeScript SDK (`@stigmer/sdk`)

- [ ] Create `sdk/typescript/` directory with `package.json` (`name: "@stigmer/sdk"`), `tsconfig.json`
- [ ] Design the public API surface:
  ```typescript
  const stigmer = new Stigmer({ apiKey: "sk_...", baseUrl: "https://api.stigmer.ai" });
  const agent = await stigmer.agents.get("my-agent");
  const execution = await stigmer.executions.create({ agentSlug: "my-agent", message: "Hello" });
  for await (const event of stigmer.executions.subscribe(execution.id)) { ... }
  ```
- [ ] Extract transport creation and auth logic from `@stigmer/rpc-client`
- [ ] Implement typed service clients for 5 resources: agents, skills, mcpServers, sessions, executions
- [ ] Evaluate codegen: extend `tools/codegen/generator/` to produce TypeScript client code from the same JSON schemas
- [ ] If codegen works: generate `sdk/typescript/gen/` with client types and methods
- [ ] If codegen doesn't fit: write client code manually (the API surface is small for 5 resources)
- [ ] Add `sdk/typescript` to npm workspace
- [ ] Write README with quickstart examples

#### Track B: Go SDK Cleanup

- [ ] Remove Pulumi-style synthesis: `stigmer.Run()`, `stigmer.Context`, manifest writing, `STIGMER_OUT_DIR` logic, `internal/synth/`
- [ ] Remove resources not in the initial 5: `workflow/`, `environment/`, `ref/`, plus `gen/` subdirectories for removed resources (`workflowinstance/`, `workflowexecution/`, `organization/`, `project/`, `apikey/`, `iampolicy/`, `identityaccount/`, `executioncontext/`)
- [ ] Remove `internal/templates/` (CLI init templates — not SDK responsibility)
- [ ] Keep 5 resources: `agent`, `skill`, `mcpserver`, `session` (new), `execution` (new)
- [ ] Extend codegen to generate Stripe-style client methods from proto service definitions:
  - Add `tools/codegen/proto2schema/` support for reading RPC method signatures (not just message Specs)
  - Add Go client method templates to `tools/codegen/generator/`
  - Generate `AgentsClient`, `SkillsClient`, `McpServersClient`, `SessionsClient`, `ExecutionsClient`
- [ ] Add transport layer: HTTP/gRPC client, API key auth, error handling, pagination
- [ ] Add streaming support for execution subscription
- [ ] Update `go.mod`, remove unused dependencies
- [ ] Write new examples for Stripe-style API usage
- [ ] Update `README.md`
- [ ] Run `make codegen` and verify generated code compiles and tests pass

### Phase 2: Consolidate Domain Packages into `@stigmer/react`

- [ ] Create `client-apps/web/_libs/react/` with `package.json` (`name: "@stigmer/react"`)
- [ ] Set up subpath exports in `package.json`:
  ```json
  {
    "exports": {
      ".": "./src/index.ts",
      "./agent": "./src/agent/index.ts",
      "./execution": "./src/execution/index.ts",
      "./session": "./src/session/index.ts",
      "./skill": "./src/skill/index.ts",
      "./mcp-server": "./src/mcp-server/index.ts",
      "./styles.css": "./src/styles.css"
    }
  }
  ```
- [ ] Move domain code into `react/src/`:
  - `domain/agent/src/` → `react/src/agent/`
  - `domain/agent-execution/src/` → `react/src/execution/`
  - `domain/session/src/` → `react/src/session/`
  - `domain/skill/src/` → `react/src/skill/`
  - `domain/mcp-server/src/` → `react/src/mcp-server/`
- [ ] Deduplicate internal UI primitives: merge `badge.tsx`, `collapsible.tsx`, `button.tsx`, `textarea.tsx` into `react/src/internal/`
- [ ] Refactor `StigmerProvider` to accept an `@stigmer/sdk` client instance (not raw Connect-RPC transport)
- [ ] Create root `react/src/index.ts` exporting `StigmerProvider` and core types
- [ ] **CSS migration**: Convert component styles from Tailwind utility classes to CSS Modules + CSS Custom Properties:
  - Create `.module.css` files for each component
  - Replace Tailwind classes with CSS Module class references
  - Use `--stigmer-*` custom properties for all themeable values
  - Keep `cn()` utility in `@stigmer/theme` for consumers who want Tailwind in their own code
- [ ] Consolidate styles into `react/src/styles.css` (imports CSS Modules, no global leak)

### Phase 3: Migrate Web Console to New Packages

- [ ] Update all imports in `client-apps/web/src/`:
  - `@stigmer/agent` → `@stigmer/react/agent`
  - `@stigmer/agent-execution` → `@stigmer/react/execution`
  - `@stigmer/session` → `@stigmer/react/session`
  - `@stigmer/skill` → `@stigmer/react/skill`
  - `@stigmer/mcp-server` → `@stigmer/react/mcp-server`
  - `@stigmer/rpc-client` → `@stigmer/sdk` or `@stigmer/react` as appropriate
- [ ] Set `--stigmer-*` CSS variables in the console's global styles (via `@stigmer/theme` tokens)
- [ ] Update `next.config.ts` `transpilePackages`: replace 7 packages with `@stigmer/sdk`, `@stigmer/react`, `@stigmer/theme`
- [ ] Update npm workspace config in root `package.json`
- [ ] Remove old packages:
  - Delete `domain/agent/`, `domain/agent-execution/`, `domain/session/`, `domain/skill/`, `domain/mcp-server/`
  - Delete `infra/rpc-client/`
- [ ] Verify the web console builds and runs correctly

### Phase 4: Build Release Pipeline + Cleanup Stale npm Packages

- [ ] Deprecate/unpublish stale `@stigmer/*` packages on npm (anything that doesn't match the final 4)
- [ ] Rewrite `scripts/publish-libs.mjs` PACKAGES array: `@stigmer/protos`, `@stigmer/sdk`, `@stigmer/theme`, `@stigmer/react`
- [ ] Rewrite root `package.json` `build:libs` and `clean:libs` scripts for the 4 packages
- [ ] Add build scripts to `@stigmer/sdk` and `@stigmer/react`:
  - TypeScript compilation (tsc)
  - CSS Modules processing for `@stigmer/react`
- [ ] Update `.github/workflows/release.npm-libs.yaml` if needed
- [ ] Run full pipeline with `--dry-run` to verify
- [ ] Document the release process in a README or RELEASING.md

## Execution Order and Dependencies

```
Phase 1
├── Track A: @stigmer/sdk (TypeScript)  ← independent
└── Track B: Go SDK cleanup              ← independent
    ↓
Phase 2 (consolidate @stigmer/react) ← depends on @stigmer/sdk existing
    ↓
Phase 3 (migrate web console) ← depends on @stigmer/react existing
    ↓
Phase 4 (release pipeline + npm cleanup) ← depends on final structure being stable
```

## Success Criteria

1. `@stigmer/sdk` exists as a framework-agnostic TypeScript client with typed APIs for 5 resources
2. `@stigmer/react` consolidates all React domain packages with subpath exports and CSS Modules
3. Go SDK contains only 5 resources with full codegen (client methods, not just Args structs)
4. Codegen pipeline extended to support TypeScript output (or documented why manual was chosen)
5. Components use CSS Custom Properties — host apps can theme them without style collisions
6. Web console builds and runs with the new package structure
7. `node scripts/publish-libs.mjs --version 0.0.1-test --dry-run` succeeds
8. Stale `@stigmer/*` packages on npm are cleaned up

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking web console during migration | High | Phase 3 is dedicated; do it atomically |
| Go SDK cleanup removes needed code | Medium | Git history preserves everything |
| Subpath exports not working with Next.js | Medium | Test early in Phase 2; fall back to barrel re-exports |
| CSS Modules migration is labor-intensive | Medium | Start with the highest-traffic components (ExecutionStream, MessageInput); migrate others incrementally |
| Codegen doesn't produce clean enough TypeScript | Low | Manual SDK is fine for 5 resources; codegen is a convenience |
| Extending codegen to read RPC methods is complex | Medium | Start with a single resource (agents), prove the pattern, then apply to the other 4 |

## Notes

- Preserve working functionality at all times
- Web console is the dogfooding surface — never broken for more than a single commit
- Go SDK and TypeScript SDK share proto definitions from `buf.build/leftbin/stigmer`
- Existing broken pipeline is intentionally left broken until Phase 4
- Workflow, Organization/IAM domains are out of scope — will be added after demonstrating with 5 resources
- All previously published stale `@stigmer/*` npm packages will be cleaned up in Phase 4
