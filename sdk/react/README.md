# @stigmer/react

React provider and client hook for the Stigmer platform SDK. Provides the foundational wiring for connecting React applications to a Stigmer backend — style-isolated and theme-aware.

> Feature components (agent picker, execution stream, session history, etc.) have been removed as part of the session-first UX redesign and will be rebuilt with a platform-for-platforms architecture.

## Install

```bash
npm install @stigmer/react @stigmer/sdk @stigmer/protos
```

Peer dependencies (install alongside):

| Package | Version |
|---------|---------|
| `react` | `^19.0.0` |
| `react-dom` | `^19.0.0` |
| `@stigmer/sdk` | `*` |
| `@stigmer/protos` | `*` |
| `@bufbuild/protobuf` | `^2.0.0` |

## Quick Start

```tsx
import { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "@stigmer/react";
import "@stigmer/react/styles.css";

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

1. **A `Stigmer` client** — see [`@stigmer/sdk`](../typescript/README.md) for configuration options.
2. **`<StigmerProvider>`** — distributes the client to all descendant components and scopes styles.
3. **`@stigmer/react/styles.css`** — the compiled stylesheet. Import once at your application root.

## Provider

`StigmerProvider` wraps your component tree, supplies the SDK client via React context, and renders a `<div class="stgm">` container that scopes all Stigmer styles.

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `client` | `Stigmer` | Yes | A configured `@stigmer/sdk` client instance. |
| `colorMode` | `"light" \| "dark" \| "system"` | No | Controls light/dark appearance. Defaults to `"light"`. |
| `deploymentMode` | `"local" \| "cloud"` | No | Backend deployment mode. Defaults to `"cloud"`. |
| `preset` | `ThemePresetId` | No | Built-in theme preset to apply. Omit for the default Stigmer palette. |
| `className` | `string` | No | Additional CSS classes on the scoping container. |

### `useStigmer()` Hook

Access the client from any descendant component:

```tsx
import { useStigmer } from "@stigmer/react";

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
| `"default"` | Stigmer identity | Teal palette, balanced radius (omit the prop for this) |
| `"corporate"` | Enterprise SaaS | Tight radius, blue accent, cool grays, dark sidebar |
| `"startup"` | Dev tools | Monochrome, violet accent, minimal shadows, snappy transitions |
| `"friendly"` | Consumer SaaS | Very rounded, warm coral, cream surfaces, soft shadows |
| `"fintech"` | Premium financial | Sharp corners, indigo accent, crisp shadows, precise transitions |

Each preset overrides the full token surface. See [`@stigmer/theme` README](../theme/README.md) for the complete token reference and preset details.

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
import { useColorMode } from "@stigmer/react";

function MyComponent() {
  const mode = useColorMode(); // "light" | "dark"
}
```

Returns `"light"` or `"dark"` — never `"system"`. The provider resolves `"system"` before setting context.

## Style Isolation

`@stigmer/react` is designed to embed inside any host application without style conflicts.

- **CSS layer scoping.** All Stigmer styles live inside `@layer stgm`. Host styles in higher-priority layers (or no layer) take precedence over Tailwind's base resets — Stigmer's reset only applies inside the `.stgm` container.
- **Container scoping.** `StigmerProvider` renders a `<div class="stgm">` wrapper. The CSS reset (`box-sizing`, `border-style`, font smoothing) is scoped to `.stgm` and its descendants. Host elements outside this container are unaffected.
- **Token namespacing.** All design tokens use the `--stgm-*` prefix. No collision with host application CSS variables.

This means you can mount `<StigmerProvider>` inside a sidebar, modal, or any section of your page and Stigmer's styles stay contained.

## Exports

| Import path | Content |
|-------------|---------|
| `@stigmer/react` | `StigmerProvider`, `StigmerContext`, `useStigmer`, `useColorMode`, `ColorModeContext` |
| `@stigmer/react` (types) | `StigmerProviderProps`, `ColorMode`, `ResolvedColorMode` |
| `@stigmer/react/styles.css` | Compiled stylesheet (import once at app root) |

## License

Apache-2.0
