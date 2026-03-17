# Next Task: 20260317.01.session-first-web-ux

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260317.01.session-first-web-ux

**Description**: Redesign the Stigmer web console with a session-first UX inspired by Claude Cowork. Replace the current dashboard-centric UI with a 'New Session' launcher as the landing page. Add a default 'assistant' agent to the seedpack. Backend resolves default agent automatically when no agent is specified.
**Goal**: Users can log in and immediately start a session by typing a message — no agent selection required. The backend auto-resolves the default assistant agent. The web console is rebuilt from scratch with a three-panel layout: sidebar (New Session + Recents), main content (session launcher or active session thread), and a collapsible right context panel.
**Tech Stack**: TypeScript/React/Next.js (frontend), Go (backend - seedpack + default agent resolution)
**Components**: client-apps/web (full UI rewrite), seedpack (new assistant agent), backend (default agent resolution in session/execution creation)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-17 09:01
**Current Task**: T01.6 — decomposed into 5 sub-projects (SP1-SP5)
**Status**: SP1 (Core Thread + Streaming) ready to start
**Last Session**: 2026-03-17 — GitHubClient added to Python, Go, and Java SDKs (session 16)
**Pending Pre-req**: ~~GitHub OAuth App registration~~ Done — credentials embedded in binary and configured in cloud deployment

## Session Progress (2026-03-17)

### Completed: T01.1 — Seedpack Default Assistant Agent
- Created `seedpack/agents/assistant.yaml`
- Labels: `stigmer.ai/system: "true"`, `stigmer.ai/default-agent: "true"`
- Minimal general-purpose instructions — no tool enumeration, no MCP server usages
- Agent gets its tools from the runtime; instructions just set tone and action bias
- No changes needed to `embed.go` or `BUILD.bazel` (auto-pickup via glob)

### Completed: T01.2 — Backend Default Agent Resolution
- Implemented in both Go (`stigmer`) and Java (`stigmer-cloud`)
- **Seedpack**: `assistant.yaml` updated with `visibility: visibility_public`
- **Proto**: `spec.proto` field comments updated — documents three-way resolution (session_id -> agent_id -> platform default)
- **Go Store**: Added `FindByLabel` and `FindAllByLabel` to `store.Store` interface + SQLite implementation using proto reflection for `metadata.labels` map access
- **Go Pipeline**: Added `ResolveDefaultAgentStep` before `ValidateSessionOrAgent` in `AgentExecution` create pipeline. Updated `CreateSessionIfNeeded` to use caller's org for session ownership.
- **Java AgentRepo**: Added `findDefault()` — MongoDB query by label `stigmer.ai/default-agent=true` + `visibility_public`
- **Java Pipeline**: Added `ResolveDefaultAgentStep` before `ValidateSessionOrAgentStep` in `AgentExecutionCreateHandler`. Updated `CreateSessionIfNeededStep` to use caller's org for session ownership.
- **Key design decisions**:
  - Default agent is platform-level (stigmer org), not per-org
  - Resolution is global: label + visibility_public, not org-scoped
  - Session ownership: caller's org (not agent's org) — enables cross-org public agent usage
  - Default instance stays shared in agent's org (stigmer)
  - Cloud mode gracefully fails if default agent not provisioned (seedpack is OSS-only)

### Completed: T01.3 — Web UI Teardown
- Deleted ~55 files: all layout components, dashboard, resource pages, hooks, draft/run flows, config files, utils
- Modified `layout.tsx`: removed `AppShell` import and wrapper, trimmed metadata
- Replaced `page.tsx` with minimal placeholder (server component, no imports from deleted modules)
- Preserved: `src/auth/` (9 files), `src/contexts/org-context.tsx`, `Providers.tsx`, `StigmerTransportBridge.tsx`, `src/components/ui/` (10 shadcn primitives), `src/config/env.ts`, error boundaries, `globals.css`
- Build passes (`npm run build` — zero errors, 2 static routes)
- Lint passes (`npm run lint` — zero errors)

