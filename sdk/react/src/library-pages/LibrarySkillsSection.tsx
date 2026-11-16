"use client";

// The Library's Skills list: the organization's skills, newest first until a
// search, with Upload skill in the header and in the empty list. A row's
// menu opens the skill, copies its reference, or deletes it after a
// confirmation.

import { useCallback, useMemo } from "react";
import { Copy, ExternalLink, MoreHorizontal, Plus, Sparkles, Trash2 } from "lucide-react";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import { createLibraryListFn, useStigmer } from "@stigmer/react-core";
import { LinkButton } from "../button/LinkButton.js";
import { ActionMenu } from "../action-menu/ActionMenu.js";
import { ResourceWorkbench } from "../resource-workbench/components/ResourceWorkbench.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";
import { useOrgSlugForId } from "../organization/useOrgRefs.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { toast } from "../feedback/toast.js";
import { LIBRARY_HREFS, type LibrarySectionNavigation } from "./navigation.js";
import { LibrarySectionFrame, SEARCH_RESULT_COLUMNS, copyReference, useRefetchToken } from "./LibrarySectionFrame.js";

const VIEW_MODE_STORAGE_KEY = "stigmer:workbench:skills:viewMode";

/** Props for {@link LibrarySkillsSection}. */
export interface LibrarySkillsSectionProps extends LibrarySectionNavigation {
  /** Where Upload skill goes. @default "/library/skills/new" */
  readonly createHref?: string;
}

/**
 * The Library's Skills page: the active organization's skills, with Upload
 * skill.
 *
 * @example
 * ```tsx
 * <LibrarySkillsSection onOpen={({ kind, org, slug }) => window.location.assign(`/library/${kind}/${org}/${slug}`)} />
 * ```
 */
export function LibrarySkillsSection({ onOpen, renderLink, createHref = LIBRARY_HREFS.newSkill }: LibrarySkillsSectionProps) {
  const org = useActiveOrgId();
  const slugForOrg = useOrgSlugForId();
  const stigmer = useStigmer();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const [refetchToken, refreshList] = useRefetchToken();

  const open = useCallback((item: SearchResult) => onOpen({ kind: "skills", org: item.org, slug: item.slug }), [onOpen]);

  const handleDeleteItem = useCallback(
    async (item: SearchResult) => {
      const confirmed = await confirm({
        title: `Delete ${item.name || item.slug}?`,
        description: "This action cannot be undone. The skill and its content will be permanently removed.",
        confirmLabel: "Delete",
        variant: "destructive",
      });
      if (!confirmed) return;
      try {
        await stigmer.skill.delete(item.id);
        toast.success(`${item.name || item.slug} deleted`);
        refreshList();
      } catch {
        toast.error("Failed to delete skill");
      }
    },
    [confirm, stigmer, refreshList],
  );

  // The organization's skills, newest first, while the search box is
  // empty; search matches once it holds text.
  const listFn = useMemo(() => createLibraryListFn(stigmer, ApiResourceKind.skill), [stigmer]);

  const uploadSkill = (
    <LinkButton href={createHref} icon={<Plus className="stg:size-3.5" aria-hidden="true" />} renderLink={renderLink}>
      Upload skill
    </LinkButton>
  );

  return (
    <LibrarySectionFrame title="Skills" description="Browse and manage skills in your organization." actions={uploadSkill}>
      <ResourceWorkbench
        refetchToken={refetchToken}
        listFn={listFn}
        org={org}
        columns={SEARCH_RESULT_COLUMNS}
        defaultViewMode="cards"
        viewModes={["table", "cards"]}
        viewModeStorageKey={VIEW_MODE_STORAGE_KEY}
        searchPlaceholder="Search skills…"
        emptyIcon={<Sparkles className="stg:size-10" aria-hidden="true" />}
        emptyTitle="No skills yet"
        emptyDescription="Upload a skill package to provide reusable instructions and context for your agents."
        emptyAction={uploadSkill}
        onItemClick={open}
        renderItemAction={(item) => (
          <div onClick={(e) => e.stopPropagation()}>
            <ActionMenu>
              <ActionMenu.Trigger aria-label={`Actions for ${item.name || item.slug}`}>
                <MoreHorizontal className="stg:size-4" />
              </ActionMenu.Trigger>
              <ActionMenu.Content>
                <ActionMenu.Item icon={<ExternalLink className="stg:size-4" />} onSelect={() => open(item)}>
                  View details
                </ActionMenu.Item>
                <ActionMenu.Item icon={<Copy className="stg:size-4" />} onSelect={() => copyReference(slugForOrg(item.org), item.slug, "skill")}>
                  Copy ID
                </ActionMenu.Item>
                <ActionMenu.Separator />
                <ActionMenu.Item icon={<Trash2 className="stg:size-4" />} variant="destructive" onSelect={() => void handleDeleteItem(item)}>
                  Delete
                </ActionMenu.Item>
              </ActionMenu.Content>
            </ActionMenu>
          </div>
        )}
        aria-label="Skill workbench"
      />

      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
    </LibrarySectionFrame>
  );
}
