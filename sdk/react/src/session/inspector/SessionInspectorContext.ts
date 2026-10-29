// The seam between a session viewer and its inspector. The viewer owns the
// conversation and the panel's controller; the inspector is a part the host
// passes in (`<SessionViewer inspector={<SessionInspector />} />`). The viewer
// provides this scope around the element it was given, and SessionInspector
// reads it, so the viewer never imports the inspector's code: a host that
// passes no inspector ships none of it.
//
// Types only cross from the region's module; this file imports no runtime
// code from it.

import { createContext, useContext } from "react";
import type { LaunchInspectorScope } from "./LaunchInspectorRegion.js";
import type { SessionInspectorScope } from "./SessionInspectorRegion.js";

/** @internal What a viewer hands its inspector: a conversation's, or a launcher's before one exists. */
export type InspectorScope =
  | { readonly kind: "session"; readonly scope: SessionInspectorScope }
  | { readonly kind: "launch"; readonly scope: LaunchInspectorScope };

/** @internal Provided by SessionViewer and NewSessionViewer around the inspector element. */
export const SessionInspectorContext = createContext<InspectorScope | null>(null);

/** @internal The viewer's scope, or null outside a viewer. */
export function useSessionInspectorScope(): InspectorScope | null {
  return useContext(SessionInspectorContext);
}
