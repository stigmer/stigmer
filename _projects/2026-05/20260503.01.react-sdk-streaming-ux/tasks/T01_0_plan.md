# Task T01: React SDK Streaming UX — Master Plan

**Created**: 2026-05-03
**Status**: PENDING REVIEW
**Type**: Refactoring
**Research Report**: `_projects/2026-05/research.react-sdk-streaming-ux-quality/04.report.gpt.md`

⚠️ **This plan requires your review before execution**

## Problem Statement

The `@stigmer/react` SDK's message thread and session experience suffer from three classes of visual quality issues:

1. **Streaming flicker** — During token streaming, the entire thread re-renders on every gRPC snapshot because full `AgentExecution` objects replace React state, defeating memoization and causing react-markdown to re-parse all content.
2. **Navigation flash** — Switching between sessions shows the old session's messages briefly before the new session loads (stale-while-revalidate doesn't clear stale data on identity change).
3. **Long conversation degradation** — No virtualization, no memoization on child components, all items in DOM.

The research report provides a clear 11-phase roadmap. This plan maps those phases into actionable tasks.

## Architecture Target

Replace the current "stream snapshot becomes component state" approach with:

```
Connect stream
    → stream controller (abort, coalesce, rAF batch)
        → normalize by stable ID
        → preserve unchanged refs (structural sharing)
        → commit once per frame via startTransition
            → external ConversationStore (useSyncExternalStore)
                → selector hooks (useThreadItem, useThreadOrder, useStreamStatus)
                    → MessageThread rows (memoized, subscribe by ID)
                    → SessionComposer (isolated, local state only)
```

## Task Breakdown (11 Phases)

Each phase is independently shippable and testable. Phases are ordered by impact.

---

### Phase 0: Instrument and Baseline (T02)
**Complexity:** S | **Impact:** High | **Estimated:** 1 session

Add observability to understand the current render behavior:
- [ ] React Profiler traces around `MessageThread`, `MessageEntry`, `SessionComposer`
- [ ] Render count dev helper (dev-only `useRenderCount()`)
- [ ] Stream event rate logging in `useExecutionStream`
- [ ] Commit duration logging
- [ ] Count of DOM nodes in thread
- [ ] Key stability assertions (dev-only: warn if a row key changes between renders without an actual item change)

**Success criteria:**
```
During token streaming, confirm:
- How many rows re-render per stream event (expect: all — this is the problem)
- Commit duration per stream tick
- react-markdown parse time per render
- Composer render count per stream tick
```

---

### Phase 1: Fix Keys and Pending Reconciliation (T03)
**Complexity:** S–M | **Impact:** Very High | **Estimated:** 1 session

This alone may eliminate visible flicker if remounting is the main culprit:
- [ ] Replace all index-based keys (`e${ei}-m${mi}`) with semantic keys derived from stable server IDs (message ID, tool call ID, execution ID)
- [ ] Preserve pending user message row ID across the pending → server transition (same key so React updates in place instead of unmount/remount)
- [ ] Ensure collapse state in `ThinkingMessage`, `ToolCallGroup`, `SubAgentSection` is keyed by semantic ID (not lost on re-render)
- [ ] Add dev-mode assertions that keys don't change for the same logical item

**Files affected:**
- `sdk/react/src/execution/MessageThread.tsx` — `buildThreadItems()` key generation
- `sdk/react/src/session/useSessionConversation.ts` — pending message reconciliation

---

### Phase 2: Structural-Sharing Snapshot Ingestion Store (T04)
**Complexity:** M–L | **Impact:** Highest | **Estimated:** 2-3 sessions

This is the architectural foundation:
- [ ] Build `ConversationStore` — a tiny internal store using `useSyncExternalStore`
- [ ] Normalize incoming `AgentExecution` snapshots into entity maps:
  - `messages: Map<string, AgentMessage>`
  - `toolGroups: Map<string, ToolCall[]>`
  - `subAgents: Map<string, SubAgentExecution>`
  - `approvals: Map<string, PendingApproval>`
- [ ] Structural sharing: compare entities by stable ID, reuse old references for unchanged entities
- [ ] Maintain a `threadItemIds: string[]` that only changes when items are added/removed/reordered
- [ ] Stop passing full `activeStreamExecution` to the thread — pass `sessionId` and let rows subscribe
- [ ] `ConversationCacheProvider` wraps the session pane for per-session store instances

**Key design decisions:**
- Store is internal to `@stigmer/react` (not exposed as public API)
- No external dependency (Zustand pattern but custom `useSyncExternalStore`)
- Entity comparison uses protobuf message field equality, not deep JS equality

---

### Phase 3: Row-Level Subscriptions and Memoization (T05)
**Complexity:** M | **Impact:** High | **Estimated:** 1-2 sessions

