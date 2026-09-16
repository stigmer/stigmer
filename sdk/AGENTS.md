# Agent guide: sdk

The published client surface: `typescript` (`@stigmer/sdk`), `react`, `theme`,
`ink` and `embed` in TypeScript, and the `go`, `python` and `java` SDKs. The
TypeScript packages are the product the web console and the desktop app are thin
shells over; a platform builder embedding Stigmer consumes the same packages.
This guide is an index; the READMEs and headers it names are the truth.

## Read in this order

- `README.md` and `CONTRIBUTING.md`: what each SDK is for and how each is built.
- `typescript/src/index.ts` and `react/src/index.ts`: the barrels are the public
  contract; `react/README.md` for the provider, theming, style isolation and
  local execution.
- `theme/README.md`, `theme/src/tokens.css`, `theme/src/presets/` and
  `theme/src/contract/`: the `--stgm-*` tokens, the presets, and the audit that
  proves every preset resolves and contrasts.
- `react/src/internal/stream-controller.ts` and
  `react/src/internal/useAutoScroll.ts` headers: the streaming pipeline and the
  sentinel-driven scroll; `react/src/internal/dev/` for the render tracer.
- `react/eslint.config.mjs` and `tools/eslint-plugin-stigmer/rules/`: the
  boundaries and token rules the linter enforces.
- `go/README.md`, `python/README.md`, `java/README.md`: the language SDKs keep
  their own conventions there.
- `.agents/ARCHITECTURE_PRINCIPLES.md`: SDK-first and cross-surface parity are
  principles, not preferences.

## Laws, every SDK

- Generated types are the source of truth. Each SDK's `gen` directory is written
  by `make codegen`; no hand-written copy of a generated type, no raw fetch
  beside a generated client.
- Every export is a public API. Renaming or removing one is a breaking change
  with a migration path; the barrel is where the surface is reviewed.
- Dependencies are MIT or Apache-2.0 compatible; a licence that binds the
  consumer is a blocker.

## Laws, the TypeScript SDKs

- SDK first. A feature is a data hook, then a behaviour hook, then a styled
  component in `@stigmer/react`; each layer imports independently. If a platform
  builder could need it, it does not go in a client app.
- Zero framework dependencies in `@stigmer/react`: no `next/*`, no
  `@tauri-apps/*`, no client-app imports; navigation and image handling are
  callback props.
- One provider. `StigmerProvider` and `useStigmer()` are the only injection
  point; a hook used outside its provider throws a message naming the provider
  to add.
- Every visual property flows through `--stgm-*` tokens inside the `.stgm` scope
  and `@layer stgm`: no hard-coded colours or sizes, no opacity modifiers on
  token classes, the right token family for the context (sidebar, popover,
  main). A missing token is added to `theme/src/tokens.css` and every preset,
  never worked around.
- Streaming views ride the StreamController pipeline into
  `useSyncExternalStore`, never `useState(snapshot)`; completion is
  phase-driven, never inferred from a stream ending; auto-scroll is the
  sentinel, never scroll arithmetic. Only the changing row re-renders.
- Reference stability is architectural: object-literal hook returns are memoised
  and callback dependencies name the method used, not the containing object.
- New behaviour that changes DOM, scroll or bundle is opt-in with a
  backward-compatible default; no automatic switching mid-session.
- Relative specifiers carry `.js` (`scripts/verify-esm-node.mjs` gates the
  published output).
- Embedded components announce new messages to screen readers and never trap
  focus, hijack shortcuts or inject global styles.

## Skills

- `.agents/skills/sdk-console-architecture/SKILL.md`: every decision above with
  its reason, the dont-dos, and the theme-token reference. Load it before a new
  hook, component, token or streaming view.

## Verify

The root map's rows for `sdk/typescript`, `sdk/react` and `sdk/ink`, plus
`npm run typecheck -w @stigmer/theme && npm run test -w @stigmer/theme`,
`npm run typecheck -w @stigmer/embed && npm run test -w @stigmer/embed`,
`make gen-sdk-docs-check` when an exported symbol or a token changes,
`make -C sdk/go verify`, `make -C sdk/python codegen-verify`,
`make -C sdk/java verify` for the language SDKs.
