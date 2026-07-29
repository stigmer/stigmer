import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { getSidebarTabs } from "fumadocs-ui/utils/get-sidebar-tabs";
import { AskAiPanel, AskAiProvider } from "@/components/docs/ask-ai";
import { DocsHeader } from "@/components/docs/header";
import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";
import { DocsSidebar } from "./sidebar";

export default function Layout({ children }: { children: ReactNode }) {
  // SDK and CLI are root folders (`"root": true` in their meta.json), which
  // Fumadocs turns into layout tabs — title, description, and icon all come
  // from the meta.json, keeping one source of truth per tab. The Docs tab must
  // be added by hand: tabs are only derived from root folders, and turning the
  // whole docs tree into a root folder would nest every URL one level deeper.
  //
  // Order matters: the active tab is the LAST entry matching the current URL
  // (see selectActiveTab), so the catch-all Docs tab (`/docs` prefix) must
  // stay first to lose against the more specific SDK/CLI tabs on their own
  // subtrees.
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
    // The site is dark-only: the root layout hardcodes `<html class="dark">`
    // and `theme.enabled: false` keeps RootProvider from mounting next-themes
    // (which would otherwise follow the OS preference and toggle that class).
    // Dark is a build-time fact here, exactly as on the marketing pages.
    <RootProvider
      search={{ options: { type: "static" } }}
      theme={{ enabled: false }}
    >
      {/* One provider, one panel, two CSS-gated triggers — both rendered
          by DocsHeader. */}
      <AskAiProvider>
        {/* Chrome ownership (DD-02): DocsHeader replaces the stock navbar on
            BOTH breakpoints and renders the tabs on desktop; DocsSidebar is
            menu-only and renders the tab switcher in the mobile drawer.
            `tabs: false` keeps the stock LayoutTabs strip and RootToggle
            from co-rendering with ours — exactly one owner per breakpoint,
            both fed from the single `tabs` array above. */}
        <DocsLayout
          tree={source.pageTree}
          nav={{ component: <DocsHeader tabs={tabs} /> }}
          sidebar={{ tabs: false, component: <DocsSidebar tabs={tabs} /> }}
        >
          {children}
        </DocsLayout>
        <AskAiPanel />
      </AskAiProvider>
    </RootProvider>
  );
}