- [ ] `MessageThread` subscribes only to `threadItemIds` via selector
- [ ] New `ThreadRow` component: `React.memo`, receives only `itemId`, subscribes to its own entity from the store
- [ ] `MessageEntry` wrapped in `React.memo`, receives primitives (content string, isStreaming boolean, messageType)
- [ ] `ToolCallGroup` wrapped in `React.memo`, subscribes to its tool calls by ID
- [ ] `SubAgentSection` wrapped in `React.memo`
- [ ] `ApprovalCard` wrapped in `React.memo`
- [ ] Verify: during streaming, only the active assistant row re-renders

**Target component tree:**
```
<MessageThread>
  subscribes to: threadItemIds
  renders: itemIds.map(id => <ThreadRow key={id} itemId={id} />)

  <ThreadRow itemId="msg_abc">
    subscribes to: store.getItem("msg_abc")
    renders: <MessageEntry content={...} isStreaming={...} />
  </ThreadRow>
</MessageThread>
```

---

### Phase 4: Stream Controller State Machine (T06)
**Complexity:** M | **Impact:** High | **Estimated:** 1-2 sessions

Rewrite `useExecutionStream` as a controller (not a `useState(snapshot)` hook):
- [ ] Single finite state machine: `idle → connecting → awaiting-first-snapshot → streaming → terminal-merging → complete → error`
- [ ] Replace multiple `setState` calls with single store transitions
- [ ] `AbortController` management with run-ID stale-event guard
- [ ] Latest-wins `requestAnimationFrame` coalescing (buffer latest snapshot, commit at most once per frame)
- [ ] Terminal snapshots flush immediately (no rAF delay for completion)
- [ ] Eliminate old → null → new gap: keep a stable assistant/execution row through all states
- [ ] Wrap store commits in `startTransition` so thread updates don't block composer input

**Files affected:**
- `sdk/react/src/execution/useExecutionStream.ts` — full rewrite
- `sdk/react/src/session/useSessionConversation.ts` — remove cascading effects that mirror stream data

---

### Phase 5: Streaming Markdown Upgrade (T07)
**Complexity:** S (if Streamdown) | **Impact:** High for long AI messages | **Estimated:** 1 session

- [ ] Evaluate Streamdown for active streaming messages
- [ ] Split-path rendering:
  - Completed messages: `react-markdown` (parse once, freeze)
  - Active streaming message: Streamdown (incremental, streaming-optimized)
  - On completion: swap to finalized render if needed
- [ ] Ensure code blocks, GFM tables, and lists render correctly with incomplete Markdown during streaming
- [ ] Bundle size check: Streamdown vs react-markdown incremental cost

**Files affected:**
- `sdk/react/src/execution/MessageEntry.tsx` — `AiMessage` component
- `sdk/react/package.json` — add Streamdown dependency

---

### Phase 6: Data Fetching / Cache Fix (T08)
**Complexity:** M | **Impact:** Very High for navigation | **Estimated:** 2 sessions

**Console app:**
- [ ] Replace `useFetch` with TanStack Query (or Connect Query) for `useSession`, `useSessionExecutions`
- [ ] Key all queries by `[sessionId, org]`
- [ ] Set appropriate `staleTime` and `gcTime`
- [ ] On session key change: show cached target data or skeleton — never show old session's data under new session's route
- [ ] Load session + executions atomically (parallel queries, render when both ready)

**SDK:**
- [ ] Implement minimal keyed conversation cache in `ConversationStore` (Phase 2 store)
- [ ] Previously visited sessions render instantly from cache, background refetch
- [ ] Optional TanStack Query adapter export for Console and advanced consumers

**Files affected:**
- `sdk/react/src/internal/useFetch.ts` — deprecate or keep as fallback
- `sdk/react/src/session/useSession.ts`, `useSessionExecutions.ts` — switch to keyed cache
- `client-apps/web/src/domain/session/SessionPage.tsx` — key the session pane by `sessionId`
- `client-apps/web/src/domain/_shared/layout/Sidebar.tsx` — stable sidebar rendering

---

### Phase 7: Composer Isolation (T09)
**Complexity:** S–M | **Impact:** High for perceived quality | **Estimated:** 1 session

- [ ] Move composer container into a sibling subtree outside the stream-rendering path
- [ ] Wrap `SessionComposer` in `React.memo`
- [ ] Stabilize all callback props with `useCallback` (ensure referential stability)
- [ ] Keep textarea state local and urgent (never inside `startTransition`)
- [ ] Verify: composer does not re-render during token streaming

**Files affected:**
- `sdk/react/src/composer/SessionComposer.tsx`
- `client-apps/web/src/domain/session/SessionPage.tsx` — layout split

---

### Phase 8: Auto-Scroll State Machine (T10)
**Complexity:** M | **Impact:** High | **Estimated:** 1 session

