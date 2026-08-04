"use client";

import { useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SettingsSidebar, useSettingsNavGroups } from "@stigmer/react";
import type { SidebarLinkRenderProps } from "@stigmer/react";
import { useSessionNavigation } from "@/domain/session/session-navigation";
import { UserMenu } from "./UserMenu";
import { useSidebarOpen } from "./use-layout-state";

/**
 * Settings-zone sidebar — a thin wrapper over the SDK's
 * {@link SettingsSidebar} (DD-002): this file only bridges Next.js
 * routing, the permission-aware nav groups, and the app's user menu
 * into the shared chrome.
 */
export function ManagementSidebar() {
  const sidebar = useSidebarOpen();
  const pathname = usePathname();
  const router = useRouter();
  const { lastSessionZonePath } = useSessionNavigation();
  const navGroups = useSettingsNavGroups();

  const renderLink = useCallback(
    ({
      href,
      className,
      children,
      "aria-current": ariaCurrent,
    }: SidebarLinkRenderProps) => (
      <Link href={href} aria-current={ariaCurrent} className={className}>
        {children}
      </Link>
    ),
    [],
  );

  // Org switch leaves the settings zone: settings pages render the previous
  // org's data (members, API keys, billing). Dashboard is the org-neutral
  // landing; the SDK's OrgProvider clears the fetch cache. Mirrors the
  // workspace sidebar and desktop (DD-016).
  const handleOrgChanged = useCallback(() => {
    router.push("/dashboard");
  }, [router]);

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
