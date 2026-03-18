# Task T01: Session Context Composition — Implementation Plan

**Created**: 2026-03-18
**Status**: PENDING REVIEW

## Objective

Add `mcp_server_usages` and `skill_refs` fields to `SessionSpec`, enabling users to attach MCP servers and skills at session creation time. The runtime merges session-level context with agent blueprint capabilities at execution time, making the session launcher the single-screen product pitch: message + workspace + skills + MCP servers + model.

## Architecture

The composition model:

```
Agent blueprint (what the agent IS)
  + Session context (what the user BRINGS)
  = Execution context (what actually runs)
```

Merge semantics:
- **MCP servers**: Agent `mcp_server_usages` **union** Session `mcp_server_usages`. Session-level additions are purely additive new servers — they do not modify the agent's existing server configurations. If both reference the same MCP server slug, session-level takes precedence (allows tool restriction/expansion per session).
- **Skills**: Agent `skill_refs` **union** Session `skill_refs`. Deduplicated by slug. Session-level skills are additive knowledge for this conversation.

The backend (Go/Java) accepts and persists the new fields. The Agent Runner (Python) performs the actual merge when constructing the LangGraph execution graph.

## Scope (Hard Boundaries)

**In scope:**
- Proto: Add `mcp_server_usages` and `skill_refs` to `SessionSpec`
- Stub regeneration: Go, Java, TypeScript proto stubs
- TypeScript SDK: Regenerate session client (stigmer-codegen picks up new fields)
- Go backend: Verify normalization handles new reference fields
- Java backend: Same as Go
- React SDK: Update `useCreateSession` hook, build `McpServerPicker` and `SkillPicker` components
- Web Console: Add MCP server and skill pickers to `SessionLauncher`

**Out of scope (deferred):**
- Agent Runner merge logic (Python) — separate concern, follows once proto + backend are done
- `enabled_tools` selection UI for session-level MCP servers (v1: all tools enabled)
- `tool_approval_overrides` at session level (v1: inherit from MCP server defaults)
- MCP server or skill CRUD from the session launcher (v1: pick existing resources only)

## Task Breakdown

### T01.1: Proto — Add Session-Level Fields

**What**: Add two fields to `SessionSpec` in `apis/ai/stigmer/agentic/session/v1/spec.proto`.

```proto
import "ai/stigmer/agentic/agent/v1/spec.proto";
import "ai/stigmer/commons/apiresource/io.proto";
import "ai/stigmer/commons/apiresource/field_options.proto";

message SessionSpec {
  // ... existing fields 1-6 ...

  // MCP servers to make available in this session (optional, merged with agent's at execution time).
  //
  // Enables users to augment the agent's tool set for a specific conversation
  // without modifying the agent blueprint. Each usage references an McpServer
  // resource; the agent runner merges these with the agent's mcp_server_usages
  // when constructing the execution graph.
  //
  // Merge semantics: session-level additions are union'd with agent-level usages.
  // If both reference the same MCP server slug, the session-level entry takes
  // precedence (enables per-session tool restriction or expansion).
  repeated ai.stigmer.agentic.agent.v1.McpServerUsage mcp_server_usages = 7;

  // Skills to inject into this session's context (optional, merged with agent's at execution time).
  //
  // Enables users to provide domain-specific knowledge for a specific conversation
  // without modifying the agent blueprint. Each reference points to a Skill resource
  // whose content is injected into the agent's context alongside agent-level skills.
  //
  // Merge semantics: union'd with agent-level skill_refs, deduplicated by slug.
  repeated ai.stigmer.commons.apiresource.ApiResourceReference skill_refs = 8 [
    (ai.stigmer.commons.apiresource.reference_kind) = skill,
    (buf.validate.field).repeated.items.cel = {
      id: "session_skill_refs.kind"
      message: "skill_refs must reference resources with kind=skill"
      expression: "this.kind == 43"
    }
  ];
}
```

**Files touched:**
- `apis/ai/stigmer/agentic/session/v1/spec.proto` (edit)

**Acceptance criteria:**
- [ ] `buf lint` passes
- [ ] No circular import issues (session imports agent spec types — verify this is clean)

