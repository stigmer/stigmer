"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, PanelLeft } from "lucide-react";
import { cn } from "@stigmer/theme";
import { Button } from "@/domain/_shared/ui/button";
import { Separator } from "@/domain/_shared/ui/separator";
import { useSessionNavigation } from "@/domain/session/session-navigation";
import { OrgSwitcher } from "./OrgSwitcher";
import { UserMenu } from "./UserMenu";
import { useSidebarOpen } from "./use-layout-state";
import { SETTINGS_NAV_GROUPS } from "./settings-nav";

export function ManagementSidebar() {
  const sidebar = useSidebarOpen();
  const pathname = usePathname();
  const { lastSessionZonePath } = useSessionNavigation();

  return (
    <nav
      id="sidebar"
      aria-label="Management navigation"
      className="bg-sidebar text-sidebar-foreground flex h-full flex-col"
    >
      {/* Top row: collapse toggle + org context */}
      <div className="flex flex-none items-center gap-1 px-2 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={sidebar.close}
          aria-expanded={sidebar.isOpen}
          aria-controls="sidebar"
          aria-label="Collapse sidebar"
          className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
        >
          <PanelLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <OrgSwitcher />
        </div>
      </div>

      {/* Back to Sessions */}
      <div className="flex-none px-3 py-1">
        <Link
          href={lastSessionZonePath ?? "/"}
          className="text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors"
        >
          <ArrowLeft className="size-4 shrink-0" />
          Back to Sessions
        </Link>
      </div>

      <div className="px-3 py-1">
        <Separator className="bg-sidebar-border" />
      </div>

      {/* Management nav links — grouped */}
      <div className="flex flex-col gap-4 px-3 py-1">
        {SETTINGS_NAV_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <span className="text-sidebar-muted-foreground px-2 pb-1 text-[11px] font-medium uppercase tracking-wider">
              {group.label}
            </span>
            {group.items.map((item) => {
              const isActive =
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <item.icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom: user menu */}
      <div className="border-sidebar-border flex-none border-t px-3 py-2">
        <UserMenu />
      </div>
    </nav>
  );
}