### Completed: React SDK Teardown (companion to T01.3)
- Deleted 33 files across 7 directories (2,959 lines) from `sdk/react/`:
  - `src/agent/`, `src/session/`, `src/agent-execution/`, `src/catalog/`, `src/skill/`, `src/mcp-server/`, `src/internal/`
- Removed 6 sub-path exports and 5 unused peer dependencies (`@base-ui/react`, `class-variance-authority`, `lucide-react`, `react-markdown`, `remark-gfm`)
- Updated `README.md` to reflect minimal provider-only state
- Preserved: `StigmerProvider`, `StigmerContext`, `useStigmer`, `styles.css` (5 source files)
- Typecheck and build pass clean for both `sdk/react` and `client-apps/web`
- Committed: `c6b707cd`

### Completed: T01.4 — Web App Shell (Three-Panel Layout)
- Created layout files in `client-apps/web/src/components/layout/`: `AppShell.tsx`, `Sidebar.tsx`, `ContextPanel.tsx`, `OrgSwitcher.tsx`, `UserMenu.tsx`, `use-layout-state.ts`
- **Headerless layout** — No top bar. Sidebar owns all controls (like Claude Cowork / Cursor).
- Sidebar top: collapse toggle + OrgSwitcher. Middle: "New Session" + scrollable Recents. Bottom: UserMenu with Appearance submenu.
- Theme switching embedded in UserMenu dropdown as "Appearance" submenu with Light/Dark/System radio items.
- OrgSwitcher uses DropdownMenu + RadioGroup (not native `<select>`).
- Sidebar collapsible on all screen sizes. Floating reopen button when collapsed.
- Border uses `border-foreground/10` for guaranteed visibility in both themes.
- State: `useSyncExternalStore` — sidebar persists to localStorage, context panel is session-scoped (in-memory).
- Context panel: collapsible 320px shell (closed by default, no toggle yet). Hidden below lg.
- `layout.tsx` wraps children in `<AppShell>`. Build and lint pass clean.

### Completed: T01.5 — Web — New Session Launcher
- **SDK Architecture (headless-first, three-layer)**:
  - **Data hook**: `useModelRegistry()` — hardcoded model list ported from Python `model_registry.py` (22 models, grouped by provider, cost tiers)
  - **Behavior hooks**: `useCreateSession()` (Session aggregate), `useCreateAgentExecution()` (AgentExecution aggregate), `useWorkspaceEntries()` (workspace entry state management)
  - **Styled components**: `<ModelSelector>` (theme-able dropdown via `@base-ui/react` Select), `<WorkspaceEditor>` (add/remove workspace entries UI)
- **Backend changes**:
  - Proto: `agent_instance_id` made optional in `SessionSpec` — backend resolves default agent instance if omitted
  - Go: Added `resolveDefaultAgentInstanceStep` to session creation pipeline, `SessionController` gains `SetClients()` for agent/agentInstance dependency injection
  - Java (stigmer-cloud): Added `ResolveDefaultAgentInstanceStep` inner class in `SessionCreateHandler`
- **Console integration**:
  - `SessionLauncher` component composes SDK hooks with Console-specific concerns (org context, Next.js routing, toast notifications)
  - Flow: `useCreateSession()` -> `useCreateAgentExecution()` -> navigate to `/sessions/[id]`
  - Placeholder `/sessions/[id]/page.tsx` created for T01.6
- **Key architectural decisions**:
  - Hooks follow aggregate boundaries: `useCreateSession` for Session, `useCreateAgentExecution` for AgentExecution — no cross-aggregate orchestration in hooks
  - `SessionLauncher` stays in Console (not SDK) because it composes Console-specific concerns (org context, routing, toasts)
  - Named `useCreateAgentExecution` (not `useCreateExecution`) to leave room for future `useCreateWorkflowExecution`
  - Model registry hardcoded for now; future backend RPC will replace it
  - `@base-ui/react` added as SDK peer dependency for accessible primitives