---

### T01.2: Stub Regeneration

**What**: Regenerate proto stubs for all languages.

**Commands:**
- Go stubs: `make -C apis generate` (or `buf generate`)
- Java stubs: built as part of `stigmer-cloud` Gradle build
- TypeScript protos: `@stigmer/protos` package rebuild

**Files touched (auto-generated):**
- `apis/stubs/go/ai/stigmer/agentic/session/v1/spec.pb.go`
- `stigmer-cloud` Java proto stubs (Gradle)
- `sdk/protos/` TypeScript proto stubs

**Acceptance criteria:**
- [ ] Go stubs compile (`go build ./...` in backend)
- [ ] Java stubs compile (`./gradlew build` in stigmer-cloud)
- [ ] TypeScript protos build (`npm run build` in sdk/protos)

---

### T01.3: TypeScript SDK — Regenerate Session Client

**What**: Run `stigmer-codegen` to regenerate `sdk/typescript/src/gen/session.ts`. The codegen should automatically:
- Add `McpServerUsageInput` and `SkillRefInput` interfaces to `SessionInput`
- Add builder functions (`buildMcpServerUsageProto`, etc.)
- Import the new proto schema types

**Commands:**
- `make -C sdk/typescript codegen`

**Verification:**
- `SessionInput` now includes `mcpServerUsages?: McpServerUsageInput[]` and `skillRefs?: SkillRefInput[]`
- `buildSessionProto` constructs the new repeated fields

**Files touched (auto-generated):**
- `sdk/typescript/src/gen/session.ts`

**Acceptance criteria:**
- [ ] `npm run build` passes for sdk/typescript
- [ ] `SessionInput` type includes the new fields

---

### T01.4: Go Backend — Verify Normalization and Persistence

**What**: Verify that the existing `NormalizeReferences` pipeline step handles the new `ApiResourceReference` fields on SessionSpec. The `McpServerUsage.mcp_server_ref` and `skill_refs` both use `ApiResourceReference`, which the normalize step should auto-discover via proto reflection.

**Investigation:**
- Read `backend/libs/go/grpc/request/pipeline/steps/normalize_references.go` to confirm it traverses nested messages
- If it only normalizes top-level repeated `ApiResourceReference` fields, it may miss `mcp_server_usages[].mcp_server_ref` (nested inside `McpServerUsage`)
- If normalization doesn't traverse nested messages, add explicit handling

**What "normalize" does**: Resolves `{org, kind, slug}` → `{org, kind, slug, id}` by looking up the referenced resource. This ensures the agent runner can load resources by ID without slug resolution.

**Files potentially touched:**
- `backend/libs/go/grpc/request/pipeline/steps/normalize_references.go` (may need nested traversal)
- Session creation pipeline — no changes needed (fields are just persisted)

**Acceptance criteria:**
- [ ] Creating a session with `mcp_server_usages` persists correctly
- [ ] `mcp_server_ref` slugs are resolved to IDs by normalization
- [ ] `skill_refs` slugs are resolved to IDs by normalization
- [ ] `go build ./...` passes

---

### T01.5: Java Backend — Verify Normalization and Persistence

**What**: Same as T01.4 for the Java backend in `stigmer-cloud`. The `normalizeReferences` common step should handle the new fields.

**Investigation:**
- Check if Java `NormalizeReferencesStep` traverses nested messages the same way Go does
- If not, add explicit handling for `McpServerUsage.mcp_server_ref` within session spec

**Files potentially touched:**
- Java normalization step (if nested traversal is needed)
- No pipeline changes needed — fields are persisted by the existing persist step

**Acceptance criteria:**
- [ ] Creating a session with `mcp_server_usages` persists to MongoDB correctly
- [ ] References are normalized (slug → ID)
- [ ] `./gradlew build` passes

---

### T01.6: React SDK — Update `useCreateSession` Hook

**What**: Add `mcpServerUsages` and `skillRefs` to `CreateSessionInput` so platform builders can pass session-level context.

**Changes to `sdk/react/src/session/useCreateSession.ts`:**

