"use client";

import { cn } from "@stigmer/theme";
import { StatusBadge } from "../resource-workbench/components/StatusBadge";
import { Tabs } from "../tabs/Tabs";
import { ResourceActionBar } from "./ResourceActionBar";
import type { ResourceDetailShellProps } from "./types";

/**
 * Shared layout shell for resource detail pages.
 *
 * Renders a standardized header (icon, name, org, timestamps, status,
 * visibility control), an action bar (primary button + kebab overflow),
 * optional tabs, and a content area — all themed via `--stgm-*` tokens.
 *
 * The shell receives pre-fetched data via props (DD-T03-001). It does
 * NOT own data fetching — resource-specific hooks (`useAgent`, `useSkill`,
 * etc.) handle that. The shell is a layout + behavior coordinator, not
 * a data-fetching component.
 *
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * const { agent } = useAgent(org, slug);
 *
 * <ResourceDetailShell
 *   header={{
 *     name: agent.metadata.name,
 *     id: agent.metadata.id,
 *     org: agent.metadata.org,
 *     slug: agent.metadata.slug,
 *     description: agent.spec.description,
 *   }}
 *   primaryAction={{ id: "edit", label: "Edit", onAction: handleEdit }}
 *   actions={[...]}
 * >
 *   <AgentOverview agent={agent} />
 * </ResourceDetailShell>
 * ```
 */
export function ResourceDetailShell({
  header,
  visibilityControl,
  headerMetaExtra,
  headerBanner,
  primaryAction,
  actions,
  tabs,
  activeTab,
  onTabChange,
  tabsAriaLabel,
  children,
  className,
}: ResourceDetailShellProps) {
  const hasTabs = tabs != null && tabs.length > 0;

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {headerBanner}

      {/* Header + Action bar row */}
      <div className="flex items-start justify-between gap-4">
        <Header
          header={header}
          visibilityControl={visibilityControl}
          metaExtra={headerMetaExtra}
        />
        <ResourceActionBar
          primaryAction={primaryAction}
          actions={actions}
          className="shrink-0"
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

  return (
    <div className="flex min-w-0 items-start gap-3">
      {iconUrl ? (
        <img
          src={iconUrl}
          alt=""
          className="mt-0.5 size-8 shrink-0 rounded object-cover"
        />
      ) : icon ? (
        <span className="mt-1 shrink-0">{icon}</span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {nameElement ?? (
            <h2 className="truncate text-lg font-semibold text-foreground">
              {name}
            </h2>
          )}
          {showSlug && (
            <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
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
          <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
            {qualifiedSlug}
          </span>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {org && <span>{org}</span>}
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
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
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
    <span className="shrink-0" aria-hidden="true">
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
