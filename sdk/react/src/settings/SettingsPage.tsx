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
//
// A detail opened in place (a team, a service account, an app) names the
// page while it is open, as a Library detail page names its thing: the
// page's title is the thing's name, and a quiet way back to the list
// (`back`) sits above it. The detail's parts are `Section` cards under
// that title, so no heading level is skipped.

import { useId, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@stigmer/design-tokens";
import { Button } from "../button/Button.js";
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

/** The way back from a detail open in place to its list. */
export interface SettingsPageBack {
  /** The list's name, as the button says it ("Service accounts"). */
  readonly label: string;
  /** Closes the detail and shows the list. */
  readonly onBack: () => void;
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
  /**
   * A detail is open in place: a quiet button above the title goes back to
   * the list. Pass the detail's name as `title` while it is open.
   */
  readonly back?: SettingsPageBack;
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
 * function TeamsSettings({ teamsServed, children }: { teamsServed: boolean; children: ReactNode }) {
 *   return (
 *     <SettingsPage
 *       title="Teams"
 *       description="Groups of people you share agents and other resources with at once."
 *       unavailable={!teamsServed && "Teams come with Stigmer Enterprise and Cloud."}
 *     >
 *       {children}
 *     </SettingsPage>
 *   );
 * }
 * ```
 */
export function SettingsPage({ title, description, actions, unavailable, denied = false, back, children, className }: SettingsPageProps) {
  const headingId = useId();
  const denial: SettingsPageDenial | null =
    denied === true
      ? { title: `Only an admin can open ${title}`, description: "Ask an owner or an admin of this organization." }
      : denied || null;
  const blocked = Boolean(unavailable) || denial !== null;
  return (
    <section aria-labelledby={headingId} className={cn("stg:flex stg:flex-col stg:gap-6", className)}>
      {/* One tree either way, so the header stays mounted as a detail opens and closes. */}
      <div className="stg:flex stg:flex-col stg:items-start stg:gap-2">
        {back && !blocked && (
          <Button variant="ghost" size="xs" icon={<ArrowLeft className="stg:size-3.5" aria-hidden="true" />} onClick={back.onBack}>
            {back.label}
          </Button>
        )}
        <PageHeader
          title={title}
          description={description}
          actions={blocked ? undefined : actions}
          headingLevel={2}
          headingId={headingId}
          className="stg:self-stretch"
        />
      </div>
      {unavailable ? (
        <CloudFeatureNotice>{unavailable}</CloudFeatureNotice>
      ) : denial !== null ? (
        <EmptyState variant="permission" title={denial.title} description={denial.description} />
      ) : (
        children
      )}
    </section>
  );
}
