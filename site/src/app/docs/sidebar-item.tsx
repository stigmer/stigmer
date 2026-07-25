"use client";

import type * as PageTree from "fumadocs-core/page-tree";
import { SidebarItem } from "fumadocs-ui/components/layout/sidebar";

/**
 * Sidebar page-link renderer (DD-02 density). Replicates Fumadocs' default
 * rendering with a tighter row: `py-1.5` (6px) over the default `p-2` (8px)
 * — matching Cursor's menu rhythm. Font size stays inherited (the sidebar
 * base already matches Cursor); only the vertical padding changes. The same
 * treatment is applied to folder rows in sidebar-folder.tsx.
 */
export function DocsSidebarItem({ item }: { item: PageTree.Item }) {
  return (
    <SidebarItem
      href={item.url}
      external={item.external}
      icon={item.icon}
      className="py-1.5"
    >
      {item.name}
    </SidebarItem>
  );
}
