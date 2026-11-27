# Host stylesheets

The stylesheets a new app starts with, as the tools that make them write them,
so the kit's tests can mount Stigmer's components under what a real host page
carries (stigmer/stigmer#3491). Kept byte for byte; formatting never touches
them (`.prettierignore`).

| File | Source | Version |
| --- | --- | --- |
| `create-next-app.css` | `create-next-app`'s `app/globals.css`, the template without Tailwind | the template the first-hour journey's Next.js app is written from |
| `create-vite-9.4.0.css` | `create-vite`'s `template-react-ts/src/index.css`: the app the embed tutorial has you make (`npm create vite@latest`) | `create-vite` 9.4.0 (2026-11-26; unchanged since 9.3.0) |
| `create-vite-8.3.0.css` | the same file before 9.0, which styled every `button`: apps made before 2026-03-12 still carry it | `create-vite` 8.3.0 |
| `tailwindcss-3.4.19-preflight.css` | `tailwindcss/src/css/preflight.css`, its `theme()` calls resolved to Tailwind 3's defaults | `tailwindcss` 3.4.19 |
| `tailwindcss-4.2.1-preflight.css` | `tailwindcss/preflight.css` (a page imports it into `@layer base`) | `tailwindcss` 4.2.1 |

All three projects are MIT-licensed.

Readers: `sdk/react/src/__tests__/styles-host-styles.layout.browser.test.tsx`,
`sdk/react/src/agent-chat/__tests__/agent-chat-host-page.layout.browser.test.tsx`
and the first-hour journey's apps (`test/e2e/helpers/embed-tutorial.ts`).
