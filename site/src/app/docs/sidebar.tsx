"use client";

import { PanelLeft, X } from "lucide-react";
import {
  Sidebar,
  SidebarCollapseTrigger,
  SidebarContent,
  SidebarContentMobile,
  SidebarFooter,
  SidebarHeader,
  SidebarPageTree,
  SidebarTrigger,
  SidebarViewport,
} from "fumadocs-ui/components/layout/sidebar";
import {
  RootToggle,
  type Option,
} from "fumadocs-ui/components/layout/root-toggle";
import { SearchToggle } from "fumadocs-ui/components/layout/search-toggle";
import { ThemeToggle } from "fumadocs-ui/components/layout/theme-toggle";
import { useSidebar } from "fumadocs-ui/contexts/sidebar";
import { cn } from "@/lib/utils";
import { DocsSidebarFolder } from "./sidebar-folder";
import { DocsSidebarItem } from "./sidebar-item";
import { DocsSidebarSeparator } from "./sidebar-separator";

const iconButtonClasses = cn(
  "inline-flex items-center justify-center rounded-lg p-2",
  "text-fd-muted-foreground transition-colors",
  "hover:bg-fd-accent hover:text-fd-accent-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring",
);

/**
 * The docs sidebar (DD-02) — menu-only, passed to `DocsLayout` as
 * `sidebar.component`.
 *
 * Why a full replacement instead of the stock sidebar with options: the
 * stock desktop `SidebarHeader` unconditionally renders a `nav.title` logo
 * link plus the search toggle. With the logo and search living in
 * `DocsHeader` (Cursor's structure), the stock header would duplicate the
 * logo — or render an empty, unlabeled link if `nav.title` were dropped.
 * Composing from the same public primitives the stock layout uses keeps the
 * behavior (collapse, hover-peek, mobile drawer) without the header block.
 *
 * Breakpoint split is the stock `Sidebar` contract: `Content` on md+ (fixed
 * rail positioned off `--fd-sidebar-top`, which already includes the
 * header's `--fd-nav-height`), `Mobile` below (slide-in drawer). The drawer
 * keeps the tab switcher (`RootToggle`) since header tabs are desktop-only.
 */
export function DocsSidebar({ tabs }: { tabs: Option[] }) {
  const pageTree = (
    <SidebarViewport>
      <SidebarPageTree
        components={{
          Folder: DocsSidebarFolder,
          Item: DocsSidebarItem,
          Separator: DocsSidebarSeparator,
        }}
      />
    </SidebarViewport>
  );

  // Collapse control and theme toggle sit in the footer on both
  // breakpoints — one place to look, and the menu above stays pure.
  const footer = (
    <SidebarFooter className="flex-row items-center">
      <SidebarCollapseTrigger
        className={cn(iconButtonClasses, "max-md:hidden")}
      >
        <PanelLeft className="size-4" />
      </SidebarCollapseTrigger>
      <ThemeToggle className="ms-auto" />
    </SidebarFooter>
  );

  return (
    <Sidebar
      Mobile={
        <SidebarContentMobile>
          <SidebarHeader>
            <div className="flex items-center justify-end text-fd-muted-foreground">
              <SidebarTrigger className={iconButtonClasses}>
                <X className="size-4.5" />
              </SidebarTrigger>
            </div>
            <RootToggle options={tabs} />
          </SidebarHeader>
          {pageTree}
          {footer}
        </SidebarContentMobile>
      }
      Content={
        <>
          <CollapsedControl />
          <SidebarContent>
            {pageTree}
            {footer}
          </SidebarContent>
        </>
      }
    />
  );
}

/**
 * Floating expand/search pill shown while the desktop sidebar is collapsed.
 *
 * A reimplementation of Fumadocs' `CollapsibleControl` for one reason: the
 * stock control's `top` offset omits `--fd-nav-height` (it assumes the
 * default layout, where no desktop header exists). Under `DocsHeader` the
 * stock pill would sit behind the fixed header, unreachable. Same markup,
 * same tokens, corrected offset.
 */
function CollapsedControl() {
  const { collapsed } = useSidebar();

  return (
    <div
      className={cn(
        "fixed z-10 flex rounded-xl border bg-fd-muted p-0.5 text-fd-muted-foreground shadow-lg",
        "transition-opacity max-md:hidden max-xl:end-4 xl:start-4",
        !collapsed && "pointer-events-none opacity-0",
      )}
      style={{
        top: "calc(var(--fd-banner-height) + var(--fd-nav-height) + var(--fd-tocnav-height) + var(--spacing) * 4)",
      }}
    >
      <SidebarCollapseTrigger className={iconButtonClasses}>
        <PanelLeft className="size-4" />
      </SidebarCollapseTrigger>
      <SearchToggle hideIfDisabled className={iconButtonClasses} />
    </div>
  );
}