Replace current simple near-bottom check with a proper state machine:
- [ ] Track at-bottom state with `IntersectionObserver` on a bottom sentinel element
- [ ] Follow mode: auto-scroll on new content when at bottom
- [ ] Disengage: stop following when user scrolls up
- [ ] Re-engage: resume following when user scrolls back to bottom (sentinel visible)
- [ ] "Jump to latest" button when disengaged and new content arrives
- [ ] Use `requestAnimationFrame` for scroll writes (no layout thrashing)
- [ ] Set `overflow-anchor: none` on controlled scroller
- [ ] Handle tool expansion height changes (re-evaluate follow state)

**Files affected:**
- `sdk/react/src/execution/MessageThread.tsx` — scroll management

---

### Phase 9: Virtualization (T11)
**Complexity:** M–L | **Impact:** High for long conversations | **Estimated:** 2 sessions

- [ ] Add optional `virtualized` prop to `MessageThread` (default: false for backward compat)
- [ ] Integrate `react-virtuoso` core for variable-height items
- [ ] Bottom-anchored chat layout with `alignToBottom` + `followOutput`
- [ ] Test with: dynamic tool panels, code blocks, streaming tail, collapsible sections
- [ ] Auto-enable virtualization above ~100 thread rows (or expose threshold prop)
- [ ] Ensure auto-scroll state machine (Phase 8) works with virtualized list

**Files affected:**
- `sdk/react/src/execution/MessageThread.tsx` — conditional virtualization
- `sdk/react/package.json` — add `react-virtuoso` as optional peer dep

---

### Phase 10: Animation and Perceived Polish (T12)
**Complexity:** S–M | **Impact:** Medium | **Estimated:** 1 session

- [ ] CSS row entry transitions with `@starting-style` (new messages slide/fade in)
- [ ] Skeleton placeholders for session load and stream connect states
- [ ] Streaming caret animation (already exists, refine)
- [ ] `content-visibility: auto` for off-screen thread items (performance)
- [ ] Respect `prefers-reduced-motion`
- [ ] Optional Framer Motion adapter (not in core — future enhancement)

**Files affected:**
- `sdk/react/src/styles.css` — animation classes
- `sdk/react/src/execution/MessageEntry.tsx` — entry animations

---

## Execution Order and Dependencies

```
Phase 0 (Instrument) ──→ Phase 1 (Keys) ──→ Phase 2 (Store) ──→ Phase 3 (Row Subs)
                                                    │
                                                    ├──→ Phase 4 (Stream Controller)
                                                    ├──→ Phase 5 (Markdown)
                                                    └──→ Phase 6 (Cache/Navigation)

Phase 3 + Phase 4 ──→ Phase 7 (Composer Isolation)
Phase 3 ──→ Phase 8 (Auto-Scroll) ──→ Phase 9 (Virtualization)
Phase 9 ──→ Phase 10 (Polish)
```

- Phases 0-1 can ship independently as quick wins
- Phase 2 is the foundation — Phases 3-6 depend on it
- Phases 4, 5, 6 are independent of each other (can parallelize)
- Phase 7 can start after Phase 3+4
- Phase 9 depends on Phase 8

## Success Criteria (Overall Project)

1. **During token streaming:** only the active assistant row re-renders frequently; completed rows do not remount; composer does not re-render per token
2. **Session navigation:** no flash of wrong content; instant render from cache for previously visited sessions
3. **Long conversations (100+ messages):** smooth scrolling and rendering on mid-tier hardware
4. **SDK bundle size:** increase stays under 15KB gzipped for core changes
5. **Backward compatibility:** existing `MessageThread` and `SessionComposer` props continue to work
6. **Accessibility:** `role="log"`, `aria-live="polite"`, `aria-relevant="additions"` preserved; screen readers announce new messages
7. **All existing tests pass** after each phase

## Principles

1. **Fix the data flow shape first** — don't chase flicker with scattered `useMemo` or one-off `React.memo` wrappers
2. **Each phase is independently shippable** — the codebase is better after each phase, not worse
3. **SDK-first** — changes go in `@stigmer/react`, Console consumes; no framework deps in SDK
4. **Measure before and after** — Phase 0 instrumentation validates every subsequent phase

## Review Process

**What happens next**:
1. **You review this plan** — consider priorities, ordering, scope
2. **Provide feedback** — any phases to skip, reorder, or split?
3. **I'll revise** — create `T01_2_revised_plan.md` incorporating feedback
4. **You approve** — execution begins with Phase 0

**Please consider:**
- Does the phase ordering make sense?
- Any phases you'd skip or defer?
- Any concerns about the `ConversationStore` approach (Phase 2)?
- Should TanStack Query (Phase 6) be SDK-level or Console-only?
- Is Streamdown acceptable as a new dependency (Phase 5)?
