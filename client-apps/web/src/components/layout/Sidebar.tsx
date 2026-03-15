"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@stigmer/theme";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  navigation,
  isNavGroup,
  type NavItem,
  type NavGroup,
} from "@/config/navigation";
import { OrgSwitcher } from "./OrgSwitcher";

const SIDEBAR_WIDTH = 240;

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(item.href + "/");
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function NavGroupSection({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  const hasActiveChild = group.items.some(
    (item) =>
      pathname === item.href || pathname.startsWith(item.href + "/")
  );
  const [open, setOpen] = useState(hasActiveChild);
  const Icon = group.icon;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          hasActiveChild
            ? "text-foreground font-medium"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">{group.label}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
          {group.items.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </div>
      )}
    </div>
  );
}

export { SIDEBAR_WIDTH };

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      style={{ width: SIDEBAR_WIDTH }}
      className="fixed inset-y-0 left-0 z-30 flex flex-col border-r border-sidebar-border bg-sidebar"
    >
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
          S
        </div>
        <span className="text-sm font-semibold tracking-tight">
          Stigmer Console
        </span>
      </div>

      <div className="border-b border-sidebar-border">
        <OrgSwitcher />
      </div>

      <ScrollArea className="flex-1 px-3 py-3">
        <nav className="flex flex-col gap-1">
          {navigation.map((entry) =>
            isNavGroup(entry) ? (
              <NavGroupSection
                key={entry.label}
                group={entry}
                pathname={pathname}
              />
            ) : (
              <NavLink key={entry.href} item={entry} pathname={pathname} />
            )
          )}
        </nav>
      </ScrollArea>
    </aside>
  );
}
