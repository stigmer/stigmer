"use client";

// The Library's Files list: the organization's Files kept for reuse, those
// uploaded here, through the CLI or the API, and never given to a
// conversation. A row opens the File's preview (download, share, delete, add
// a zip as a skill); a File has no page of its own. Upload is offered to
// whoever may upload, and not before the server has said so. Files are not
// in search: listed through the direct query, so the list has no search box.

import { useMemo, useState } from "react";
import { Files } from "lucide-react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { ResourceWorkbench } from "../resource-workbench/components/ResourceWorkbench.js";
import { FileUploadButton } from "../file/FileUploadButton.js";
import { LibraryFilePreview } from "../file/LibraryFilePreview.js";
import { createFileColumns } from "../file/fileColumns.js";
import { createFileListFn } from "../file/fileListFn.js";
import { useCanCreateFile } from "../file/useCanCreateFile.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";
import type { LibrarySectionNavigation } from "./navigation.js";
import { LibrarySectionFrame, useRefetchToken } from "./LibrarySectionFrame.js";

/** Props for {@link LibraryFilesSection}. */
export type LibraryFilesSectionProps = LibrarySectionNavigation;

/**
 * The Library's Files page: the active organization's kept Files, with
 * Upload for whoever may upload. A skill added from a zip opens through
 * `onOpen`.
 *
 * @example
 * ```tsx
 * <LibraryFilesSection onOpen={({ kind, org, slug }) => window.location.assign(`/library/${kind}/${org}/${slug}`)} />
 * ```
 */
export function LibraryFilesSection({ onOpen }: LibraryFilesSectionProps) {
  const org = useActiveOrgId();
  const stigmer = useStigmer();
  const { allowed: canCreate } = useCanCreateFile(org || null);
  const [preview, setPreview] = useState<StigmerFile | null>(null);
  // Bumped after an upload, a visibility change or a delete, so the list
  // refetches in place.
  const [refetchToken, refreshList] = useRefetchToken();

  const listFn = useMemo(() => createFileListFn(stigmer), [stigmer]);
  const columns = useMemo(() => createFileColumns(), []);

  return (
    <LibrarySectionFrame
      title="Files"
      description={
        <>
          Files you keep to reuse: name one in a routine and every run gets its own copy. A conversation&rsquo;s files stay
          with that conversation.
        </>
      }
      // One Upload, in the page's header, which the empty list shows too: a
      // second copy in the empty state would unmount with its uploads'
      // status once the first one fills the list.
      actions={canCreate && org ? <FileUploadButton org={org} onUploaded={refreshList} /> : undefined}
    >
      <ResourceWorkbench<StigmerFile>
        refetchToken={refetchToken}
        listFn={listFn}
        org={org}
        columns={columns}
        getItemId={(item) => item.metadata?.id ?? ""}
        searchable={false}
        defaultViewMode="table"
        viewModes={["table"]}
        emptyIcon={<Files className="stg:size-10" aria-hidden="true" />}
        emptyTitle="No files yet"
        emptyDescription="Upload a file to keep it here and hand it to your routines."
        onItemClick={setPreview}
        aria-label="File workbench"
      />

      {preview && (
        <LibraryFilePreview
          file={preview}
          onClose={() => setPreview(null)}
          onChanged={refreshList}
          onApplied={(skill) => onOpen({ kind: "skills", org: skill.org, slug: skill.slug })}
        />
      )}
    </LibrarySectionFrame>
  );
}
