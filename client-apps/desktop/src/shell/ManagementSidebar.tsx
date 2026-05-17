import { useCallback } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, PanelLeft } from "lucide-react";
import { cn } from "@stigmer/theme";
import { OrgSwitcher, SETTINGS_NAV_GROUPS } from "@stigmer/react";
import { UserMenu } from "./UserMenu";
import { useSidebarOpen } from "./use-layout-state";

export function ManagementSidebar({
  lastSessionZonePath,
}: {
  readonly lastSessionZonePath?: string | null;
}) {
  const sidebar = useSidebarOpen();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const handleOrgChanged = useCallback(() => {
    navigate("/");
  }, [navigate]);

  return (
    <nav
      id="sidebar"
      aria-label="Management navigation"
      className="flex h-full flex-col bg-sidebar text-sidebar-foreground"
    >
      {/* Top row: collapse toggle + org context */}
      <div className="flex flex-none items-center gap-1 px-2 py-2">
        <button
          onClick={sidebar.close}
          aria-expanded={sidebar.isOpen}
          aria-controls="sidebar"
          aria-label="Collapse sidebar"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <PanelLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <OrgSwitcher onOrgChanged={handleOrgChanged} />
        </div>
      </div>

      {/* Back to Sessions */}
      <div className="flex-none px-3 py-1">
        <NavLink
          to={lastSessionZonePath ?? "/"}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <ArrowLeft className="size-4 shrink-0" />
          Back to Sessions
        </NavLink>
      </div>

      <div className="px-3 py-1">
        <div className="h-px bg-sidebar-border" />
      </div>

      {/* Management nav links — grouped */}
      <div className="flex flex-col gap-4 px-3 py-1">
        {SETTINGS_NAV_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <span className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-sidebar-muted-foreground">
              {group.label}
            </span>
            {group.items.map((item) => {
              const isActive =
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`);

              return (
                <NavLink
                  key={item.href}
                  to={item.href}
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
                </NavLink>
              );
            })}
          </div>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom: user menu */}
      <div className="flex-none border-t border-sidebar-border px-3 py-2">
        <UserMenu />
      </div>
    </nav>
  );
}
