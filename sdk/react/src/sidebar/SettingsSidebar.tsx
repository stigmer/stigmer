"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { SettingsNavGroup } from "../settings/settings-nav.js";
import { SidebarChrome, SidebarSeparator, navRowClassName } from "./chrome.js";
import type { RenderSidebarLink } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link SettingsSidebar}. */
export interface SettingsSidebarProps {
  /**
   * Grouped settings navigation to render. The console passes
   * `useSettingsNavGroups()` (permission-aware); deterministic hosts
   * pass `SETTINGS_NAV_GROUPS` or a fixture subset.
   */
  readonly groups: readonly SettingsNavGroup[];
  /**
   * Current pathname for active-row matching: a row is active when the
   * path equals its `href` or sits under `href + "/"`. Omit for hosts
   * with no location (deterministic embeds pass the depicted route).
   */
  readonly activePath?: string | null;
  /** Renders each interactive row. See {@link RenderSidebarLink}. */
  readonly renderLink: RenderSidebarLink;
  /**
   * "Back to Sessions" target — the last workspace-zone location, so
   * leaving settings restores where the user was. @default "/"
   */
  readonly backHref?: string;
  /** Footer content — typically the host app's `UserMenu` wrapper. */
  readonly footer: ReactNode;
  /** Reflected as `aria-expanded` on the collapse toggle. @default true */
  readonly isOpen?: boolean;
  /** Called when the collapse toggle is pressed. */
  readonly onCollapse?: () => void;
  /** Passed through to the embedded `OrgSwitcher`. */
  readonly onOrgChanged?: (org: Organization) => void;
}

/**
 * The console's settings-zone (management) sidebar: org switcher, a
 * "Back to Sessions" exit, and grouped settings navigation driven by
 * the SDK's settings-nav model, with a user footer.
 *
 * Like {@link WorkspaceSidebar}, this is the exact component the web
 * console, desktop app, and documentation tours all render; hosts vary
 * only `renderLink`, `groups`, and the `footer` slot.
 *
 * Row identifiers passed to `renderLink` are the settings route
 * basenames (`"api-keys"`, `"members"`, …) plus `"back-to-sessions"`,
 * so consumers can address specific rows without parsing hrefs.
 *
 * @example
 * ```tsx
 * <SettingsSidebar
 *   groups={useSettingsNavGroups()}
 *   activePath={usePathname()}
 *   backHref={lastSessionZonePath ?? "/"}
 *   renderLink={({ href, children, ...rest }) => (
 *     <Link href={href} {...rest}>{children}</Link>
 *   )}
 *   footer={<UserMenu />}
 * />
 * ```
 */
export function SettingsSidebar({
  groups,
  activePath = null,
  renderLink,
  backHref = "/",
  footer,
  isOpen = true,
  onCollapse,
  onOrgChanged,
}: SettingsSidebarProps) {
  return (
    <SidebarChrome
      ariaLabel="Management navigation"
      isOpen={isOpen}
      onCollapse={onCollapse}
      onOrgChanged={onOrgChanged}
      footer={footer}
    >
      {/* Back to Sessions */}
      <div className="stg:flex-none stg:px-3 stg:py-1">
        {renderLink({
          id: "back-to-sessions",
          href: backHref,
          active: false,
          className: navRowClassName(false, { muted: true }),
          "aria-current": undefined,
          children: (
            <>
              <ArrowLeft className="stg:size-4 stg:shrink-0" />
              Back to Sessions
            </>
          ),
        })}
      </div>

      <SidebarSeparator />

      {/* Settings nav links — grouped, permission-aware via `groups` */}
      <div className="stg:flex stg:flex-col stg:gap-4 stg:px-3 stg:py-1">
        {groups.map((group) => (
          <div key={group.label} className="stg:flex stg:flex-col stg:gap-0.5">
            <span className="stg:text-sidebar-muted-foreground stg:px-2 stg:pb-1 stg:text-[11px] stg:font-medium stg:tracking-wider stg:uppercase">
              {group.label}
            </span>
            {group.items.map((item) => {
              const active =
                activePath != null &&
                (activePath === item.href ||
                  activePath.startsWith(`${item.href}/`));

              return (
                <SettingsNavRow
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={<item.icon className="stg:size-4 stg:shrink-0" />}
                  active={active}
                  renderLink={renderLink}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Spacer pushes the footer to the bottom (no scrollable middle). */}
      <div className="stg:flex-1" />
    </SidebarChrome>
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function SettingsNavRow({
  href,
  label,
  icon,
  active,
  renderLink,
}: {
  readonly href: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly active: boolean;
  readonly renderLink: RenderSidebarLink;
}) {
  return renderLink({
    // Route basename as the stable id: "/settings/api-keys" → "api-keys".
    id: href.slice(href.lastIndexOf("/") + 1),
    href,
    active,
    className: navRowClassName(active),
    "aria-current": active ? "page" : undefined,
    children: (
      <>
        {icon}
        {label}
      </>
    ),
  });
}
