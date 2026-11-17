"use client";

// The Library's Skills list: the organization's skills as rows, newest first
// until a search, with Apply YAML and, for someone the server lets upload
// one (an admin, `can_create_skill`), Upload skill. A row opens the skill;
// its acts copy its reference and, only on the server's yes for that skill,
// delete it after a confirmation.

import { useCallback, useMemo, useState } from "react";
import { Plus, Sparkles, Upload } from "lucide-react";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import { createLibraryListFn, useStigmer } from "@stigmer/react-core";
import { IconButton } from "../button/IconButton.js";
import { LinkButton } from "../button/LinkButton.js";
import { ApplyManifestDialog } from "../manifest/ApplyManifestDialog.js";
import { ResourceWorkbench } from "../resource-workbench/components/ResourceWorkbench.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";
import { useOrgSlugForId } from "../organization/useOrgRefs.js";
import { useCanCreateSkill } from "../skill/useCanCreateSkill.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { toast } from "../feedback/toast.js";
import { LIBRARY_HREFS, type LibrarySectionNavigation } from "./navigation.js";
import {
  LibraryRow,
  LibraryRowActions,
  LibrarySectionFrame,
  SEARCH_RESULT_COLUMNS,
  copyReference,
  useRefetchToken,
  visibilityTag,
} from "./LibrarySectionFrame.js";

/** Props for {@link LibrarySkillsSection}. */
export interface LibrarySkillsSectionProps extends LibrarySectionNavigation {
  /** Where Upload skill goes. @default "/library/skills/new" */
  readonly createHref?: string;
}

/**
 * The Library's Skills page: the active organization's skills as rows, with
 * Apply YAML and, for an admin, Upload skill.
 *
 * @example
 * ```tsx
 * <LibrarySkillsSection onOpen={({ kind, org, slug }) => window.location.assign(`/library/${kind}/${org}/${slug}`)} />
 * ```
 */
export function LibrarySkillsSection({ onOpen, renderLink, createHref = LIBRARY_HREFS.newSkill }: LibrarySkillsSectionProps) {
  const org = useActiveOrgId();
  const { allowed: canUpload, isLoading: checkingUpload } = useCanCreateSkill(org || null);
  const slugForOrg = useOrgSlugForId();
  const stigmer = useStigmer();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const [importOpen, setImportOpen] = useState(false);
  const [refetchToken, refreshList] = useRefetchToken();

  const open = useCallback((item: SearchResult) => onOpen({ kind: "skills", org: item.org, slug: item.slug }), [onOpen]);

  const handleDeleteItem = useCallback(
    async (item: SearchResult) => {
      const name = item.name || item.slug;
      // The dialog deletes: it waits while the server answers and says a refusal in place.
      const deleted = await confirm({
        title: `Delete ${name}?`,
        description: "This action cannot be undone. The skill and its content will be permanently removed.",
        confirmLabel: "Delete",
        variant: "destructive",
        action: async () => {
          await stigmer.skill.delete(item.id);
        },
        failureTitle: `Couldn't delete ${name}.`,
      });
      if (!deleted) return;
      toast.success(`${name} deleted`);
      refreshList();
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
    <LibrarySectionFrame
      title="Skills"
      description="Know-how an agent loads when a task needs it: instructions, examples and scripts, packaged once for every agent in the organization."
      actions={
        <>
          <IconButton
            variant="outline"
            label="Apply YAML"
            icon={<Upload className="stg:size-3.5" aria-hidden="true" />}
            onClick={() => setImportOpen(true)}
          />
          {canUpload && uploadSkill}
        </>
      }
    >
      <ResourceWorkbench
        refetchToken={refetchToken}
        listFn={listFn}
        org={org}
        columns={SEARCH_RESULT_COLUMNS}
        defaultViewMode="list"
        viewModes={["list"]}
        itemsLabel="skills"
        searchPlaceholder="Search skills"
        emptyIcon={<Sparkles className="stg:size-10" aria-hidden="true" />}
        emptyTitle="No skills yet"
        emptyDescription={
          // The member's words only once the server has said no.
          canUpload || checkingUpload
            ? "Upload a skill package to give your agents reusable instructions and context."
            : `Admins of ${slugForOrg(org ?? "")} upload skills. Once one does, every agent here can use it.`
        }
        emptyAction={canUpload ? uploadSkill : undefined}
        onItemClick={open}
        renderRow={(item) => (
          <LibraryRow
            icon={<Sparkles />}
            name={item.name || item.slug}
            tags={visibilityTag(item.visibility)}
            description={item.description}
            changedAt={item.updatedAt}
          />
        )}
        renderItemAction={(item) => (
          <LibraryRowActions
            resource={{ kind: "skill", id: item.id }}
            name={item.name || item.slug}
            onCopyId={() => copyReference(slugForOrg(item.org), item.slug, "skill")}
            onDelete={() => void handleDeleteItem(item)}
          />
        )}
        aria-label="Skill workbench"
      />

      <ApplyManifestDialog open={importOpen} onOpenChange={setImportOpen} org={org ?? ""} onApplied={refreshList} />

      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
    </LibrarySectionFrame>
  );
}
