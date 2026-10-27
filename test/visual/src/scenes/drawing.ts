// What a scene draws: its component tree, the calls that tree makes
// answered, and how the kit's provider is set for it. The page
// (src/main.tsx) wraps every drawing in `StigmerProvider` with the scene's
// colour mode; a drawing names only what differs.
import type { ReactElement } from "react";
import type { DeploymentMode } from "@stigmer/client";
import type { ThemePresetId } from "@stigmer/design-tokens";
import type { Routes } from "../fake-server.ts";

export interface Drawing {
  /** The component tree, drawn inside the kit's provider. */
  readonly render: () => ReactElement;
  /** The calls the tree makes, answered; every other call answers `Unimplemented`. */
  readonly routes?: Routes;
  /** The provider's edition; the kit's default (`cloud`) when omitted. */
  readonly deploymentMode?: DeploymentMode;
  /** The theme preset; the default look when omitted. */
  readonly preset?: ThemePresetId;
  /** Draw inside `OrgProvider`, for components that read the active organization. */
  readonly inOrganization?: boolean;
}
