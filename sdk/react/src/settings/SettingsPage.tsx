"use client";

// Every settings page's frame: the landmark the page is, its heading (a
// `PageHeader` at h2, under the settings layout's "Settings"), and the two
// answers a page knows before it reads any data: this edition does not
// offer it (`unavailable`), or this person may not see it (`denied`). With
// either, the page's body is not mounted, so none of its reads start.
//
// The data's own states (loading, empty, failed) stay where the data is, in
// the panels a page renders, drawn by the shared parts: `SettingsSkeleton`,
// `EmptyState`, `ErrorMessage`.

import { useId, type ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { EmptyState } from "../empty-state/EmptyState.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { PageHeader } from "../page/PageHeader.js";

/** What a settings page says to a person who may not see it. */
export interface SettingsPageDenial {
  /** The notice's heading ("Only an admin can open Plans"). */
  readonly title: string;
  /** Who can, and what to do ("Ask an owner or an admin of this organization."). */
  readonly description: string;
}

/** Props for {@link SettingsPage}. */
export interface SettingsPageProps {
  /** The page's name, as the settings navigation names it. */
  readonly title: string;
  /** One sentence on what the page is for. */
  readonly description?: ReactNode;
  /** The page's main act (a "New …" button), at the heading's right; hidden while `unavailable` or `denied`. */
  readonly actions?: ReactNode;
  /** Why this edition does not offer the page and where it is offered; the body is not mounted. */
  readonly unavailable?: ReactNode;
  /**
   * This person may not see the page: the body is not mounted, and the
   * page says who can. `true` says an organization's admins can; pass the
   * words when someone else can (a platform operator).
   */
  readonly denied?: boolean | SettingsPageDenial;
  /** What the page shows when it is offered and allowed. */
  readonly children?: ReactNode;
  readonly className?: string;
}

/**
 * A settings page: its heading and, unless the edition or the person's
 * role rules it out, its body.
 *
 * @example
 * ```tsx
 * <SettingsPage
 *   title="Teams"
 *   description="Groups of people you share agents and other resources with at once."
 *   unavailable={!teamsServed && "Teams come with Stigmer Enterprise and Cloud. On this edition …"}
 * >
 *   <TeamList org={org} />
 * </SettingsPage>
 * ```
 */
export function SettingsPage({ title, description, actions, unavailable, denied = false, children, className }: SettingsPageProps) {
  const headingId = useId();
  const denial: SettingsPageDenial | null =
    denied === true
      ? { title: `Only an admin can open ${title}`, description: "Ask an owner or an admin of this organization." }
      : denied || null;
  const blocked = Boolean(unavailable) || denial !== null;
  return (
    <section aria-labelledby={headingId} className={cn("stg:flex stg:flex-col stg:gap-6", className)}>
      <PageHeader title={title} description={description} actions={blocked ? undefined : actions} headingLevel={2} headingId={headingId} />
      {unavailable ? (
        <CloudFeatureNotice>{unavailable}</CloudFeatureNotice>
      ) : denial !== null ? (
        <EmptyState
          variant="permission"
          title={denial.title}
          description={denial.description}
          className="stg:rounded-lg stg:border stg:border-border"
        />
      ) : (
        children
      )}
    </section>
  );
}
