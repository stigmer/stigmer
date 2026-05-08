"use client";

import { createContext, useContext } from "react";

/**
 * React context that holds a reference to the managed portal container.
 *
 * `StigmerProvider` creates a `<div>` appended to `document.body` with
 * the same scoping attributes (`class="stgm [preset]"`,
 * `data-stgm-color-mode`) as the main provider container. This ensures
 * that portaled content (popovers, dialogs, menus) inherits the correct
 * design token values — including dark-mode overrides — even though it
 * lives outside the provider's DOM subtree.
 *
 * Defaults to `null` so components rendered outside a `StigmerProvider`
 * fall back to the browser's default portal target (`document.body`).
 *
 * @internal Consumed by SDK components; not part of the public API.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

/**
 * Returns the managed portal container for the nearest `StigmerProvider`.
 *
 * SDK components that use `Popover.Portal`, `Dialog.Portal`,
 * `Select.Portal`, or `Menu.Portal` pass the returned element as the
 * `container` prop so that portaled content inherits `--stgm-*` design
 * tokens (including dark-mode values).
 *
 * Returns `null` when called outside a `StigmerProvider`, which makes
 * Base UI portals fall back to `document.body`. This keeps components
 * functional (though un-themed) when used standalone.
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
export function useStigmerPortalContainer(): HTMLElement | null {
  return useContext(PortalContainerContext);
}
