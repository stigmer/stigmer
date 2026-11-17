"use client";

// The settings landing: every group of the settings navigation as a list of
// rows, each page's name in the case its own title spells it and one line on
// what it is for, inside the same frame every settings page opens with. The
// web console and the desktop app both draw it, so the landing cannot drift
// between them; each host passes only its router's link through
// `renderLink`, the seam `SettingsSidebar` already takes.
//
// It draws what `groups` says, defaulting to `useSettingsNavGroups()`, so a
// page the person may not open (an operator's console, an admin's page) is
// never offered here either.

import type { ReactElement } from "react";
import { ChevronRight } from "lucide-react";
import { List, ListRow } from "../internal/surface/List.js";
import type { RenderLink } from "../button/LinkButton.js";
import { useOrgDisplayName } from "../organization/useOrgDisplayName.js";
import type { RenderSidebarLink } from "../sidebar/types.js";
import type { SettingsNavGroup, SettingsNavItem } from "./settings-nav.js";
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

/**
 * The settings landing: each settings group as a list of its pages, each
 * with the line that says what it is for, the row a link to the page.
 *
 * @example
 * ```tsx
 * // renderLink is where the host's router link goes; a plain anchor works too.
 * <SettingsOverview renderLink={({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a>} />
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

/** A page's line, with `{org}` read as the organization's name for a sentence. */
function settingsNavDescription(item: SettingsNavItem, orgName: string): string | undefined {
  return item.description?.replaceAll("{org}", orgName);
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
  // A server that holds one organization never names it.
  const orgName = useOrgDisplayName();
  return (
    <SettingsPage
      title="Settings"
      description="Your organization, how it is set up, what it costs, and your own account."
      className={className}
    >
      <div className="stg:flex stg:flex-col stg:gap-6">
        {groups.map((group) => (
          <section key={group.label} className="stg:flex stg:flex-col stg:gap-2">
            <h3 className="stg:m-0 stg:text-sm stg:font-semibold stg:text-foreground">{group.label}</h3>
            <List aria-label={group.label}>
              {group.items.map((item) => {
                // The row's name is the link; the sidebar's link seam draws it,
                // with the route basename as its stable id.
                const link: RenderLink = ({ href, className: linkClass, children }) =>
                  renderLink({
                    id: item.href.slice(item.href.lastIndexOf("/") + 1),
                    href,
                    active: false,
                    className: linkClass,
                    "aria-current": undefined,
                    children,
                  });
                return (
                  <ListRow
                    key={item.href}
                    href={item.href}
                    renderLink={link}
                    leading={<item.icon className="stg:size-4 stg:shrink-0 stg:text-muted-foreground" aria-hidden="true" />}
                    name={item.label}
                    description={settingsNavDescription(item, orgName)}
                    trailing={<ChevronRight className="stg:size-4 stg:shrink-0 stg:text-muted-foreground" aria-hidden="true" />}
                  />
                );
              })}
            </List>
          </section>
        ))}
      </div>
    </SettingsPage>
  );
}
