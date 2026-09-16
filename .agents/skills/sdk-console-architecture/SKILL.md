---
name: sdk-console-architecture
description:
  The architecture decisions behind the TypeScript SDK packages (@stigmer/react,
  @stigmer/theme, @stigmer/sdk) and the client apps that are thin shells over
  them, each with its reason, plus the theme-token reference. Use when adding or
  changing a hook, a component, a token, a streaming view, or any wiring between
  a client app and an SDK component.
paths:
  - sdk/react/**
  - sdk/theme/**
  - client-apps/web/src/**
  - client-apps/desktop/src/**
---

# SDK and console architecture

Stigmer is a platform for platforms. Every line of UI code answers one question:
would a platform builder embedding Stigmer in their product need this? If yes,
it belongs in the SDK packages. The client apps (`client-apps/web`,
`client-apps/desktop`) are reference implementations; the SDK packages are the
product. The package guides (`sdk/AGENTS.md`, `client-apps/AGENTS.md`) carry the
one-line laws; this skill carries the decisions behind them, with the reason
each was taken, so that a change which bends one knows what it is bending.

## The layered architecture

| Package               | Role                                                   | Allowed dependencies                      |
| --------------------- | ------------------------------------------------------ | ----------------------------------------- |
| `@stigmer/sdk`        | Typed API clients generated from the protobuf contract | `@stigmer/protos`                         |
| `@stigmer/react`      | Data hooks, behaviour hooks, styled components         | `@stigmer/sdk`, `@stigmer/theme`, `react` |
| `@stigmer/theme`      | `--stgm-*` tokens, presets, the `cn()` utility         | none beyond `clsx` and `tailwind-merge`   |
| `client-apps/web`     | The Next.js console: routing, app shell, page layout   | the SDK packages, `next/*`                |
| `client-apps/desktop` | The Tauri app: Vite, React Router, native integrations | the SDK packages, `@tauri-apps/*`         |

Dependencies flow downward only. The SDK never imports from a client app; client
apps never import from each other. `sdk-import-boundaries` in
`tools/eslint-plugin-stigmer/rules/` enforces the direction.

## The decisions

Each decision is named; cite it by name in code comments and reviews.

**SDK first.** Build every feature in `@stigmer/react` first (data hook, then
behaviour hook, then styled component) and consume it from a client app second.
When placement is uncertain, default to the SDK: extraction later is harder than
inclusion now.

**Thin shells.** Page files are routes and layout only, with no domain logic. A
page file that grows past a screen of layout and imports is carrying logic that
belongs in the SDK.

**Headless first.** Three layers, each independently importable: data hooks (API
data through `@stigmer/sdk`), behaviour hooks (interaction logic and state
machines), styled components (hooks composed with `@stigmer/theme` tokens). A
platform builder adopts at the layer that fits: full control with hooks only,
partial control with hooks and their own rendering, zero effort with the styled
components. `useSession()` without `<SessionViewer />` must be a valid import.

**No framework dependencies in the SDK.** `@stigmer/react` has no `next/*`, no
`@tauri-apps/*`, no routing, no app-shell auth, no framework assumption; it runs
in any React environment. Navigation and image optimisation are the consumer's
responsibility, reached through callback props. The `"use client"` directive is
not a framework import: it is part of the React Server Components specification
and a no-op string for bundlers that do not know it.

**Theme tokens only.** Every visual property flows through `--stgm-*` tokens,
scoped to the `.stgm` container and `@layer stgm`, using the token family the
rendering context calls for. The reference is
[references/theme-tokens.md](references/theme-tokens.md).

**Error messages are the interface.** Every error states what happened, why, and
what to do. A hook used outside its provider throws a message naming the
provider to add; a data hook returns a typed error state; a styled component
renders meaningful error UI, never a blank screen.

**Generated types are the source of truth.** `@stigmer/protos` feeds
`@stigmer/sdk`, which feeds `@stigmer/react`. Never hand-write a type that
duplicates a generated one; never raw-fetch beside a generated client. Derived
types (`Pick`, `Omit`, UI extensions) are fine.

**One provider.** `StigmerProvider` and `useStigmer()` are the only injection
point. The five-minute integration is: install, create a client, wrap in the
provider, import a component. SDK hooks use `useStigmer()` and nothing else; a
second provider needs a written reason.

**The streaming pipeline.** Real-time views ride one pipeline: a stream source,
the StreamController state machine (`idle`, `connecting`, `streaming`,
`reconnecting`, `complete`, `error`;
`sdk/react/src/internal/stream-controller.ts`), request-animation-frame
coalescing (buffer the latest, commit at most once per frame), structural
sharing (walk the tree by natural keys and keep unchanged references),
`startTransition`, `useSyncExternalStore`, and `React.memo` on the leaves. Never
`useState(snapshot)` for a high-frequency stream: it re-renders the whole tree
on every frame. Completion is phase-driven (a terminal execution phase or an
explicit signal), never inferred from the stream ending.

**Reference stability is architectural.** A hook that returns an object literal
wraps it in `useMemo`; a callback's dependencies name the specific method used
(`conv.sendFollowUp`, not `conv`). These are not micro-optimisations; they are
what makes `React.memo` downstream work at all.

**Opt-in behaviour changes.** A new behaviour that changes DOM structure, scroll
behaviour, rendering strategy or bundle dependencies is opt-in through a prop
with a backward-compatible default (`virtualized?: boolean` defaults to
`false`). Automatic threshold switching mid-session is forbidden: it remounts,
loses state and resets scroll.

**Dependency licence policy.** The SDK packages use only MIT- or
Apache-2.0-compatible dependencies. A commercial-licence dependency is isolated
to a client app; a dependency that imposes obligations on SDK consumers is a
blocker.

**Lazy loading for optional heavy dependencies.** A large library most consumers
will not use (`react-virtuoso` is the case in the tree,
`sdk/react/src/internal/VirtualizedThread.tsx`) is imported through `React.lazy`
and `Suspense` and declared as an optional peer dependency, so it is never
bundled when the feature is unused.

**Cache across mounts, reset by key.** `key={id}` remounts are the correct React
pattern for a clean state reset; `useFetch` consumers pass a `cacheKey` for
cross-mount persistence (instant render of previously fetched data, refetch in
the background). The two coexist: the cache gives `useFetch` memory, the key
gives hooks clean resets.

**Animation accessibility.** All animation respects `prefers-reduced-motion`
(`sdk/react/src/internal/motion-preference.ts`), using a `0.01ms` duration
rather than `0ms` so `animationEnd` and `transitionEnd` callbacks still fire.
Class-based animation, not `@starting-style`, wherever virtualization recycles
DOM nodes, because `@starting-style` fires on every insertion including a
recycled mount. Animation CSS lives in `@layer stgm` with `--stgm-motion-*`
properties.

**Client-app parity.** Every client app consuming the same SDK component wires
its props identically, allowing only platform differences such as routing or
native APIs. When a fix or a feature changes how one client wires a component,
every other consumer of that component is reviewed and updated in the same
changeset. Unexplained divergence between clients is a defect. The check applies
to every shared component and matters most for `SessionComposer`,
`MessageThread`, `ModelSelector` and the flow hooks (`useSessionPageFlow`,
`useNewSessionFlow`).

**Resilient streaming.** Long-lived streaming hooks recover from transient drops
with exponential backoff and full jitter before showing any error. A
non-terminal interruption enters `reconnecting`, keeps the last-known-good state
visible (`error` stays `null`, `isReconnecting` is true), and surfaces a
terminal error only when retries are exhausted. `isTransientStreamError` in
`@stigmer/sdk` (`sdk/typescript/src/errors.ts`) classifies transient against
deterministic; not-found, validation and auth errors never retry. Reconnect is
on by default and tunable through `autoReconnect` and `reconnectOptions`;
`reconnect()` is the manual fallback. Every consumer of `streamState.stage`
treats `reconnecting` as live.

**Node-resolvable ESM output.** The SDK packages are consumed by bundlers and by
plain Node (the `stigmer` CLI, `npx @stigmer/mcp-server`). Node ESM needs an
explicit extension on every relative specifier, so the packages write the `.js`
suffix on every relative import, export and dynamic import under
`moduleResolution: "bundler"`, the convention the CLI, the Ink package, the MCP
server and the generated protos already follow. An extension-less specifier
resolves under a bundler and crashes every Node consumer with
`ERR_MODULE_NOT_FOUND`, and development never catches it because tests run under
`tsx` (stigmer/stigmer#209). The `.js` is a no-op for Vite and is stripped for
Turbopack by `client-apps/web/turbopack-js-to-ts-loader.js`, which must cover
`from`, dynamic `import(` and side-effect forms. `scripts/verify-esm-node.mjs`
enforces the invariant before publish.

**The scoping container's layout contract.** `StigmerProvider`'s in-tree
container ships with no sizing and must never gain a default. A default
`height: 100%` looks harmless under auto-height parents and balloons under a
flex-item parent, because flexbox treats a flexed size as definite for
percentage resolution; a `flex-1` prose column would grow the container to the
full column height even on a content-sized page (measured on the docs site).
Fixed-height embedding (stigmer/stigmer#260) is an explicit opt-in the host
applies from its own CSS:
`.stgm[data-stgm-root] { height: 100%; min-height: 0 }`. Two marker attributes
are stable public selectors: `data-stgm-root` on the in-tree container only and
`data-stgm-portal` on the portal container only, never both on one element. The
`className` prop is a theming channel mirrored onto both scope containers and
must never become a layout channel.
`sdk/react/src/__tests__/provider-theme-scope.test.tsx` pins the markers and
`sdk/react/src/__tests__/provider-container.layout.test.tsx` pins the layout in
a real browser.

**Console chrome is SDK-owned.** `WorkspaceSidebar` and `SettingsSidebar` are
public `@stigmer/react` surfaces rendered by the web console, the desktop app
and the documentation tours (`demos/tours/_shared/`), so the depicted chrome
cannot drift from the product (stigmer/stigmer#317). Per-host differences enter
only through named seams: `renderLink` (the host's router link, or an inert row
in a tour), the `footer` slot (each host's user menu), `renderEntryAccessory`
(the desktop's background-run indicator), and data as props (`useRecentActivity`
output or frozen fixtures, plus a `now` instant for deterministic hosts). The
app-shell frame (column width, collapse state, zone switching, responsive
wrapping) stays client-app-owned under Thin shells. Never re-transcribe sidebar
markup into a client app or a demo scene; extend the component's seams. The same
holds for every depicted surface: a demo scene renders the real SDK organism
with fixture data and hand-draws only documented page framing.

## Dont-dos

1. No client-app imports in the SDK: nothing from `client-apps/web`,
   `client-apps/desktop` or an `@/` path.
2. No framework dependencies in the SDK: no `next/*`, `next-themes`,
   `@tauri-apps/*`.
3. No hard-coded colours or sizes: no hex values, no `text-[14px]`, no
   `bg-white`.
4. No opacity modifiers on tokens: a dedicated variant
   (`text-sidebar-muted-foreground`), never a `/60` suffix; a missing variant is
   a new token.
5. No technical-role folders in client apps: group by domain, as
   `client-apps/web/src/domain/` and `client-apps/desktop/src/pages/` do, never
   by role (a hooks folder, a services folder).
6. No `useState(snapshot)` for streaming data.
7. No whole-object dependencies in `useCallback` or `useMemo`.
8. No `@starting-style` in virtualized contexts.
9. No single-client fix for shared SDK wiring: find every consumer across the
   client apps and fix them all.

## Integration ergonomics

SDK APIs are user interfaces. Method names, hook return types, component props,
error messages and TypeScript intellisense are the surfaces a platform builder
touches every day.

- Clean props, sensible defaults, minimal required configuration.
- If a developer cannot get a component running in five minutes, the developer
  experience has failed.
- Hooks are exported beside styled components.
- Naming is critical: a name becomes part of the platform builder's codebase and
  is expensive to change.
- Every exported hook, component and type is a public API contract.

## Before writing any component

1. Does it belong in the SDK or a client app? Default to the SDK.
2. Can it be themed through `--stgm-*` tokens without leaking styles?
3. Does it work identically embedded in a third-party dashboard and in the
   console?
4. Are its hooks exported independently of its styled component?
5. Does it use generated types from `@stigmer/sdk`, not hand-written ones?
6. If it changes how a client app wires an SDK component, has every client app
   been updated?
