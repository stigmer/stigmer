"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { usePathname } from "fumadocs-core/framework";
import type { Option } from "fumadocs-ui/components/layout/root-toggle";
import {
  LargeSearchToggle,
  SearchToggle,
} from "fumadocs-ui/components/layout/search-toggle";
import { SidebarTrigger } from "fumadocs-ui/components/layout/sidebar";
import { Navbar } from "fumadocs-ui/layouts/docs-client";
import { cn } from "@/lib/utils";
import { StigmerIcon } from "@/components/ui/stigmer-icon";
import { AskAiTrigger } from "@/components/docs/ask-ai";
import { selectActiveTab } from "./active-tab";

const SIGN_IN_URL = "https://app.stigmer.ai";

const iconButtonClasses = cn(
  "inline-flex items-center justify-center rounded-md p-2",
  "text-fd-muted-foreground transition-colors",
  "hover:bg-fd-accent hover:text-fd-accent-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring",
);

/**
 * The docs header (DD-02) — Cursor-style chrome spanning both breakpoints,
 * passed to `DocsLayout` as `nav.component` (which replaces the stock
 * mobile-only navbar entirely).
 *
 * Desktop (md+): logo → section tabs → search → Ask AI → Sign in.
 * Mobile: logo → Ask AI → search icon → drawer trigger. One component, one
 * DOM tree; breakpoint classes gate the clusters — the same pattern the
 * stock navbar and the Ask AI triggers already use.
 *
 * Height contract: the `on-root:[--fd-nav-height:56px]` class publishes the
 * header height to `:root` (Fumadocs' `:root:has(&)` variant — the exact
 * mechanism the stock navbar uses). Sidebar top, TOC offsets, and content
 * padding all derive from that variable, so no other layout code needs to
 * know this header exists.
 *
 * The header runs full-bleed, matching the shell: the docs layout uses the
 * whole viewport width like Cursor's (see the DOCS DENSITY block in
 * globals.css), so the logo sits above the left-edge sidebar and the
 * Sign in button hugs the right edge.
 */
export function DocsHeader({ tabs }: { tabs: Option[] }) {
  const pathname = usePathname();
  const active = selectActiveTab(tabs, pathname);

  return (
    <Navbar className="on-root:[--fd-nav-height:56px] h-(--fd-nav-height)">
      <div className="flex size-full items-center gap-4 md:gap-6">
        <Link
          href="/docs"
          aria-label="Stigmer documentation home"
          className={cn(
            "inline-flex items-center transition-opacity hover:opacity-80",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring",
          )}
        >
          <StigmerIcon size={28} />
        </Link>

        <nav
          aria-label="Documentation sections"
          className="flex h-full items-stretch gap-5 max-md:hidden"
        >
          {tabs.map((tab) => (
            <Link
              key={tab.url}
              href={tab.url}
              className={cn(
                "inline-flex items-center border-b-2 border-transparent",
                "text-sm font-medium text-fd-muted-foreground transition-colors",
                "hover:text-fd-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring",
                tab === active && "border-fd-primary text-fd-primary",
              )}
              aria-current={tab === active ? "page" : undefined}
            >
              {tab.title}
            </Link>
          ))}
        </nav>

        <div className="flex flex-1 items-center justify-end gap-2">
          <LargeSearchToggle
            hideIfDisabled
            className="w-full max-w-60 max-md:hidden"
          />
          <AskAiTrigger variant="header" className="max-md:hidden" />
          <a
            href={SIGN_IN_URL}
            className={cn(
              "inline-flex items-center whitespace-nowrap rounded-lg border px-3 py-1.5",
              "text-sm font-medium text-fd-foreground transition-colors",
              "hover:bg-fd-accent hover:text-fd-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring",
              "max-md:hidden",
            )}
          >
            Sign in
          </a>

          <AskAiTrigger variant="nav" className="md:hidden" />
          <SearchToggle
            hideIfDisabled
            className={cn(iconButtonClasses, "md:hidden")}
          />
          <SidebarTrigger className={cn(iconButtonClasses, "md:hidden")}>
            <Menu className="size-4.5" />
          </SidebarTrigger>
        </div>
      </div>
    </Navbar>
  );
}
