---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says the brand colour is set by overriding the kit's `--stgm-*` colour tokens in a theme class (for example `--stgm-primary` with its foreground partner) applied through `StigmerProvider`.
- Says dark mode follows their next-themes toggle by passing its resolved theme to `StigmerProvider`'s `colorMode`, and each overridden token also needs a dark value, or the light value leaks into dark mode.
- Says the font is set through the kit's font token (for example `--stgm-font-sans`) on the same theme class, and their page loads Söhne itself.
- Says the approval prompt can be restyled without building the chat from scratch, for example by replacing its `ApprovalCard` slot, or by building their own markup from the `@stigmer/react-core` hooks.

**FAIL if**

- It has them override Stigmer's internal class names.
- It uses `!important` on the components' markup.
- It has them fork or copy the kit's source, or edit `node_modules`.
- It invents props or tokens the docs don't name (such as `theme={{ primaryColor }}` or `brandColor`).
- It says the approval prompt cannot be changed.
- It tells them they must drop the SDK and write their own streaming client to restyle the chat.

**Welcome**

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
