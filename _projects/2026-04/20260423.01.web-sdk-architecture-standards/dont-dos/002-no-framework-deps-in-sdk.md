# Dont-Do 002: No Framework Dependencies in SDK

**Related**: DD-004 (Zero Framework Dependencies in SDK)

## The Rule

`@stigmer/react` must never import from `next/*`, `next-themes`, or any framework-specific package. No App Router assumptions, no Pages Router assumptions, no framework-specific image optimization, no framework-specific link components.

## Why

Platform builders run React in environments that are not Next.js: Vite, Remix, Gatsby, Create React App, Electron, custom webpack. A `next/router` import in an SDK component fails at build time in every one of those environments. Even within Next.js, an App Router import (`next/navigation`) fails in a Pages Router application and vice versa.

Framework dependencies also create invisible version coupling. If `@stigmer/react` imports `next/image`, it becomes sensitive to the platform builder's Next.js version — breaking when they upgrade or downgrade Next.js for reasons entirely unrelated to Stigmer.

## Detection

```bash
# Must return zero results
rg "from 'next/" sdk/react/src/
rg "from \"next/" sdk/react/src/
rg "require\('next/" sdk/react/src/
rg "next-themes" sdk/react/src/
```

ESLint rule `sdk-import-boundaries` (Workstream C) will automate this check.

## What To Do Instead

| Framework Feature | SDK Alternative |
|---|---|
| `next/router` or `next/navigation` | Accept an `onNavigate` callback prop. The consumer handles routing. |
| `next/image` | Use standard `<img>` elements, or accept an `ImageComponent` prop for consumers who want optimized images. |
| `next/link` | Use standard `<a>` elements with `onClick` handlers, or accept a `LinkComponent` prop. |
| `next-themes` | Use the `colorMode` prop on `StigmerProvider`. The Console bridges `next-themes` state to `colorMode` in its transport bridge component. |
| `next/font` | Use `--stgm-font-*` tokens. The consumer configures fonts at the host application level. |
| `useRouter()` for query params | Accept the values as props. The Console page extracts route params and passes them down. |
