"use client";

import { createContext, useContext } from "react";

/**
 * React context that holds a reference to the managed portal container.
 *
 * `StigmerProvider` creates a `<div>` appended to `document.body` that
 * carries the identical theme scope as the main provider container —
 * the same class (`stgm` + preset class + any host `className`) and the
 * same `data-stgm-color-mode`. Both containers derive this from a single
 * source (`useThemeScope` in `provider.tsx`), so they cannot drift apart.
 * This ensures portaled content (popovers, dialogs, menus) inherits the
 * correct design token values — including dark-mode overrides and host
 * `className`-scoped token overrides — even though it lives outside the
 * provider's DOM subtree (where the cascade would otherwise not reach it).
 *
 * Three states, chosen to map EXACTLY onto Base UI's `container` prop
 * semantics so the value can be passed straight through:
 *
 * - `undefined` (the default — no `StigmerProvider` above): Base UI
 *   falls back to `document.body`, so standalone components stay
 *   functional (though un-themed).
 * - `null` (published by `StigmerProvider` during its first paint and
 *   under SSR, before the portal `<div>` mounts): Base UI treats an
 *   explicit `null` as "wait for a container" — the popup holds off
 *   for a frame instead of flashing un-themed into `document.body`,
 *   then re-portals into the themed container the moment it mounts.
 * - an `HTMLElement` (the mounted themed container): portaled content
 *   renders inside it and inherits the `--stgm-*` token scope.
 *
 * The default MUST stay `undefined`, never `null`: an explicit `null`
 * makes Base UI portals render NOWHERE, which breaks every popup for
 * consumers embedding components outside a provider (stigmer-cloud#271).
 *
 * @internal Consumed by SDK components; not part of the public API.
 */
export const PortalContainerContext = createContext<
  HTMLElement | null | undefined
>(undefined);

/**
 * Returns the managed portal container for the nearest `StigmerProvider`.
 *
 * SDK components that use `Popover.Portal`, `Dialog.Portal`, or
 * `Menu.Portal` pass the returned value straight through as the
 * `container` prop so that portaled content inherits `--stgm-*` design
 * tokens (including dark-mode values).
 *
 * The return value is deliberately three-state, mirroring Base UI's
 * `container` prop semantics so no coalescing is needed at call sites:
 *
 * - `undefined` — no `StigmerProvider` above. Base UI portals fall
 *   back to `document.body`, keeping components functional (though
 *   un-themed) when used standalone. Never coerce this to `null`:
 *   Base UI treats an explicit `null` as "wait for a container" and
 *   renders the popup nowhere.
 * - `null` — a `StigmerProvider` exists but its themed portal
 *   container has not mounted yet (first paint, SSR). Base UI waits
 *   for the container instead of flashing un-themed content into
 *   `document.body`, then re-portals once it mounts.
 * - an `HTMLElement` — the mounted themed container.
 *
 * Platform builders who create custom portaled components should use
 * this hook to target the same container as the built-in SDK components.
 *
 * @example
 * ```tsx
 * import { Popover } from "@base-ui/react/popover";
 * import { useStigmerPortalContainer } from "@stigmer/react";
 *
 * function MyPopover() {
 *   const portalContainer = useStigmerPortalContainer();
 *
 *   return (
 *     <Popover.Root>
 *       <Popover.Trigger>Open</Popover.Trigger>
 *       <Popover.Portal container={portalContainer}>
 *         <Popover.Positioner>
 *           <Popover.Popup>Content</Popover.Popup>
 *         </Popover.Positioner>
 *       </Popover.Portal>
 *     </Popover.Root>
 *   );
 * }
 * ```
 */
export function useStigmerPortalContainer(): HTMLElement | null | undefined {
  return useContext(PortalContainerContext);
}
