---
type: llm
---

PASS if the answer uses the documented theming, not CSS hacks:
- the components read every color, radius and font from `--stgm-*` CSS custom properties; a custom theme is a class overriding the tokens they care about (for example `--stgm-primary` with its `--stgm-primary-foreground` partner, `--stgm-ring`, `--stgm-radius`), passed through `className` on `StigmerProvider`;
- each overridden token also gets a dark value (the `[data-stgm-color-mode="dark"]` selector), because a light-only override leaks into dark mode, and fills keep a readable foreground pair;
- dark mode follows their toggle through `StigmerProvider`'s `colorMode` (`"light"`, `"dark"` or `"system"`), passing next-themes' resolved theme straight through;
- the font is set with `--stgm-font-sans` and `font-family: var(--stgm-font-sans)` on the same class, and their page loads the font itself;
- the approval prompt: structure, not just colors, is changed through component slots (the `ApprovalCard` slot on `MessageThread`, `threadSlots` on `SessionViewer`), or by building their own chat markup from the `@stigmer/react-core` hooks, where `useSessionConversation` gives `asks` and `answerToolUse(id, "allow" | "deny")`; no rewrite of the agent side is needed.
Welcome but optional: starting from a preset (`preset="corporate"` with its CSS imported); styles being scoped (`stg:` prefix, `.stgm` scope, `@layer stgm`) so the host's CSS and Stigmer's don't collide; portaled dialogs keep the theme.

FAIL if the answer has them override Stigmer's internal class names, use `!important` on the components' markup, fork or copy the kit's source, or edit `node_modules`; invents props or tokens the docs don't name (such as `theme={{ primaryColor }}` or `brandColor`); says the approval prompt cannot be changed; or tells them they must drop the SDK and write their own streaming client to restyle the chat.