```typescript
export interface CreateSessionInput {
  readonly org: string;
  readonly workspaceEntries?: WorkspaceEntryInput[];
  readonly subject?: string;
  // New fields:
  readonly mcpServerUsages?: McpServerUsageInput[];
  readonly skillRefs?: SkillRefInput[];
}
```

The hook passes these through to `stigmer.session.create()`, which flows to the codegen'd `SessionClient`.

**Also update `useSessionConversation`**: If the follow-up flow needs to inherit session-level context, verify the existing session's MCP servers and skills persist across executions within the same session (they should — they're on the session, not the execution).

**Files touched:**
- `sdk/react/src/session/useCreateSession.ts` (edit)

**Acceptance criteria:**
- [ ] `useCreateSession` accepts `mcpServerUsages` and `skillRefs`
- [ ] Values flow through to `stigmer.session.create()`
- [ ] `npm run typecheck` passes

---

### T01.7: React SDK — MCP Server Picker Component

**What**: Build a picker component that lets users search and select MCP servers from the platform.

**Components:**
1. **Data hook: `useMcpServerList`** (`sdk/react/src/mcp-server/useMcpServerList.ts`)
   - Fetches available MCP servers via `stigmer.mcpServer.list()`
   - Configurable `pageSize`, optional org filter
   - Returns `{ mcpServers, isLoading, error }`
   - Follows `useSessionList` pattern

2. **Styled component: `McpServerPicker`** (`sdk/react/src/mcp-server/McpServerPicker.tsx`)
   - Shows available MCP servers as a searchable list
   - Each item shows: name, description, tool count (from discovered_capabilities)
   - User clicks to add/remove from selection
   - `value: McpServerUsageInput[]`, `onChange: (usages: McpServerUsageInput[]) => void`
   - Progressive disclosure: compact "+ MCP Server" button that expands to the picker
   - All `--stgm-*` tokens, embeddable

**Files touched (new):**
- `sdk/react/src/mcp-server/useMcpServerList.ts`
- `sdk/react/src/mcp-server/McpServerPicker.tsx`
- `sdk/react/src/mcp-server/index.ts` (barrel)
- `sdk/react/src/index.ts` (re-export)

**Acceptance criteria:**
- [ ] `McpServerPicker` renders available MCP servers
- [ ] User can search by name
- [ ] Selected servers produce valid `McpServerUsageInput[]`
- [ ] Component is themed via `--stgm-*` tokens
- [ ] Works in both SDK and Console contexts

---

### T01.8: React SDK — Skill Picker Component

**What**: Build a picker component that lets users search and select skills from the platform.

**Components:**
1. **Data hook: `useSkillList`** (`sdk/react/src/skill/useSkillList.ts`)
   - Fetches available skills via `stigmer.skill.list()`
   - Same pattern as `useMcpServerList`

2. **Styled component: `SkillPicker`** (`sdk/react/src/skill/SkillPicker.tsx`)
   - Shows available skills as a searchable list
   - Each item shows: name, description
   - User clicks to add/remove from selection
   - `value: SkillRefInput[]`, `onChange: (refs: SkillRefInput[]) => void`
   - Progressive disclosure: compact "+ Skill" button that expands to the picker
   - All `--stgm-*` tokens, embeddable

**Files touched (new):**
- `sdk/react/src/skill/useSkillList.ts`
- `sdk/react/src/skill/SkillPicker.tsx`
- `sdk/react/src/skill/index.ts` (barrel)
- `sdk/react/src/index.ts` (re-export)

**Acceptance criteria:**
- [ ] `SkillPicker` renders available skills
- [ ] User can search by name
- [ ] Selected skills produce valid `SkillRefInput[]`
- [ ] Component is themed via `--stgm-*` tokens

---

### T01.9: Web Console — SessionLauncher Integration

**What**: Add the MCP server picker and skill picker to the session launcher's controls area, below the workspace editor.

