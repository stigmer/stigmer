"use client";

// The settings landing: every group of the settings navigation as a card,
// its pages as links, inside the same frame every settings page opens with.
// The web console and the desktop app both draw it, so the landing cannot
// drift between them; each host passes only its router's link through
// `renderLink`, the seam `SettingsSidebar` already takes.
//
// It draws what `groups` says, defaulting to `useSettingsNavGroups()`, so a
// page the person may not open (an operator's console, an admin's page) is
// never offered here either.

import type { ReactElement } from "react";
import { cn } from "@stigmer/design-tokens";
import type { RenderSidebarLink } from "../sidebar/types.js";
import type { SettingsNavGroup } from "./settings-nav.js";
import { SettingsPage } from "./SettingsPage.js";
import { useSettingsNavGroups } from "./useSettingsNavGroups.js";

/** Props for {@link SettingsOverview}. */
export interface SettingsOverviewProps {
  /** Renders each page's link as the host's router link (see {@link RenderSidebarLink}). */
  readonly renderLink: RenderSidebarLink;
  /**
   * The groups to draw. Defaults to `useSettingsNavGroups()`, the
   * permission-aware navigation the settings sidebar draws; deterministic
   * hosts pass `SETTINGS_NAV_GROUPS` or a fixture.
   */
  readonly groups?: readonly SettingsNavGroup[];
  readonly className?: string;
}

const LINK_CLASS = cn(
  "stg:flex stg:items-center stg:gap-2 stg:rounded-md stg:px-2 stg:py-1.5 stg:text-sm stg:font-medium stg:text-foreground stg:no-underline",
  "stg:transition-colors stg:hover:bg-accent-hover",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
);

/**
 * The settings landing: each settings group, what it holds, and a link to
 * each of its pages.
 *
 * @example
 * ```tsx
 * <SettingsOverview renderLink={({ href, children, ...rest }) => <Link href={href} {...rest}>{children}</Link>} />
 * ```
 */
export function SettingsOverview({ renderLink, groups, className }: SettingsOverviewProps) {
  return groups === undefined ? (
    <PermissionAwareOverview renderLink={renderLink} className={className} />
  ) : (
    <OverviewBody groups={groups} renderLink={renderLink} className={className} />
  );
}

/** The overview over the navigation the person may see. */
function PermissionAwareOverview({ renderLink, className }: { readonly renderLink: RenderSidebarLink; readonly className?: string }) {
  const groups = useSettingsNavGroups();
  return <OverviewBody groups={groups} renderLink={renderLink} className={className} />;
}

function OverviewBody({
  groups,
  renderLink,
  className,
}: {
  readonly groups: readonly SettingsNavGroup[];
  readonly renderLink: RenderSidebarLink;
  readonly className?: string;
}): ReactElement {
  return (
    <SettingsPage
      title="Settings"
      description="Your organization, how it is set up, what it costs, and your own account."
      className={className}
    >
      <div className="stg:grid stg:gap-4 stg:md:grid-cols-2">
        {groups.map((group) => (
          <div
            key={group.label}
            className="stg:flex stg:flex-col stg:gap-3 stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-4"
          >
            <div className="stg:flex stg:flex-col stg:gap-1 stg:px-2">
              <h3 className="stg:m-0 stg:text-sm stg:font-semibold stg:text-foreground">{group.label}</h3>
              <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">{group.description}</p>
            </div>
            <ul className="stg:m-0 stg:grid stg:list-none stg:grid-cols-1 stg:gap-0.5 stg:p-0 stg:sm:grid-cols-2">
              {group.items.map((item) => (
                <li key={item.href}>
                  {renderLink({
                    // Route basename as the stable id, as the sidebar names its rows.
                    id: item.href.slice(item.href.lastIndexOf("/") + 1),
                    href: item.href,
                    active: false,
                    className: LINK_CLASS,
                    "aria-current": undefined,
                    children: (
                      <>
                        <item.icon className="stg:size-4 stg:shrink-0 stg:text-muted-foreground" aria-hidden="true" />
                        {item.label}
                      </>
                    ),
                  })}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </SettingsPage>
  );
}