### Completed: Workspace GitHub OAuth Repo Picker (Session 10)
- Implemented full Phase 1 of GitHub OAuth workspace integration (9 tasks: T1-T8 + Phase 2 docs)
- **Proto**: New `platform/github/v1` bounded context with `GitHubService` (2 RPCs)
- **Go Backend**: `GitHubController` with OAuth code exchange, config via env vars
- **Java Backend** (stigmer-cloud): `@AutoGrpcRouterController` + pipeline handlers
- **SDK TypeScript**: Hand-written `GitHubClient` (non-resource service, like `SearchClient`)
- **SDK React**: `useGitHubConnection` hook, `useGitHubRepos` hook, `GitHubRepoPicker` component
- **WorkspaceEditor redesign**: Two source buttons ("GitHub Repo" / "Local Folder") with progressive disclosure
- **Console**: OAuth callback page, `useDeploymentMode` hook, `SessionLauncher` integration
- **SPA handler**: `.html` extension fallback for static routes
- **Documented**: Phase 2 local folder browser, GitHub App registration task
- **Pending**: GitHub OAuth App registration (manual task — see `tasks/T01_github_app_registration.md`)

### Fixed: Nested Form Hydration Error (Session 9)
- `WorkspaceEditor` (SDK) used a `<form>` element for its add-workspace panel
- When rendered inside `SessionLauncher`'s `<form>`, this created invalid nested `<form>` HTML
- React detected the mismatch and reported two hydration errors
- **Fix**: Replaced `<form>` with `<div>` in `WorkspaceEditor.tsx`, wired `onClick`/`onKeyDown` handlers explicitly
- **Why in SDK**: SDK components must be embeddable in any host element per the platform-for-platforms contract
- Committed: `e9e05648`

### Completed: GitHub OAuth App Registration + Credential Embedding (Session 12)
- Registered "Stigmer Local" and "Stigmer Cloud" GitHub OAuth Apps
- Implemented compile-time credential embedding via Go ldflags (same pattern as `gh` CLI)
- `config.go`: Added `defaultGitHubOAuthClientID`/`defaultGitHubOAuthClientSecret` vars, env vars take precedence
- `Makefile`: Conditional ldflags injection for local dev builds
- `release.cli.yaml`: All 3 CI build jobs inject credentials from GitHub Actions secrets
- Created GitHub Actions secrets: `STIGMER_LOCAL_GITHUB_OAUTH_CLIENT_ID`, `STIGMER_LOCAL_GITHUB_OAUTH_CLIENT_SECRET`
- stigmer-cloud: Created variables-group + secrets-group for cloud deployment, updated base + prod overlay service.yaml
- **Decision**: Embed in binary (like `gh`). Localhost-only OAuth App client_secret has limited attack surface. Accepted industry pattern.

### Fixed: Base Theme Surface Hierarchy (Session 11)
- Base theme tokens in `sdk/theme/src/tokens.css` had zero visual distinction between `card` and `background` in light mode — both were `oklch(1 0 0)`.
- Borders (`oklch(0.922 0 0)`) and muted surfaces (`oklch(0.97 0 0)`) were barely perceptible against white.
- **Fix**: Adjusted 15 token values (12 light, 3 dark) to create a surface elevation ladder: `popover/card (1.0) > background (0.98) > sidebar (0.97) > muted (0.94) > border (0.885) > input (0.87)`.
- Dark mode: bumped border opacity from 10%→14% and input from 15%→20%.
- Fixed 3 token bypasses in `AppShell.tsx` and `Sidebar.tsx`: replaced `foreground/10` with proper `sidebar-border` token.
- No component architecture changes. Preset themes unaffected (they override base tokens).
- Verified visually in both light and dark modes.

