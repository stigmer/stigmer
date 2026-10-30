# @stigmer/react-sdk

React components and hooks for [Stigmer](https://stigmer.ai), the open-source backend for the agents in your product. Ships the same session, run, and resource surfaces the Stigmer Console is built from — style-isolated, theme-aware, and embeddable in any React application. This README covers the foundational wiring (provider, theming, local run); the full hook and component catalog is documented in the [React SDK reference](https://stigmer.ai/docs/sdk/react), and the [Put the agent in your app](https://stigmer.ai/docs/getting-started/embed-agent) tutorial is the fastest path to a working embed.

## Install

```bash
npm install @stigmer/react-sdk @stigmer/client @stigmer/apis @bufbuild/protobuf lucide-react
```

`react` and `react-dom` 19 must already be installed. Every other package the
kit needs to draw comes with it.

Peer dependencies, all on the install line:

| Package | Version | Needed by |
|---------|---------|-----------|
| `react`, `react-dom` | `^19.0.0` | everything |
| `@stigmer/client` | `*` | everything: the client the provider takes |
| `@stigmer/apis` | `*` | everything: the API's message types |
| `@bufbuild/protobuf` | `^2.8.0` | everything: the runtime of those types |
| `lucide-react` | `>=0.400.0` | every component: the icons |

The heavier parts of the kit (the YAML editor's CodeMirror, the virtualized
thread) come with it and are downloaded only when a screen first uses them.

### Diagrams

A ```` ```mermaid ```` fence in an agent's reply, a file or a skill draws as a
diagram when you hand the kit `mermaid`. It is large, so the kit does not
install it: install it yourself and pass its import to the provider, which
your bundler splits into a chunk fetched on the first diagram. Without it a
diagram shows as its source.

```bash
npm install mermaid
```

```tsx
<StigmerProvider client={client} loadMermaid={() => import("mermaid")}>
  <App />
</StigmerProvider>
```

## Quick Start

```tsx
import { Stigmer } from "@stigmer/client";
import { StigmerProvider } from "@stigmer/react-sdk";
import "@stigmer/react-sdk/styles.css";

const client = new Stigmer({
  baseUrl: "https://api.stigmer.ai",
  getAccessToken: () => auth.getToken(),
});

function App() {
  return (
    <StigmerProvider client={client} preset="corporate">
      <YourApp />
    </StigmerProvider>
  );
}
```

Three things are required:

1. **A `Stigmer` client** — see [`@stigmer/client`](../typescript/README.md) for configuration options.
2. **`<StigmerProvider>`** — distributes the client to all descendant components and scopes styles.
3. **`@stigmer/react-sdk/styles.css`** — the compiled stylesheet. Import once at your application root.

## The chat in one component

`AgentChat` is the whole chat: the first message, then the conversation. It imports from `@stigmer/react-sdk/chat`, the lightest entry, which draws the composer before the conversation's renderers have loaded.

```tsx
import { AgentChat, StigmerProvider } from "@stigmer/react-sdk/chat";

<StigmerProvider client={client}>
  <AgentChat agent="acme/variance-reporter" variant="popup" />
</StigmerProvider>
```

| `variant` | Frame |
|-----------|-------|
| `"page"` (default) | Fills the box it is given |
| `"panel"` | Fills a column you dock beside your page, under a header naming the agent |
| `"popup"` | A button in the corner that opens the chat beside it; closed, the button says what the agent is doing |

The popup never traps focus or takes a key from your page: Escape closes it while focus is inside, and closing returns focus to its button. The chat writes no storage; keep the id `onSessionChange` hands you and pass it back as `defaultSessionId` to reopen a conversation after a reload. The default audience is `"endUser"`, a person signed in to your product.

## Provider

`StigmerProvider` wraps your component tree, supplies the SDK client via React context, and renders a `<div class="stgm">` container that scopes all Stigmer styles.

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `client` | `Stigmer` | Yes | A configured `@stigmer/client` client instance. |
| `colorMode` | `"light" \| "dark" \| "system"` | No | Controls light/dark appearance. Defaults to `"light"`. |
| `deploymentMode` | `"local" \| "cloud"` | No | Backend deployment mode. Defaults to `"cloud"`. |
| `executionTarget` | `"local" \| "cloud"` | No | Default execution target for sessions created in this provider. Omit to let the server decide. See [Local Execution](#local-execution). |
| `runnerAdapter` | `RunnerAdapter` | No | Runner lifecycle adapter, required when `executionTarget` is `"local"`. Omit for cloud. See [Local Execution](#local-execution). |
| `publicBaseUrl` | `string` | No | The absolute address the Stigmer API is reached at from outside the page, for the URLs components show a user to copy (channel-app webhook URLs, the user-token snippet). Omit when the client's `baseUrl` is absolute; pass it when the client uses a relative `baseUrl` behind a same-origin proxy. Without either, those surfaces say the address is unknown. |
| `preset` | `ThemePresetId` | No | Built-in theme preset to apply. Omit for the default Stigmer palette. |
| `className` | `string` | No | Additional CSS classes for theming. Applied to the scoping container *and* mirrored onto the portal container, so token overrides reach portaled surfaces — not a layout channel (see [Style Isolation](#style-isolation)). |

### `useStigmer()` Hook

Access the client from any descendant component:

```tsx
import { useStigmer } from "@stigmer/react-sdk";

function MyComponent() {
  const stigmer = useStigmer();
  // stigmer.agent.get(id), stigmer.session.list(...), etc.
}
```

Throws if called outside a `<StigmerProvider>`.

## Theming

### Built-in Presets

Pass a `preset` prop to apply a complete design language — colors, border radius, shadows, transitions, and sidebar appearance for both light and dark modes.

```tsx
<StigmerProvider client={client} preset="fintech">
  {children}
</StigmerProvider>
```

| Preset | Archetype | Description |
|--------|-----------|-------------|
| `"default"` | Stigmer identity | Black and white, typographic, tight radius (omit the prop for this) |
| `"corporate"` | Enterprise SaaS | Tight radius, blue accent, cool grays, dark sidebar |
| `"startup"` | Dev tools | Monochrome, violet accent, minimal shadows, snappy transitions |
| `"friendly"` | Consumer SaaS | Very rounded, warm coral, cream surfaces, soft shadows |
| `"fintech"` | Premium financial | Sharp corners, indigo accent, crisp shadows, precise transitions |
| `"monochrome"` | Stigmer identity | The default look, named; kept for code that sets it |

Each preset overrides the full token surface. See [`@stigmer/design-tokens` README](../theme/README.md) for the complete token reference and preset details.

### Custom Token Overrides

Override any `--stgm-*` CSS custom property to match your product's design language. Only override what you need — everything else falls through to defaults (or the active preset).

```css
.my-brand {
  --stgm-primary: oklch(0.6 0.2 220);
  --stgm-primary-foreground: oklch(0.985 0 0);
  --stgm-radius: 0.5rem;
  --stgm-shadow-md: 0 4px 12px rgb(0 0 0 / 0.08);
  --stgm-transition-duration: 120ms;
}

.my-brand[data-stgm-color-mode="dark"],
[data-stgm-color-mode="dark"] .my-brand {
  --stgm-primary: oklch(0.75 0.18 220);
  --stgm-primary-foreground: oklch(0.145 0 0);
  --stgm-shadow-md: 0 4px 12px rgb(0 0 0 / 0.3);
}
```

Apply the class via `className`:

```tsx
<StigmerProvider client={client} className="my-brand">
  {children}
</StigmerProvider>
```

You can combine `preset` and `className`. The `className` overrides cascade on top of the preset.

### Dark Mode

Pass `colorMode` to control the appearance of all descendant Stigmer components. No ancestor CSS classes, no Tailwind conventions, no host DOM requirements.

```tsx
// Explicit dark mode
<StigmerProvider client={client} colorMode="dark">
  {children}
</StigmerProvider>

// Follow the user's OS preference
<StigmerProvider client={client} colorMode="system">
  {children}
</StigmerProvider>
```

| Value | Behavior |
|-------|----------|
| `"light"` | Light design tokens (default). |
| `"dark"` | Dark design tokens. |
| `"system"` | Tracks `prefers-color-scheme` and updates automatically when the OS preference changes. |

The resolved mode is set as a `data-stgm-color-mode` attribute on the scoping container. All `--stgm-*` token overrides and Tailwind `dark:` utilities activate from this attribute — the provider is fully self-contained.

#### Bridging from a host theme system

If your host application already manages dark mode (MUI, Chakra, `next-themes`, etc.), pass the resolved value directly:

```tsx
// MUI
const muiMode = useTheme().palette.mode; // "light" | "dark"
<StigmerProvider client={client} colorMode={muiMode}>

// Chakra
const { colorMode } = useColorMode(); // "light" | "dark"
<StigmerProvider client={client} colorMode={colorMode}>

// next-themes
const { resolvedTheme } = useTheme();
const colorMode = resolvedTheme === "dark" ? "dark" : "light";
<StigmerProvider client={client} colorMode={colorMode}>
```

#### `useColorMode()` hook

Read the resolved color mode from any descendant component:

```tsx
import { useColorMode } from "@stigmer/react-sdk";

function MyComponent() {
  const mode = useColorMode(); // "light" | "dark"
}
```

Returns `"light"` or `"dark"` — never `"system"`. The provider resolves `"system"` before setting context.

## Style Isolation

`@stigmer/react-sdk` is designed to embed inside any host application without style conflicts.

- **CSS layer scoping.** All Stigmer styles live inside `@layer stgm`. Host styles in higher-priority layers (or no layer) take precedence over Tailwind's base resets — Stigmer's reset only applies inside the `.stgm` container.
- **Container scoping.** `StigmerProvider` renders a `<div class="stgm">` wrapper. The CSS reset (`box-sizing`, `border-style`, font smoothing) is scoped to `.stgm` and its descendants. Host elements outside this container are unaffected.
- **Token namespacing.** All design tokens use the `--stgm-*` prefix. No collision with host application CSS variables.

This means you can mount `<StigmerProvider>` inside a sidebar, modal, or any section of your page and Stigmer's styles stay contained.

### Sizing

The scoping container ships with no layout styling — it sizes to its content, so document-flow embeddings need nothing. For fixed-height embeddings (docked panes, split layouts), height-filling components like `SessionViewer` need a percentage-height chain to reach them; opt the container into that chain from host CSS:

```css
.stgm[data-stgm-root] {
  height: 100%;
  min-height: 0;
}
```

This is opt-in rather than an SDK default because `height: 100%` is not safe in arbitrary layouts (under a `flex-1` parent it resolves against the flexed size and balloons) — only the host knows its layout.

Two marker attributes are stable public selectors: `data-stgm-root` on the in-tree container, `data-stgm-portal` on the portal container appended to `document.body`. A popup opened inside an SDK modal dialog renders inside that dialog instead, so it is not under `[data-stgm-portal]`. See the [theming guide](../../docs/sdk/theme/theming.mdx) for the full sizing and embedding reference.

## Local Execution

By default, agent runs execute in the cloud — the Stigmer server provisions a sandbox with a runner. Desktop apps, CLIs, and self-hosted deployments can instead execute runs on the client. Two provider props control this.

### `executionTarget`

Sets where sessions created within the provider run:

| Value | Behavior |
|-------|----------|
| `"local"` | The client provides the runner — a desktop app, CLI, or customer-managed runner process. |
| `"cloud"` | The server provisions a cloud sandbox automatically. |
| `undefined` (default) | The server decides based on deployment context — local for OSS/self-hosted, cloud for managed. |

This is an app-level setting: every session created in the provider tree inherits it. For one-off overrides, `@stigmer/client` accepts a per-call `executionTarget` on `session.create()`, which takes precedence over the provider value.

### `runnerAdapter`

When `executionTarget` is `"local"`, the SDK must start and stop the client's runner at the right moments. It does this through a `RunnerAdapter` you supply — the SDK never manages runner processes directly.

```tsx
import { StigmerProvider } from "@stigmer/react-sdk";
import { useTauriRunnerAdapter } from "./useTauriRunnerAdapter";

function App() {
  const adapter = useTauriRunnerAdapter();
  return (
    <StigmerProvider client={client} executionTarget="local" runnerAdapter={adapter}>
      <YourApp />
    </StigmerProvider>
  );
}
```

Cloud consumers omit `runnerAdapter` entirely.

#### The `RunnerAdapter` interface

```ts
interface RunnerAdapter {
  onSessionOpened(sessionId: string): Promise<void>;
  onSessionClosed(sessionId: string): Promise<void>;
}
```

SDK hooks call these methods at the matching lifecycle points — but only when a `runnerAdapter` is provided **and** the resolved execution target is `"local"`. A Session is a long-lived, multi-turn conversation with **no terminal phase**, so its worker is tied to whether the session is open: it is attached while the session view is open and detached when it closes.

| Method | Invoked by | When |
|--------|------------|------|
| `onSessionOpened` | `useSessionConversation` (and the new-session flow's eager attach) | While a local session is open — re-attaching on every open, so follow-ups always have a poller. |
| `onSessionClosed` | `useSessionConversation` | When the session view closes (unmount or session change). |

> Implement `onSessionOpened` / `onSessionClosed` **idempotently** — `onSessionOpened` can be called again for an already-open session (e.g. on re-open), and the reference desktop adapter maps them to `addSession` / `removeSession`, which already de-duplicate. Adapter errors are swallowed for the session view so a transient runner hiccup never crashes an open conversation.

If your runner backend already exposes `addSession` / `removeSession` (a `RunnerWorkerHost`), build the adapter in one call with `createRunnerAdapter(host)` instead of hand-writing the two methods — this is how the reference Tauri implementation wires itself. See the [runner embedding guide](https://stigmer.ai/docs/guides/runners/embedding) for the full desktop (local) and web (cloud) walkthrough.

## Exports

The package's entries are tiers over one set of modules, so a context or a
cache is the same whichever entry it is imported from.

| Import path | Content |
|-------------|---------|
| `@stigmer/react-sdk/chat` | The chat alone: `AgentChat`, `StigmerProvider` and `useStigmer`, with their props' types. The lightest entry, held to its own size budget |
| `@stigmer/react-sdk` | What a product embeds: `StigmerProvider` and every component, with every hook and helper of `./headless` |
| `@stigmer/react-sdk/headless` | The hooks, helpers, contexts and their types alone: no component, and nothing that imports `react-dom`, `lucide-react`, `@base-ui/react` or a stylesheet. For a host that draws its own chat; the terminal kit (`@stigmer/ink-ui`) builds on it |
| `@stigmer/react-sdk/console` | The Stigmer console's own parts: the platform operator's consoles, the settings navigation and sections, the user menu and the sidebars. Versioned with the kit, shaped by the console's needs rather than an embedder's |
| `@stigmer/react-sdk/styles.css` | Compiled stylesheet (import once at app root) |
| `@stigmer/react-sdk/test` | Test builders and the scenario catalogue of named conversation states |

The [React SDK reference](https://stigmer.ai/docs/sdk/react) names, on each
page, the entry its exports import from.

## License

Apache-2.0
