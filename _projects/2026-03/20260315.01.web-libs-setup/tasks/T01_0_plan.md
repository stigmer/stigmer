# Task T01: Set Up _libs Pattern and Extract Execution Components

**Created**: 2026-03-15
**Status**: PENDING REVIEW
**Duration**: ~1-2 weeks

## Context

Stigmer's web console (`client-apps/web`) has working execution components (ExecutionStream, ToolCallCard, ApprovalControls, etc.) built as local source files. Platform owners who want to embed agent execution UI in their apps currently must build everything from scratch.

Planton's web console solved a similar problem with a `_libs` pattern — workspace packages under `@planton/*` organized into infra/ui/domain layers. Source-only packages consumed by Next.js via `transpilePackages`. An IoC bridge pattern decouples libraries from the console shell.

This project adopts the same pattern for Stigmer: extract existing components into `@stigmer/*` workspace packages, make the Stigmer console the first consumer, then set up npm publishing so platform owners can install them.

## Prior Research

The prior project (`20260314.04.web-ui-assistant-ui-integration`) evaluated AG-UI, CopilotKit, and assistant-ui as rendering libraries. Key conclusions:
- AG-UI is an interesting output adapter but should NOT be the internal canonical format
- The simplest valuable path is to package existing components first
- Protocol optimizations (incremental streaming, AG-UI compatibility) are future follow-ups
- Stigmer already has working execution components — package them, don't rewrite them

## Reference Implementations

### 1. Planton `_libs` (primary pattern reference)

Location: `/Users/suresh/scm/github.com/plantonhq/planton/client-apps/web/_libs/`

Planton's web console uses workspace packages under `@planton/*` organized in three layers:
- **Infra** (`constants`, `rpc-client`) — platform constants, gRPC client factory
- **UI** (`theme`, `form-kit`, `action-icons`, `resource-detail-kit`) — shared components
- **Domain** (`connect`, `infra-hub`, `iam`, `billing`, etc.) — 22+ domain packages

Key patterns we adopt:
- Three-layer dependency model (domain → ui → infra, never backward)
- IoC bridge pattern (libraries define contexts, console provides implementations)
- Source-only packages (no build step; Next.js transpiles via `transpilePackages`)
- ESLint rule forbidding `@/` imports inside `_libs/`
- `workspace:*` dependencies between packages
- Subpath exports (`"./*": "./src/*/index.ts"`)

### 2. pi-mono `web-ui` (design/UX inspiration)

Location: `/Users/suresh/scm/github.com/badlogic/pi-mono/packages/web-ui/`
Published as: `@mariozechner/pi-web-ui` on npm (v0.58.0)

pi-mono is an agent platform in the same workspace. Their `web-ui` package exposes embeddable chat components. Key aspects to reference:

**What they do well (adopt):**
- **Single top-level component** (`ChatPanel`) that wires everything — our equivalent is `ExecutionChat`
- **CSS as a separate export** (`@mariozechner/pi-web-ui/app.css`) — consumers import styles explicitly. We should do the same: `@stigmer/react-ui/styles.css`
- **Extensible renderers** via registries (`registerToolRenderer(name, renderer)`, `registerMessageRenderer(role, renderer)`) — consider this for Stigmer's tool call cards
- **Example app** (`packages/web-ui/example/`) that shows consumption — we should provide a similar standalone example
- **Simple build**: TypeScript compiler + Tailwind CLI, no complex bundler

