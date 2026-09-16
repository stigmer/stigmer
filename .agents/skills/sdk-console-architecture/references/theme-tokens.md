# Theme tokens

Every visual property in Stigmer's React surfaces flows through `--stgm-*`
design tokens defined in `sdk/theme/src/tokens.css` and overridden per preset in
`sdk/theme/src/presets/` (`corporate`, `fintech`, `friendly`, `monochrome`,
`startup`; the default preset is the base token set). This reference holds the
concrete patterns that keep that true. The token definitions themselves are the
source; when a name here and the CSS disagree, the CSS wins.

## Token families by rendering context

A component renders in one of three contexts, and each has its own token family.
Using the wrong family produces light text on a light surface in the presets
whose sidebar and main area contrast (corporate, fintech).

### Main content area

The standard tokens: `bg-background`, `text-foreground`, `bg-muted`,
`text-muted-foreground`, `bg-card`, `border-border`, and their relatives.

### Sidebar

The `sidebar-*` family, exclusively:

| Purpose                                    | Token                            |
| ------------------------------------------ | -------------------------------- |
| Background                                 | `bg-sidebar`                     |
| Primary text                               | `text-sidebar-foreground`        |
| Muted or secondary text                    | `text-sidebar-muted-foreground`  |
| Muted background (skeletons, subtle fills) | `bg-sidebar-muted`               |
| Hover or active background                 | `bg-sidebar-accent`              |
| Hover or active text                       | `text-sidebar-accent-foreground` |
| Borders                                    | `border-sidebar-border`          |
| Focus ring                                 | `ring-sidebar-ring`              |
| Primary accent                             | `text-sidebar-primary`           |

### Portaled content

Dropdown menus, dialogs, popovers and anything else rendered through a portal
sits outside the sidebar's DOM tree even when it was opened from the sidebar. It
uses the popover tokens (`bg-popover`, `text-popover-foreground`) or the
main-area tokens, never the sidebar family.

## No opacity modifiers on tokens

Never derive a colour variant from a token with a Tailwind opacity modifier
(`/60`, `/50`). Each preset needs independent control of every value, and an
opacity-derived shade cannot be tuned per preset.

Wrong:

```text
text-sidebar-foreground/60
bg-sidebar-foreground/10
```

Right:

```text
text-sidebar-muted-foreground
bg-sidebar-muted
```

When no token fits, add one to `sdk/theme/src/tokens.css`, give it a value in
every preset file, and wire it into the Tailwind bridge in
`client-apps/web/src/app/globals.css`. Never work around a missing token with an
opacity modifier or a literal colour.

## Interactive elements in non-standard contexts

A button, link or other interactive component placed inside the sidebar, or on
any surface with a non-default background, overrides its hover, focus and active
states with tokens from that context. A `variant="ghost"` button inside the
sidebar, for example:

```tsx
<Button
  variant="ghost"
  className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
>
```

The ghost variant's default `hover:bg-muted` would paint a light background on
the dark sidebar of the corporate and fintech presets.

## Verification

`make lint` runs the `eslint-plugin-stigmer` rules
(`tools/eslint-plugin-stigmer/rules/`), which include:

- `no-main-tokens-in-sidebar`: main-area tokens in a sidebar-context file.
- `no-token-opacity-modifiers`: an opacity modifier on a token class.
- `sdk-import-boundaries`: an import that crosses the package layering.

The rules run under the plugin prefix `stigmer` in each package's ESLint config
(`sdk/react/eslint.config.mjs`, `client-apps/web/eslint.config.mjs`,
`client-apps/desktop/eslint.config.mjs`).

`make check` runs the same rules as part of the full gate. The theme package's
own audit (`sdk/theme/src/contract/`, run by `npm run test -w @stigmer/theme`)
proves every preset resolves every token and meets contrast.
