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
  /**
   * The calls the tree makes in the docs mode (`?embed=1`), where a reader
   * can talk to it: its conversation answered by the scripted server
   * (src/live-server.ts). Omitted, the docs mode answers `routes`.
   */
  readonly liveRoutes?: () => Routes;
  /** The provider's edition; the kit's default (`cloud`) when omitted. */
  readonly deploymentMode?: DeploymentMode;
  /** The theme preset; the default look when omitted. */
  readonly preset?: ThemePresetId;
  /** Draw inside `OrgProvider`, for components that read the active organization. */
  readonly inOrganization?: boolean;
  /**
   * The server's public address the provider names, for a screen that shows
   * one (a Slack app's events URL); the gallery's own client address when
   * omitted, which no reader's screen would show.
   */
  readonly publicBaseUrl?: string;
  /** End the kit's failure notes with the server's help link, as a console does; off when omitted. */
  readonly showHelpLink?: boolean;
}
