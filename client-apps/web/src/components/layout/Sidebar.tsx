"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@stigmer/theme";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  navigation,
  isNavSection,
  type NavItem,
  type NavSection,
} from "@/config/navigation";
import { OrgSwitcher } from "./OrgSwitcher";
import { ThemeToggle } from "./ThemeToggle";

const SIDEBAR_WIDTH = 240;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function SidebarSection({
  section,
  pathname,
}: {
  section: NavSection;
  pathname: string;
}) {
  return (
    <div className="pt-4 first:pt-0">
      <p className="text-muted-foreground/70 mb-1 px-3 text-[11px] font-semibold tracking-wider uppercase">
        {section.label}
      </p>
      <div className="flex flex-col gap-0.5">
        {section.items.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </div>
    </div>
  );
}

export { SIDEBAR_WIDTH };

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      style={{ width: SIDEBAR_WIDTH }}
      className="border-sidebar-border bg-sidebar fixed inset-y-0 left-0 z-30 flex flex-col border-r"
    >
      <div className="border-sidebar-border flex h-14 items-center gap-2 border-b px-4">
        <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-xs font-bold">
          S
        </div>
        <span className="text-sm font-semibold tracking-tight">Stigmer</span>
      </div>

      <div className="border-sidebar-border border-b">
        <OrgSwitcher />
      </div>

      <ScrollArea className="flex-1 px-3 py-3">
        <nav className="flex flex-col gap-1">
          {navigation.map((entry) =>
            isNavSection(entry) ? (
              <SidebarSection
                key={entry.label}
                section={entry}
                pathname={pathname}
              />
            ) : (
              <NavLink key={entry.href} item={entry} pathname={pathname} />
            ),
          )}
        </nav>
      </ScrollArea>

      <div className="border-sidebar-border border-t px-3 py-3">
        <ThemeToggle />
      </div>
    </aside>
  );
}