### Completed: Local Folder Browser — Phase 2 (Session 13)
- Replaced raw text input for local workspace paths with a backend-powered folder browser
- **Go Backend**: New `api_fs.go` with `GET /api/fs/list` handler — returns sorted directory entries with `cwd`, `home`, and `hidden` flags. `NewSPAHandler()` wraps SPA in `http.ServeMux` for API routing.
- **SDK React**: `useFolderListing` data hook (fetch, abort, LRU cache, `isAvailable` detection) + `FolderBrowser` styled component (breadcrumb path bar, directory list, Home/CWD quick nav, hidden files toggle, keyboard navigation, loading skeletons, error states, graceful fallback to text input)
- **Console**: `WorkspaceEditor` gains `enableFolderBrowser` prop; `SessionLauncher` passes `enableFolderBrowser={deploymentMode === "local"}`
- **Security model**: No path restrictions (industry standard — VS Code, Jupyter, Docker Desktop). `127.0.0.1` binding, OS permissions, read-only endpoint. Cloud mode excluded entirely.
- **Key decisions**: Plain `fetch` (not gRPC) for local-only utility endpoint. `FolderBrowser` in SDK (not Console) for platform builder reuse. Text input preserved as fallback via `enableFolderBrowser=false` default.

### Completed: Reject LocalPathSource in Cloud Backend (Session 14)
- Investigated security and UX implications of `LocalPathSource` entries reaching the cloud backend
- Identified UX gap: API callers can bypass frontend and submit `LocalPathSource` directly, causing late failure in agent runner
- **Java (stigmer-cloud)**: Added `RejectLocalPathWorkspaceStep` inner class in `SessionCreateHandler.java` — pure validation step that rejects `LocalPathSource` entries with `INVALID_ARGUMENT` at API time
- Pipeline placement: after `validateFieldConstraints`, before `authorize` — fail fast before authorization or persistence
- Defense-in-depth: four layers now active (frontend UI hiding → Java API validation → agent runner guard → Daytona sandbox isolation)
- No Go backend changes needed — Go serves both local and cloud modes, and `LocalPathSource` is valid in local mode

### Completed: GitHubClient SDK Parity — Python, Go, Java (Session 16)
- Added handwritten `GitHubClient` to Python, Go, and Java SDKs — full parity with TypeScript
- **Python**: `_github.py` with dataclass params/responses, `grpc.Channel`, `wrap_error`. Wired into `StigmerClient`, exported from `__init__.py`
- **Go**: `github.go` with struct params/responses, `context.Context`, `gen.WrapErr`. Added `GitHub *GitHubClient` to `Client` struct
- **Java**: `GitHubClient.java` with builder-pattern inner classes, `StigmerException.wrap`. Added `github()` accessor to `StigmerClient`
- Each follows its SDK's existing `SearchClient` pattern exactly
- Authorization clarified: `is_skip_authorization` skips FGA checks but NOT authentication — SDK transport unchanged
- Committed: `7f72f0ec`

### Completed: GitHub Repo Picker UX Overhaul + Tailwind CSS Infrastructure Fix (Session 15)
- Fixed critical Tailwind CSS infrastructure bug: SDK's `styles.css` was missing `@source "./**/*.{ts,tsx}";` directive, causing layout-critical utility classes in SDK `.tsx` files to be silently dropped from generated CSS
- Rewrote `GitHubRepoPicker` with owner-grouped sections (personal first, then orgs), recent repos (localStorage), keyboard navigation (Arrow/Enter/Escape), scroll shadows, and search highlighting
- Simplified scroll layout from complex flex nesting (`flex-col max-h-[300px]` + `flex-1 min-h-0` + `h-full`) to simple `max-h-64 overflow-y-auto` matching `FolderBrowser`'s proven pattern
- Refactored `useGitHubRepos` with eager background pagination (PER_PAGE=100, auto-fetches all pages), added `ownerType` field for grouping, `isBackgroundLoading` state
- Added close button and `onCancel` prop to GitHub panel in `WorkspaceEditor`
- Persisted model selection (`stigmer:session:model`) and last folder path (`stigmer:folder:last-path`) to localStorage
- Fixed `SessionLauncher` overflow by replacing `justify-center` with `overflow-y-auto` + `my-auto`
- Changed default folder browser path from CWD to home directory in `api_fs.go`

