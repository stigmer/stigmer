What a good answer may also say. Never graded: leaving any of it out fails nothing.

- The components read every colour, radius and font from `--stgm-*` custom properties, so the markup never changes.
- Overriding `--stgm-ring` and `--stgm-radius` as part of the brand.
- Fills keep a readable foreground pair when a fill is replaced.
- `colorMode` takes `"light"`, `"dark"` or `"system"`.
- Starting from a preset (`preset="corporate"` with its CSS imported).
- Styles are scoped (`stg:` prefix, `.stgm` scope, `@layer stgm`) so the host's CSS and Stigmer's don't collide.
- Portaled dialogs keep the theme.
- No rewrite of the agent side is needed to change the approval prompt.
- The theme class is passed through `className` on `StigmerProvider`, and the dark values go under the `[data-stgm-color-mode="dark"]` selector.
- The font also needs `font-family: var(--stgm-font-sans)` on the theme class.
- The slot is replaced through `threadSlots` (on `AgentChat` or `SessionViewer`, the `slots` prop of `MessageThread`); on the hooks route `useSessionConversation` gives `asks` and `answerToolUse(id, "allow" | "deny")`.
