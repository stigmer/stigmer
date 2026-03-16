# @stigmer/react

React hooks and embeddable components for the Stigmer platform. Drop pre-built agent UIs into any React application with full theming control and style isolation.

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
| `@base-ui/react` | `^1.0.0` |
| `class-variance-authority` | `^0.7.0` |
| `lucide-react` | `>=0.400.0` |
| `react-markdown` | `^10.0.0` |
| `remark-gfm` | `^4.0.0` |

## Quick Start

```tsx
import { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "@stigmer/react";
import { AgentPicker } from "@stigmer/react/agent";
import "@stigmer/react/styles.css";

const client = new Stigmer({
  baseUrl: "https://api.stigmer.io",
  getAccessToken: () => auth.getToken(),
});

function App() {
  return (
    <StigmerProvider client={client} preset="corporate">
      <AgentPicker onSelect={(agent) => console.log(agent)} />
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

.my-brand.dark,
.dark .my-brand {
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

Stigmer components respond to the `.dark` class on `<html>` (or any ancestor). The provider uses a descendant selector (`&:is(.dark *)`) so dark mode works regardless of where the provider is mounted in the DOM.

```html
<!-- Host application controls dark mode -->
<html class="dark">
  <body>
    <!-- StigmerProvider inherits dark mode automatically -->
  </body>
</html>
```

No additional configuration is needed. If your host application toggles `.dark` on `document.documentElement`, Stigmer components follow automatically.

### Token Categories

All tokens use the `--stgm-*` namespace. The full reference is in [`@stigmer/theme` README](../theme/README.md). Key categories:

| Category | Tokens | Notes |
|----------|--------|-------|
| Colors (core) | `--stgm-background`, `--stgm-foreground`, `--stgm-primary`, `--stgm-secondary`, `--stgm-muted`, `--stgm-accent`, `--stgm-card`, `--stgm-popover` | Each has a `-foreground` counterpart |
| Colors (semantic) | `--stgm-destructive`, `--stgm-success`, `--stgm-warning`, `--stgm-info` | Each has a `-foreground` counterpart |
| Colors (form) | `--stgm-border`, `--stgm-input`, `--stgm-ring` | |
| Colors (chart) | `--stgm-chart-1` through `--stgm-chart-5` | Data visualization palette |
| Typography | `--stgm-font-sans`, `--stgm-font-mono` | |
| Shape | `--stgm-radius` | Base border radius |
| Shadows | `--stgm-shadow-sm`, `--stgm-shadow-md`, `--stgm-shadow-lg` | Override per mode — dark surfaces need higher opacity |
| Transitions | `--stgm-transition-duration`, `--stgm-transition-timing` | Applied to all `transition-*` Tailwind utilities |
| Z-index | `--stgm-z-popover` | Stacking context for overlay components |

## Style Isolation

`@stigmer/react` is designed to embed inside any host application without style conflicts.

- **CSS layer scoping.** All Stigmer styles live inside `@layer stgm`. Host styles in higher-priority layers (or no layer) take precedence over Tailwind's base resets — Stigmer's reset only applies inside the `.stgm` container.
- **Container scoping.** `StigmerProvider` renders a `<div class="stgm">` wrapper. The CSS reset (`box-sizing`, `border-style`, font smoothing) is scoped to `.stgm` and its descendants. Host elements outside this container are unaffected.
- **Token namespacing.** All design tokens use the `--stgm-*` prefix. No collision with host application CSS variables.

This means you can mount `<StigmerProvider>` inside a sidebar, modal, or any section of your page and Stigmer's styles stay contained.

## Components and Hooks

Components are organized by domain and available via subpath imports.

### `@stigmer/react/agent`

| Export | Type | Description |
|--------|------|-------------|
| `AgentPicker` | Component | Searchable agent picker with keyboard navigation |
| `AgentCard` | Component | Card displaying agent name, icon, badges, and resource counts |
| `AgentOverview` | Component | Detailed agent view with collapsible instructions |
| `useAgentSearch` | Hook | Search agents with debounced query and pagination |

### `@stigmer/react/session`

| Export | Type | Description |
|--------|------|-------------|
| `AgentSessionHistory` | Component | Paginated list of recent sessions for an agent |
| `SessionCard` | Component | Card displaying session subject and timestamps |
| `useAgentSessionList` | Hook | Fetch paginated session list for an agent |

### `@stigmer/react/agent-execution`

| Export | Type | Description |
|--------|------|-------------|
| `ExecutionStream` | Component | Scrollable message stream with tool calls and approval controls |
| `ExecutionStatus` | Component | Badge displaying execution phase (running, waiting, completed) |
| `OutputBlock` | Component | Markdown output with optional streaming cursor |
| `ToolCallCard` | Component | Collapsible card for a tool call with input/output and approval |
| `ApprovalControls` | Component | Approve / reject / skip controls for HITL (Human-in-the-Loop) |
| `SubAgentCard` | Component | Collapsible card for sub-agent execution |
| `MessageInput` | Component | Textarea with send button for user messages |
| `MessageEntry` | Component | Routes a message to the appropriate renderer |
| `HumanMessageBubble` | Component | Styled bubble for human messages |
| `SystemMessageBlock` | Component | Block for system messages |
| `useAgentExecution` | Hook | Manage execution lifecycle — create, stream, and track phase |
| `useApproval` | Hook | Submit approval decisions for tool calls requiring HITL |

### `@stigmer/react/catalog`

| Export | Type | Description |
|--------|------|-------------|
| `ResourceSearchCard` | Component | Card for cross-resource search results (agents, skills, MCP servers) |
| `formatRelativeTime` | Utility | Format a timestamp as relative time (e.g., "3 hours ago") |
| `toDate` | Utility | Convert protobuf `Timestamp` to a JavaScript `Date` |

### `@stigmer/react/skill`

| Export | Type | Description |
|--------|------|-------------|
| `useSkillSearch` | Hook | Search skills with debounced query and pagination |

### `@stigmer/react/mcp-server`

| Export | Type | Description |
|--------|------|-------------|
| `useMcpServerSearch` | Hook | Search MCP (Model Context Protocol) servers with debounced query and pagination |

## Exports

| Import path | Content |
|-------------|---------|
| `@stigmer/react` | `StigmerProvider`, `StigmerContext`, `useStigmer` |
| `@stigmer/react/agent` | Agent components and `useAgentSearch` hook |
| `@stigmer/react/session` | Session components and `useAgentSessionList` hook |
| `@stigmer/react/agent-execution` | Execution stream components, `useAgentExecution`, `useApproval`, helpers |
| `@stigmer/react/catalog` | `ResourceSearchCard`, time utilities |
| `@stigmer/react/skill` | `useSkillSearch` hook |
| `@stigmer/react/mcp-server` | `useMcpServerSearch` hook |
| `@stigmer/react/styles.css` | Compiled stylesheet (import once at app root) |

## License

Apache-2.0
