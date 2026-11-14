"use client";

import { cn } from "@stigmer/design-tokens";
import { StatusBadge } from "../status/StatusBadge.js";
import { Tabs } from "../tabs/Tabs.js";
import { ResourceActionBar } from "./ResourceActionBar.js";
import type { ResourceDetailShellProps } from "./types.js";
import { useOrgSlugForId } from "../organization/useOrgRefs.js";

/**
 * Shared layout shell for resource detail pages.
 *
 * Renders a standardized header (icon, name, org, timestamps, status,
 * visibility control) or the kind's own `identity`, an action bar (primary
 * button + kebab overflow, each act offered only on the server's yes for
 * the `requires` it declares on `resource`), optional tabs, and a content
 * area — all themed via `--stgm-*` tokens.
 *
 * The shell receives pre-fetched data via props. It does
 * NOT own data fetching — resource-specific hooks (`useAgent`, `useSkill`,
 * etc.) handle that. The shell is a layout + behavior coordinator, not
 * a data-fetching component.
 *
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * function AgentPage({ slug, onEdit }: { slug: string; onEdit: () => void }) {
 *   const { agent } = useAgent("acme", slug);
 *   if (!agent?.metadata) return <p>Loading…</p>;
 *   const { name, id, org } = agent.metadata;
 *   return (
 *     <ResourceDetailShell
 *       header={{ name, id, org, slug: agent.metadata.slug, description: agent.spec?.description }}
 *       primaryAction={{ id: "edit", label: "Edit", onAction: onEdit }}
 *     >
 *       <p>{agent.spec?.description}</p>
 *     </ResourceDetailShell>
 *   );
 * }
 * ```
 */
export function ResourceDetailShell({
  header,
  visibilityControl,
  headerMetaExtra,
  headerBanner,
  identity,
  primaryAction,
  actions,
  resource,
  tabs,
  activeTab,
  onTabChange,
  tabsAriaLabel,
  children,
  className,
}: ResourceDetailShellProps) {
  const hasTabs = tabs != null && tabs.length > 0;

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-6", className)}>
      {headerBanner}

      {/* Header + Action bar row */}
      {/* Side by side from the small breakpoint; on a phone the acts sit under the identity, never over the name. */}
      <div className="stg:flex stg:flex-col stg:gap-4 stg:sm:flex-row stg:sm:items-start stg:sm:justify-between">
        {identity ?? (
          <Header
            header={header}
            visibilityControl={visibilityControl}
            metaExtra={headerMetaExtra}
          />
        )}
        <ResourceActionBar
          primaryAction={primaryAction}
          actions={actions}
          resource={resource}
          className="stg:shrink-0"
        />
      </div>

      {/* Tabs + content or plain content */}
      {hasTabs && activeTab && onTabChange ? (
        <Tabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={onTabChange}
          aria-label={tabsAriaLabel}
        >
          {children}
        </Tabs>
      ) : (
        children
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({
  header,
  visibilityControl,
  metaExtra,
}: {
  readonly header: ResourceDetailShellProps["header"];
  readonly visibilityControl?: ResourceDetailShellProps["visibilityControl"];
  readonly metaExtra?: ResourceDetailShellProps["headerMetaExtra"];
}) {
  const {
    name,
    nameElement,
    org,
    slug,
    qualifiedSlug,
    description,
    iconUrl,
    icon,
    createdAt,
    updatedAt,
    status,
    statusLabel,
  } = header;

  const showSlug = slug && slug !== name && !qualifiedSlug;
  const slugForOrg = useOrgSlugForId();

  return (
    <div className="stg:flex stg:min-w-0 stg:items-start stg:gap-3">
      {iconUrl ? (
        <img
          src={iconUrl}
          alt=""
          className="stg:mt-0.5 stg:size-8 stg:shrink-0 stg:rounded stg:object-cover"
        />
      ) : icon ? (
        <span className="stg:mt-1 stg:shrink-0">{icon}</span>
      ) : null}
      <div className="stg:min-w-0 stg:flex-1">
        <div className="stg:flex stg:items-center stg:gap-2">
          {nameElement ?? (
            <h2 className="stg:truncate stg:text-xl stg:font-semibold stg:text-foreground">
              {name}
            </h2>
          )}
          {showSlug && (
            <code className="stg:shrink-0 stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:text-xs stg:font-medium stg:text-muted-foreground">
              {slug}
            </code>
          )}
          {status && (
            <StatusBadge
              phase={status}
              label={statusLabel}
            />
          )}
          {visibilityControl}
        </div>
        {qualifiedSlug && (
          <span className="stg:mt-0.5 stg:block stg:truncate stg:font-mono stg:text-xs stg:text-muted-foreground">
            {qualifiedSlug}
          </span>
        )}
        <div className="stg:mt-0.5 stg:flex stg:flex-wrap stg:items-center stg:gap-x-1.5 stg:text-xs stg:text-muted-foreground">
          {org && <span>{slugForOrg(org)}</span>}
          {metaExtra}
          {createdAt && (
            <>
              <Dot />
              <span>Created {formatDate(createdAt)}</span>
            </>
          )}
          {updatedAt && (
            <>
              <Dot />
              <span>Updated {formatDate(updatedAt)}</span>
            </>
          )}
        </div>
        {description && (
          <p className="stg:mt-2 stg:text-sm stg:text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function Dot() {
  return (
    <span className="stg:shrink-0" aria-hidden="true">
      {"\u00B7"}
    </span>
  );
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
