import { useCallback } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { SettingsSidebar, useSettingsNavGroups } from "@stigmer/react";
import type { SidebarLinkRenderProps } from "@stigmer/react";
import { UserMenu } from "./UserMenu";
import { useSidebarOpen } from "./use-layout-state";

/**
 * Settings-zone sidebar — a thin wrapper over the SDK's
 * {@link SettingsSidebar} (DD-002): this file only bridges React Router
 * and the app's user menu into the shared chrome.
 */
export function ManagementSidebar({
  lastSessionZonePath,
}: {
  readonly lastSessionZonePath?: string | null;
}) {
  const sidebar = useSidebarOpen();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navGroups = useSettingsNavGroups();

  const renderLink = useCallback(
    ({
      href,
      className,
      children,
      "aria-current": ariaCurrent,
    }: SidebarLinkRenderProps) => (
      <NavLink to={href} aria-current={ariaCurrent} className={className}>
        {children}
      </NavLink>
    ),
    [],
  );

  const handleOrgChanged = useCallback(() => navigate("/"), [navigate]);

  return (
    <SettingsSidebar
      groups={navGroups}
      activePath={pathname}
      backHref={lastSessionZonePath ?? "/"}
      renderLink={renderLink}
      footer={<UserMenu />}
      isOpen={sidebar.isOpen}
      onCollapse={sidebar.close}
      onOrgChanged={handleOrgChanged}
    />
  );
}
