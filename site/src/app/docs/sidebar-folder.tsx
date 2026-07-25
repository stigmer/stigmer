"use client";

import type { ReactNode } from "react";
import type * as PageTree from "fumadocs-core/page-tree";
import {
  SidebarFolder,
  SidebarFolderContent,
  SidebarFolderLink,
  SidebarFolderTrigger,
} from "fumadocs-ui/components/layout/sidebar";
import { useTreePath } from "fumadocs-ui/contexts/tree";

/**
 * Sidebar folder renderer that hides root folders.
 *
 * Root folders (`"root": true` in meta.json — SDK and CLI) are already
 * presented as layout tabs above the content. When browsing pages outside any
 * root folder, Fumadocs would additionally render them as ordinary sidebar
 * folders, duplicating the tabs at the bottom of the Docs sidebar. Returning
 * null keeps the tabs as the only section switcher, matching the
 * cursor.com/docs reference.
 *
 * Non-root folders replicate Fumadocs' default rendering: a folder is open
 * when it opts in via `defaultOpen` or when it lies on the path to the active
 * page. The default renderer also opens folders whose level is within
 * `sidebar.defaultOpenLevel`; we don't configure that option (default 0 =
 * nothing auto-opens), so it is intentionally not replicated here.
 */
export function DocsSidebarFolder({
  item,
  children,
}: {
  item: PageTree.Folder;
  level: number;
  children: ReactNode;
}) {
  const path = useTreePath();
  if (item.root === true) return null;

  return (
    <SidebarFolder defaultOpen={(item.defaultOpen ?? false) || path.includes(item)}>
      {/* py-1.5 matches the DocsSidebarItem density override (DD-02) so
          folder rows and page rows share one rhythm. */}
      {item.index !== undefined ? (
        <SidebarFolderLink
          href={item.index.url}
          external={item.index.external}
          className="py-1.5"
        >
          {item.icon}
          {item.name}
        </SidebarFolderLink>
      ) : (
        <SidebarFolderTrigger className="py-1.5">
          {item.icon}
          {item.name}
        </SidebarFolderTrigger>
      )}
      <SidebarFolderContent>{children}</SidebarFolderContent>
    </SidebarFolder>
  );
}
