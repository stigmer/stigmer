"use client";

// What every Library list section shares: the page header (the kind's name,
// what it is for, its acts) above the section's workbench, and the three
// columns a kind listed through search shows (agents, skills, plugins). Each
// section is then its own kind's columns, words and acts, not a copy of this.

import { useCallback, useReducer, type ReactNode } from "react";
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import { PageHeader } from "../../page/PageHeader.js";
import { OrgSlugText } from "../../organization/OrgSlugText.js";
import { toast } from "../../feedback/toast.js";
import type { WorkbenchColumnDef } from "../../resource-workbench/types.js";

/** Props for {@link LibrarySectionFrame}. */
export interface LibrarySectionFrameProps {
  /** The kind's name, the page's heading. */
  readonly title: string;
  /** One line on what the kind is for. */
  readonly description?: ReactNode;
  /** The page's acts, at the right of the title. */
  readonly actions?: ReactNode;
  /** The section's list and its dialogs. */
  readonly children: ReactNode;
}

/** A Library list page: its header, then its list. */
export function LibrarySectionFrame({ title, description, actions, children }: LibrarySectionFrameProps) {
  return (
    <>
      <PageHeader className="stg:mb-6" headingLevel={1} title={title} description={description} actions={actions} />
      {children}
    </>
  );
}

/**
 * A counter a section bumps after an out-of-band change (Apply YAML, a
 * delete, an upload) to read its list again in place: no remount flash,
 * paging and sort kept.
 */
export function useRefetchToken(): readonly [number, () => void] {
  const [token, bump] = useReducer((n: number) => n + 1, 0);
  const refetch = useCallback(() => bump(), []);
  return [token, refetch];
}

/** Copies a row's `<org slug>/<slug>` reference, the one a person types elsewhere, and says so. */
export function copyReference(orgSlug: string, slug: string, noun: string): void {
  void navigator.clipboard.writeText(`${orgSlug}/${slug}`);
  toast.success(`Copied ${noun} ID`);
}

/** The columns of a kind listed through search: its name, its organization (by slug), and its description. */
export const SEARCH_RESULT_COLUMNS: WorkbenchColumnDef<SearchResult>[] = [
  {
    id: "name",
    header: "Name",
    cell: (item) => <span className="stg:font-medium stg:text-foreground">{item.name || item.slug}</span>,
    sortable: true,
    flex: 2,
  },
  {
    id: "org",
    header: "Organization",
    cell: (item) => <OrgSlugText orgId={item.org} className="stg:text-muted-foreground" />,
    flex: 1,
  },
  {
    id: "description",
    header: "Description",
    cell: (item) => <span className="stg:line-clamp-1 stg:text-muted-foreground">{item.description || "—"}</span>,
    flex: 3,
  },
];