### Fixed: TypeScript SDK Codegen Proto Serialization Bug (Session 17)
- The `buildXxxProto` functions in all 17 generated TypeScript SDK clients used `Object.assign(create(SpecSchema), { ...allFields })` which copied `undefined` values for omitted optional fields, overwriting protobuf-es defaults (empty `{}` for maps, empty `[]` for repeated) and crashing the binary serializer
- **Root cause**: Single line in `tools/codegen/generator/sdk_client_ts.go` unconditionally emitted all spec fields regardless of optionality
- **Fix**: Added `stripUndefined` utility to codegen — emitted as `sdk/typescript/src/gen/proto-utils.ts`, imported by all resource clients, wraps spec field object in `buildXxxProto` functions
- **Cross-SDK analysis**: Confirmed Go (zero values), Python (`if is not None:` guards), Java (Builder + null checks) are all naturally safe — TypeScript was the only vulnerable SDK
- Regenerated all 17 resource client files via `make -C sdk/typescript codegen`
- Committed: (this session)

### Key Decisions (cumulative)
1. **No MCP server usages** — the assistant is purely general-purpose. Tools come from the runtime.
2. **Minimal instructions** — 5 lines. Identity, mission, tone, action bias, honesty.
3. **No skill_refs, sub_agents, or env_spec** — intentionally omitted to keep the agent as a clean slate.
4. **Fresh start, not incremental refactor** — Deleted all existing UI and rebuilt from scratch.
5. **Web package.json untouched** — Temporarily unused deps will be needed in T01.5/T01.6.
6. **Font declarations kept in layout.tsx** — Six fonts loaded.
7. **Platform-level default agent** — System-wide resource with `visibility_public`, not per-org.
8. **Session ownership follows the caller** — Sessions created in caller's org even when using cross-org public agent.
9. **Labels as first-class store concept** — Go store got `FindByLabel`/`FindAllByLabel` methods.
10. **Toggle visibility, not icon rail** — Binary show/hide sidebar (like Claude/ChatGPT).
11. **Headerless layout** — No top bar. Sidebar owns all controls.
12. **Appearance in user menu** — Theme switching is submenu inside user dropdown.
13. **`border-foreground/10` for borders** — Guaranteed visibility in both themes.
14. **DropdownMenu for OrgSwitcher** — Full-width trigger, radio items with checkmark.
15. **Context panel toggle hidden in T01.4** — No content until T01.6.
16. **`@base-ui/react` Button lacks `asChild`** — Use `buttonVariants` + `cn` on `<Link>` directly.
17. **Hooks follow aggregate boundaries** — `useCreateSession` for Session, `useCreateAgentExecution` for AgentExecution. No orchestration hooks.
18. **`SessionLauncher` is Console-only** — Composes SDK hooks + Console concerns (org, routing, toasts). Not an SDK component.
19. **`useCreateAgentExecution` not `useCreateExecution`** — Future-proofing for workflow executions.
20. **Always two-step flow** — Session is always created explicitly before execution, even without workspace entries. Simpler, consistent, provides sessionId upfront.
21. **`output: "export"` + `__placeholder__` is the correct architecture** — The web console is embedded as static files in the Go CLI binary via `//go:embed`. Dynamic routes use `generateStaticParams()` returning `[{ id: "__placeholder__" }]`. The Go `spaHandler` (`client-apps/cli/embedded/webconsole/handler.go`) explicitly rewrites dynamic route requests to their `__placeholder__` variants. This is not a workaround — it's a properly engineered SPA serving mechanism for the single-binary distribution model. Do NOT switch to `output: "standalone"`.
22. **Dynamic route pattern for static export** — Dynamic routes like `/sessions/[id]` use a server component `page.tsx` (exports `generateStaticParams`) + a client component `SessionPage.tsx` (uses `useParams`). This is the established pattern from the pre-teardown codebase.
23. **SDK components must not use `<form>`** — `WorkspaceEditor` and similar SDK components must avoid `<form>` elements because they may be embedded inside a host application's own form. Use `<div>` with explicit `onClick`/`onKeyDown` handlers instead.
24. **Non-resource gRPC services are hand-written in SDK** — The `stigmer-codegen` tool only generates TypeScript clients for CRUD resources. Non-resource services (Search, GitHub) need hand-written clients following the `SearchClient` pattern.
25. **`platform` bounded context for utility services** — GitHub OAuth lives under `apis/ai/stigmer/platform/github/v1/`. This is for platform-level utilities, not domain resources.
26. **GitHub token in localStorage, not backend DB** — Key `stigmer:github:token`. Ephemeral by design — frontend persists, backend never stores.
27. **Two-button workspace source selection** — "GitHub Repo" and "Local Folder" as action triggers, not tabs. Progressive disclosure via inline dropdowns.
28. **Base theme tokens must establish surface hierarchy** — `card` must differ from `background` in both modes. Minimum ~0.02 OKLCH lightness gap for perceptible elevation. Border tokens need at least ~0.1 gap from adjacent surfaces.
29. **No `foreground/N%` for borders** — Always use the token system (`border-border`, `border-sidebar-border`). Opacity on `foreground` bypasses preset overrides and produces inconsistent results.
30. **Plain `fetch` for local-only utilities** — The `/api/fs/list` endpoint is outside the domain API surface (no proto, no gRPC). `useFolderListing` uses `fetch` directly, not `@stigmer/sdk` clients. Same rationale as `useDeploymentMode` checking the API URL directly.
31. **No filesystem path restrictions** — Industry standard (VS Code, Jupyter, Docker Desktop, code-server) is unrestricted local filesystem access. Security comes from `127.0.0.1` binding and OS permissions, not artificial path limits.
32. **`FolderBrowser` in SDK, not Console** — Platform builders running Stigmer locally need folder selection too. Follows `GitHubRepoPicker` pattern: SDK component with clean props, composed by Console.
33. **`enableFolderBrowser` as opt-in prop** — Default `false` preserves backward compatibility. Text input fallback remains available for cases where the endpoint doesn't exist.
34. **CWD as default starting directory** — Better than home directory because users typically launch `stigmer` from near their projects. The Go endpoint uses `os.Getwd()` when no path is provided.
35. **Cloud backend rejects LocalPathSource at API level** — `RejectLocalPathWorkspaceStep` in `SessionCreateHandler` returns `INVALID_ARGUMENT` immediately, avoiding late failure in agent runner. Not in Go backend because Go serves both local and cloud modes.
36. **`@source` directive required in SDK styles.css** — Tailwind v4 requires explicit `@source` paths for content detection in monorepo setups. Without `@source "./**/*.{ts,tsx}";` in the SDK's stylesheet, Tailwind only scans the consuming app's source files and silently drops SDK-internal class names.
37. **Simple scroll pattern over complex flex nesting** — `max-h-64 overflow-y-auto` directly on the listbox (matching `FolderBrowser`) instead of `flex-col max-h` + `flex-1 min-h-0` + `h-full`. The simple pattern is robust, portable, and avoids subtle CSS height resolution bugs.
38. **Home directory as default folder browser path** — Changed from CWD because users may launch `stigmer` from non-project directories. Home is a more universal starting point for folder browsing.
39. **Utility service SDK clients are handwritten across all SDKs** — `GitHubClient` and `SearchClient` exist as hand-written wrappers in all four SDKs (TypeScript, Python, Go, Java). Will remain manual until the number of utility services justifies extending codegen.
40. **`is_skip_authorization` vs `is_public`** — Two distinct proto options. `is_skip_authorization` removes FGA resource-level checks but keeps authentication (JWT/API-key). `is_public` removes authentication entirely. GitHub OAuth RPCs use `is_skip_authorization` only — callers must still authenticate.

