import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { getSidebarTabs } from "fumadocs-ui/utils/get-sidebar-tabs";
import { baseOptions } from "@/lib/layout.shared";
import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";
import { DocsSidebarFolder } from "./sidebar-folder";
import { DocsSidebarSeparator } from "./sidebar-separator";

export default function Layout({ children }: { children: ReactNode }) {
  // SDK and CLI are root folders (`"root": true` in their meta.json), which
  // Fumadocs turns into layout tabs — title, description, and icon all come
  // from the meta.json, keeping one source of truth per tab. The Docs tab must
  // be added by hand: tabs are only derived from root folders, and turning the
  // whole docs tree into a root folder would nest every URL one level deeper.
  //
  // Order matters: the active tab is the LAST entry matching the current URL,
  // so the catch-all Docs tab (`/docs` prefix) must stay first to lose against
  // the more specific SDK/CLI tabs on their own subtrees.
  const tabs = [
    {
      title: "Docs",
      description: "Learn and operate Stigmer",
      url: "/docs",
      icon: <BookOpen />,
    },
    ...getSidebarTabs(source.pageTree),
  ];

  return (
    <RootProvider search={{ options: { type: "static" } }}>
      <DocsLayout
        tree={source.pageTree}
        {...baseOptions()}
        // Render the tabs as a horizontal bar above the content (Cursor-style)
        // instead of the default dropdown inside the sidebar.
        tabMode="top"
        // Folder override hides root folders (already reachable through the
        // tabs, see sidebar-folder.tsx); Separator override renders group
        // labels as muted uppercase eyebrows (see sidebar-separator.tsx).
        sidebar={{
          tabs,
          components: {
            Folder: DocsSidebarFolder,
            Separator: DocsSidebarSeparator,
          },
        }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
