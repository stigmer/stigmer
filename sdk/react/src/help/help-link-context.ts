"use client";

// Whether the kit's own failure notes end with the server's help link: the
// switch `StigmerProvider`'s `showHelpLink` sets. Off by default, because
// the kit also renders inside apps builders make for their own users, whose
// help is the builder's; a console turns it on. Internal: hosts set it
// through the provider prop, never this context.

import { createContext, useContext } from "react";

/** @internal */
export const ShowHelpLinkContext = createContext<boolean>(false);

/** Whether the host turned the failure notes' help line on. @internal */
export function useShowHelpLink(): boolean {
  return useContext(ShowHelpLinkContext);
}
