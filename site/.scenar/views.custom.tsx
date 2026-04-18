// Custom views — add components that the scanner couldn't discover,
// or composite views you've built specifically for demos.
//
// This file is yours. `scenar preview sync` will never overwrite it.

import { AppShell } from "../src/components/docs/demos/views/AppShell";
import { ManagementShell } from "../src/components/docs/demos/views/ManagementShell";
import { ComposerView } from "../src/components/docs/demos/views/ComposerView";
import { ResourceListPage } from "../src/components/docs/demos/views/ResourceListPage";
import { WidgetsSidebar, renderWidgetsSidebar } from "../src/components/docs/demos/views/WidgetsSidebar";
import { APIExchangeView } from "../src/components/docs/demos/views/APIExchangeView";

export const customViews = {
  AppShell,
  ManagementShell,
  ComposerView,
  ResourceListPage,
  WidgetsSidebar,
  APIExchangeView,
} as const;

export { renderWidgetsSidebar };