**Where we differ (don't adopt):**
- pi-mono uses **Lit web components** (light DOM); Stigmer uses **React** — different component model
- pi-mono runs agents **client-side** (local LLM); Stigmer runs agents **server-side** (LangGraph → Temporal) — fundamentally different data flow
- pi-mono uses a **global singleton** (`setAppStorage()` / `getAppStorage()`); Stigmer should use **React Context** (idiomatic React, supports multiple instances on same page)
- pi-mono has no IoC bridge pattern (everything is client-side); Stigmer needs IoC bridges because libraries can't import from the console

**Design/UX to study when building components:**
- Message layout and streaming animation patterns
- Tool call result rendering (expandable sections, console blocks)
- Artifact display (HTML sandbox, markdown, SVG)
- Attachment handling and overlay patterns
- Settings/configuration dialog patterns

## Task Plan

| Task | Title | Status |
|------|-------|--------|
| **T01** | Set up _libs directory structure and workspace config | PENDING |
| **T02** | Create @stigmer/rpc-client (infra layer) | PENDING |
| **T03** | Create @stigmer/theme (ui layer) | PENDING |
| **T04** | Create @stigmer/react-ui with execution module (domain layer) | PENDING |
| **T05** | Migrate Stigmer web console to consume @stigmer packages | PENDING |
| **T06** | Set up npm publishing (build tooling, CI) | PENDING |

## T01: Set Up _libs Directory Structure and Workspace Config

### What

Create the `client-apps/web/_libs/` directory following Planton's three-layer pattern. Configure npm workspaces so Next.js can consume them.

### Target Structure

```
client-apps/web/_libs/
├── tsconfig.base.json          # Shared TS config for all libs
├── .eslintrc.yml               # No @/ imports in _libs
│
├── infra/                      # Infrastructure layer
│   └── rpc-client/             # @stigmer/rpc-client (T02)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── index.ts
│
├── ui/                         # UI layer
│   └── theme/                  # @stigmer/theme (T03)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── index.ts
│
└── domain/                     # Domain layer
    └── execution/              # @stigmer/react-ui (T04)
        ├── package.json        # name: "@stigmer/react-ui"
        ├── tsconfig.json
        └── src/
            ├── index.ts
            ├── execution/      # Execution streaming components
            └── core/           # StigmerProvider, hooks
```

### Dependency Flow (one direction only)

```
Stigmer Web Console (thin shell — routes, layouts, pages)
    ↓ depends on
Domain layer (_libs/domain/) — @stigmer/react-ui
    ↓ depends on
UI layer (_libs/ui/) — @stigmer/theme
    ↓ depends on
Infrastructure layer (_libs/infra/) — @stigmer/rpc-client
```

Libraries NEVER import from the console (`@/` imports forbidden in `_libs/`).

### Steps

1. Create `_libs/tsconfig.base.json` (strict, moduleResolution: "bundler")
2. Create `_libs/.eslintrc.yml` (forbid `@/` imports)
3. Create skeleton `package.json` for each package (private: true initially)
4. Add workspace entries to root `package.json`
5. Update `next.config.ts` with `transpilePackages` and `optimizePackageImports`
6. Verify `npm install` resolves workspace links
7. Verify `npm run build` succeeds with empty libs

## T02: Create @stigmer/rpc-client (Infra Layer)

### What

Extract the Connect-RPC transport setup, auth interceptor, and service client factories from the console into a reusable package. This is the foundation — every domain package that calls Stigmer APIs depends on this.

### Source Files to Extract

- `src/services/transport.ts` → `_libs/infra/rpc-client/src/transport.ts`
- `src/config/env.ts` (API URL config) → `_libs/infra/rpc-client/src/config.ts`
- Auth token provider interface (IoC — console provides the implementation)

### IoC Bridge Pattern

The rpc-client cannot import auth from the console. Instead:

```typescript
// _libs/infra/rpc-client/src/context.ts
interface StigmerClientConfig {
  serverUrl: string;
  getAccessToken?: () => Promise<string | null>;
}

const StigmerClientContext = createContext<StigmerClientConfig | null>(null);
```

The console provides the implementation via a bridge component:

```typescript
// Console: src/components/providers/StigmerClientBridge.tsx
<StigmerClientContext.Provider value={{
  serverUrl: getApiBaseUrl(),
  getAccessToken: () => getToken(),
}}>
  {children}
</StigmerClientContext.Provider>
```

### Exports

- `StigmerClientContext` / `StigmerClientProvider`
- `useStigmerTransport()` — returns a configured Connect-RPC transport
- `createServiceClient<T>(service)` — typed service client factory

## T03: Create @stigmer/theme (UI Layer)

### What

Extract Tailwind CSS variables, theme tokens, and the `cn()` utility into a shared package. All UI components depend on consistent theming.

### Source Files to Extract

- `src/lib/utils.ts` (`cn` function) → `_libs/ui/theme/src/utils.ts`
- CSS variables from `globals.css` (color tokens only) → `_libs/ui/theme/src/tokens.css`
- Shared component variants (if any CVA definitions are reusable)

### Exports

- `cn()` — class name merge utility
- CSS token file (importable by consumers)
- Theme types (color scheme, spacing tokens)

## T04: Create @stigmer/react-ui with Execution Module (Domain Layer)

### What

Extract the execution streaming components into `@stigmer/react-ui/execution`. This is the main deliverable — what platform owners install.

### Source Files to Extract

From `src/components/execution/`:
- `ExecutionStream.tsx` → `_libs/domain/execution/src/execution/ExecutionStream.tsx`
- `MessageEntry.tsx` → `_libs/domain/execution/src/execution/MessageEntry.tsx`
- `ToolCallCard.tsx` → `_libs/domain/execution/src/execution/ToolCallCard.tsx`
- `SubAgentCard.tsx` → `_libs/domain/execution/src/execution/SubAgentCard.tsx`
- `ApprovalControls.tsx` → `_libs/domain/execution/src/execution/ApprovalControls.tsx`
- `OutputBlock.tsx` → `_libs/domain/execution/src/execution/OutputBlock.tsx`
- `MessageInput.tsx` → `_libs/domain/execution/src/execution/MessageInput.tsx`
- `ExecutionStatus.tsx` → `_libs/domain/execution/src/execution/ExecutionStatus.tsx`

From `src/lib/`:
- `execution.ts` (helper functions) → `_libs/domain/execution/src/execution/helpers.ts`

From `src/hooks/`:
- `useAgentExecution.ts` (or equivalent) → `_libs/domain/execution/src/hooks/useExecution.ts`

From `src/services/`:
- `execution-service.ts` → `_libs/domain/execution/src/services/execution-service.ts`

### IoC Bridge for Execution

The execution components need approval submission (RPC call) but cannot import from the console:

```typescript
// _libs/domain/execution/src/core/context.ts
interface StigmerExecutionConfig {
  onApproval?: (toolCallId: string, action: ApprovalAction, comment?: string) => Promise<void>;
  onSendMessage?: (message: string) => void;
  onCancel?: (executionId: string) => void;
}

const StigmerExecutionContext = createContext<StigmerExecutionConfig | null>(null);
```

### Top-Level Convenience Component

```typescript
// _libs/domain/execution/src/core/ExecutionChat.tsx
// Wires everything together — the ~5 lines integration target

interface ExecutionChatProps {
  executionId: string;
  className?: string;
}

export function ExecutionChat({ executionId, className }: ExecutionChatProps) {
  // Uses StigmerClientContext for transport
  // Uses StigmerExecutionContext for callbacks
  // Renders ExecutionStream with all wiring
}
```

### Package Exports

```
@stigmer/react-ui
  /execution    — ExecutionChat, ExecutionStream, ToolCallCard, etc.
  /core         — StigmerExecutionContext, hooks
  /styles.css   — Pre-built Tailwind CSS (like pi-mono's app.css export)
```

### CSS Strategy (inspired by pi-mono)

Following pi-mono's pattern, CSS is exported as a separate entry point. Consumers choose one of:
1. **Pre-built CSS**: `import '@stigmer/react-ui/styles.css'` (quickest, works without Tailwind)
2. **Tailwind integration**: Import tokens from `@stigmer/theme` and let their own Tailwind setup process them (for full customization)

## T05: Migrate Stigmer Web Console

### What

Replace local imports in the console with imports from `@stigmer/*` packages. The console becomes a thin shell that provides IoC bridges and routes.

### Steps

1. Add `@stigmer/rpc-client`, `@stigmer/theme`, `@stigmer/react-ui` as `workspace:*` dependencies
2. Create bridge providers in `src/components/providers/`
3. Replace `import { ExecutionStream } from "@/components/execution"` with `import { ExecutionStream } from "@stigmer/react-ui/execution"`
4. Replace `import { cn } from "@/lib/utils"` with `import { cn } from "@stigmer/theme"`
5. Replace transport imports with `@stigmer/rpc-client`
6. Verify build succeeds
7. Verify all pages render correctly
8. Remove the now-empty local files

## T06: npm Publishing Setup

### What

Add build tooling so packages can be published to npm for external consumers. Internal consumption remains source-only via workspaces.

### Steps

1. Create npm org `@stigmer` (if not exists) — check `npm org ls stigmer`
2. Add `tsup` or `unbuild` as the build tool for publishable packages
3. Configure `package.json` for dual consumption:
   - `"main"` and `"types"` → `./src/index.ts` (workspace/source consumption)
   - `"publishConfig"` with `"main"` → `./dist/index.js` (npm consumption)
4. Add `"files": ["dist", "src"]` to include source for debugging
5. Add build scripts: `"build": "tsup src/index.ts --format esm --dts"`
6. Test: `npm pack --dry-run` to verify package contents
7. Publish: `npm publish --access public` (or set up CI for this)

### npm Publishing Requirements

- npm account with publish access to `@stigmer` org
- `NPM_TOKEN` for CI publishing
- Versioning strategy (semver, changesets, or manual)

## Non-Goals (Explicitly Out of Scope)

- AG-UI protocol adoption or event format changes
- New streaming endpoints (SSE, incremental events)
- Agent Runner (Python) changes
- Stigmer Server (Go) changes
- Marketplace or session history components (future projects)
- assistant-ui or CopilotKit integration
- Pipeline framework for frontend (separate follow-up)

## Success Criteria

1. `client-apps/web/_libs/` exists with three-layer structure
2. `@stigmer/rpc-client` provides transport + auth via IoC
3. `@stigmer/theme` provides `cn()` and CSS tokens
4. `@stigmer/react-ui/execution` contains all execution components
5. Stigmer web console imports from `@stigmer/*` (no local execution component files)
6. `npm run build` passes in the web app
7. `npm pack` produces a valid package for `@stigmer/react-ui`
8. A platform owner can install `@stigmer/react-ui` and render an execution with ~5 lines