## Next Steps

T01.6 has been decomposed into 5 sub-projects (SP1-SP5). Execute in order:

| # | Sub-Project | Resume File | Depends On |
|---|---|---|---|
| SP1 | Core Thread + Streaming | `20260317.02.sp.core-thread-streaming/next-task.md` | Nothing |
| SP2 | Follow-Up + Conversation Loop | `20260317.03.sp.follow-up-conversation-loop/next-task.md` | SP1 |
| SP3 | Session Context Panel | `20260317.04.sp.session-context-panel/next-task.md` | SP1 |
| SP4 | Expandable Tool Groups | `20260317.05.sp.expandable-tool-groups/next-task.md` | SP1 |
| SP5 | HITL Approvals | `20260317.06.sp.hitl-approvals/next-task.md` | SP1 + SP4 |

SP2, SP3, SP4 are independent of each other after SP1.

After T01.6 sub-projects: **T01.7** — Web — Sidebar Recents

## Context for Resume
- Branch: `feat/session-first-web-ux` (stigmer repo), `feat/session-first-web-ux` (stigmer-cloud repo)
- T01.1 through T01.5 are complete and committed.
- The web app has a headerless sidebar-driven layout with a working session launcher at `/`.
- The React SDK now has three feature modules: `models/`, `workspace/`, `session/`, `execution/`.
- SDK exports: `useModelRegistry`, `ModelSelector`, `useWorkspaceEntries`, `WorkspaceEditor`, `useFolderListing`, `FolderBrowser`, `useCreateSession`, `useCreateAgentExecution`, `useGitHubConnection`, `useGitHubRepos`, `GitHubRepoPicker`.
- The session launcher flow: create session -> create agent execution -> navigate to `/sessions/[id]`.
- `/sessions/[id]/page.tsx` exists as a placeholder — T01.6 builds the actual session view.
- Proto `agent_instance_id` is optional in SessionSpec. Backend resolves default agent instance if omitted.
- Java (stigmer-cloud) has `ResolveDefaultAgentInstanceStep` and `RejectLocalPathWorkspaceStep` in `SessionCreateHandler`.
- Model list is hardcoded in `sdk/react/src/models/registry.ts` (22 models from Python `model_registry.py`). Future: backend RPC.

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260317.01.session-first-web-ux/next-task.md`

## Quick Commands

After loading context:
- "Continue with T01.6" - Start building the active session view
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*

## Sub-Projects

Active sub-projects spawned from this project:

- `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.02.sp.core-thread-streaming/next-task.md` - Build the minimum viable session view at /sessions/[id] with real-time execution streaming, message rendering (markdown), and collapsed tool call summaries. SDK hooks for data fetching and streaming, SDK styled components for messages and tool groups, Console page orchestration.
- `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.03.sp.follow-up-conversation-loop/next-task.md` - Add follow-up input to the session view, enabling users to continue conversations by sending additional messages within the same session. SDK FollowUpInput component with model selector, Console-level orchestration for creating executions and streaming them into the existing thread.
- `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.04.sp.session-context-panel/next-task.md` - Populate the right context panel with execution metadata. Add a context panel slot mechanism so pages can inject content. Build SessionContextContent with execution phase, model, token usage, cost, duration, workspace entries, and resolved context (MCP servers, tools).
- `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.05.sp.expandable-tool-groups/next-task.md` - Make collapsed tool call summaries expandable to reveal individual tool calls with args, results, status, and timing. Add sub-agent sections as expandable nested threads. Two-level progressive disclosure: summary line -> list of tool calls -> individual call detail.
- `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.06.sp.hitl-approvals/next-task.md` - Add human-in-the-loop approval UI to the session view. Build useSubmitApproval behavior hook and ApprovalCard styled component with approve/skip/reject actions. Integrate approval flow into the conversation thread when executions enter WAITING_FOR_APPROVAL phase.
