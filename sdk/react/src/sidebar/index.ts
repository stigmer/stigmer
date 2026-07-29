// Sidebar — the console's navigation chrome as shared SDK components.
//
// One source of truth for the sidebar the web console, desktop app, and
// documentation tours all render (stigmer/stigmer#317): hosts inject their
// router via `renderLink`, their data via props, and their user menu via
// the `footer` slot.

export { WorkspaceSidebar } from "./WorkspaceSidebar.js";
export type {
  WorkspaceSidebarProps,
  WorkspaceSidebarActivity,
  WorkspaceNavId,
} from "./WorkspaceSidebar.js";
export { SettingsSidebar } from "./SettingsSidebar.js";
export type { SettingsSidebarProps } from "./SettingsSidebar.js";
export type { SidebarLinkRenderProps, RenderSidebarLink } from "./types.js";