**Layout (updated session launcher):**
```
┌──────────────────────────────────────────┐
│  What would you like to work on?         │
│                                          │
│  [  Type your message...               ] │
│  ┌──────────────────────────────────────┐│
│  │ claude-sonnet-4 ▾  │  1 workspace   ▲││
│  └──────────────────────────────────────┘│
│                                          │
│  📎 Workspace   🔧 MCP Servers  📚 Skills│
│  ├─ github.com/acme/api                  │
│  └─ /Users/dev/local-proj               │
│  + GitHub Repo    + Local Folder         │
│                                          │
│  🔧 mcp-server-github (5 tools)     [×] │
│  + Add MCP Server                        │
│                                          │
│  📚 code-review-best-practices       [×] │
│  + Add Skill                             │
└──────────────────────────────────────────┘
```

**Changes to `SessionLauncher.tsx`:**
- Import `McpServerPicker` and `SkillPicker` from `@stigmer/react`
- Add state for `mcpServerUsages` and `skillRefs`
- Pass to `createSession()` call
- Progressive disclosure: sections appear when user clicks "+ Add MCP Server" / "+ Add Skill"

**Files touched:**
- `client-apps/web/src/components/session/SessionLauncher.tsx` (edit)

**Acceptance criteria:**
- [ ] Session launcher shows MCP server and skill pickers
- [ ] Selected MCP servers and skills flow through to session creation
- [ ] Progressive disclosure — pickers don't overwhelm the clean launcher experience
- [ ] `npm run build` passes for client-apps/web

---

## Implementation Order

```
T01.1 (Proto) ──► T01.2 (Stubs) ──┬──► T01.3 (TypeScript SDK Codegen)
                                    ├──► T01.4 (Go Backend Verification)
                                    └──► T01.5 (Java Backend Verification)
                                              │
                                              ▼
                     T01.6 (React SDK Hook) ──► T01.7 (MCP Server Picker)
                                              ──► T01.8 (Skill Picker)
                                                        │
                                                        ▼
                                              T01.9 (Console Integration)
```

T01.1 → T01.2 are sequential. T01.3/T01.4/T01.5 can run in parallel after stubs. T01.7/T01.8 can run in parallel. T01.9 depends on T01.6-T01.8.

## Design Decisions to Record

1. **Reuse `McpServerUsage` from agent spec** — Session uses the exact same `McpServerUsage` message type as `AgentSpec`. This keeps the ubiquitous language consistent and means the agent runner can use the same merge/resolution code for both sources.

2. **Additive union, not override** — Session-level MCP servers and skills are added to (not replacing) the agent's. If both reference the same slug, session-level takes precedence. This enables users to both extend and refine per-session.

3. **Merge happens in Agent Runner, not backend** — The Go/Java backend just persists the session with the new fields. The Python Agent Runner loads both agent and session, performs the merge, and constructs the execution graph. This keeps the backend simple and the merge logic co-located with the LLM orchestration code.

4. **`enabled_tools` omitted from UI in v1** — The MCP server picker attaches the entire server (all tools). Tool-level filtering is deferred — it requires knowing the server's discovered tools, which adds complexity. Users who need fine-grained tool control create a custom Agent blueprint.

5. **No environment variable UI in v1** — If a session-level MCP server requires env vars (e.g., API keys), the user must configure them on the AgentInstance or provide them via `runtime_env` on the execution. The session launcher doesn't collect env vars — that's a configuration concern, not a conversation-start concern.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `NormalizeReferences` doesn't traverse nested `McpServerUsage.mcp_server_ref` | Investigate in T01.4/T01.5 — add explicit handling if needed |
| Proto import cycle (session → agent) | Verify with `buf lint` — `SessionSpec` imports `McpServerUsage` from agent spec, which is a leaf type with no back-references |
| Session-level MCP servers need env vars the user hasn't provided | Fail-fast at execution time with clear error: "MCP server X requires env var Y" |
| UI complexity in session launcher | Progressive disclosure — pickers hidden behind "+ Add" buttons, default experience unchanged |
| Agent Runner merge logic not in scope | Document merge contract in proto comments; runner implementation follows as a separate task |

## Next Steps After T01

- T02: Agent Runner merge implementation (Python) — merge session-level MCP servers and skills with agent-level when constructing LangGraph
- T03: Session context panel update — show session-level MCP servers and skills in the right panel
- T04: `enabled_tools` picker for session-level MCP servers (v2)
