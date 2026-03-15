"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@stigmer/theme";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  navigation,
  isNavSection,
  type NavItem,
  type NavSection,
} from "@/config/navigation";
import { HEADER_HEIGHT } from "./AppHeader";

export const SIDEBAR_WIDTH = 240;
export const SIDEBAR_COLLAPSED_WIDTH = 60;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLink({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center rounded-lg transition-colors",
        collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="truncate text-sm">{item.label}</span>}
    </Link>
  );
}

function SidebarSection({
  section,
  pathname,
  collapsed,
}: {
  section: NavSection;
  pathname: string;
  collapsed: boolean;
}) {
  return (
    <div className="pt-4 first:pt-0">
      {!collapsed && (
        <p className="text-muted-foreground/70 mb-1 px-3 text-[11px] font-semibold tracking-wider uppercase">
          {section.label}
        </p>
      )}
      <div className="flex flex-col gap-0.5">
        {section.items.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            pathname={pathname}
            collapsed={collapsed}
          />
        ))}
      </div>
    </div>
  );
}

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ isCollapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const width = isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  return (
    <aside
      style={{ width, top: HEADER_HEIGHT }}
      className="border-sidebar-border bg-sidebar fixed bottom-0 left-0 z-30 flex flex-col border-r transition-[width] duration-200 ease-in-out"
    >
      <ScrollArea className="flex-1 px-2 py-3">
        <nav className="flex flex-col gap-1">
          {navigation.map((entry) =>
            isNavSection(entry) ? (
              <SidebarSection
                key={entry.label}
                section={entry}
                pathname={pathname}
                collapsed={isCollapsed}
              />
            ) : (
              <NavLink
                key={entry.href}
                item={entry}
                pathname={pathname}
                collapsed={isCollapsed}
              />
            ),
          )}
        </nav>
      </ScrollArea>

      <div className="border-sidebar-border flex border-t px-2 py-2">
        <button
          onClick={onToggle}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "text-muted-foreground hover:bg-accent hover:text-foreground flex items-center rounded-lg p-2 transition-colors",
            isCollapsed ? "mx-auto" : "",
          )}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </button>
      </div>
    </aside>
  );
}
