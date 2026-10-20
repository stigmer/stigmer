"use client";

import { useMemo, useReducer, useState } from "react";
import { Files } from "lucide-react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { useLibraryNavigation } from "@/domain/library/library-navigation";
import {
  FileUploadButton,
  LibraryFilePreview,
  ResourceWorkbench,
  createFileColumns,
  createFileListFn,
  useActiveOrgId,
  useCanCreateFile,
  useStigmer,
} from "@stigmer/react-sdk";

/**
 * The organization's Files kept for reuse: those uploaded here, through
 * the CLI or the API, and never given to a conversation. A row opens the
 * File's preview (download, share, delete, add a zip as a skill); a File
 * has no page of its own. Upload is offered to whoever may upload, and not
 * before the server has said so.
 */
export function FileListPage() {
  const org = useActiveOrgId();
  const stigmer = useStigmer();
  const { navigateToDetail } = useLibraryNavigation();
  const { allowed: canCreate } = useCanCreateFile(org || null);
  const [preview, setPreview] = useState<StigmerFile | null>(null);
  // Bumped after an upload, a visibility change or a delete, so the list
  // refetches in place.
  const [refetchToken, refreshList] = useReducer((n: number) => n + 1, 0);

  const listFn = useMemo(() => createFileListFn(stigmer), [stigmer]);
  const columns = useMemo(() => createFileColumns(), []);

  const uploadButton =
    canCreate && org ? <FileUploadButton org={org} onUploaded={refreshList} /> : undefined;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-foreground text-xl font-semibold">Files</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Files you keep to reuse: name one in a routine and every run gets its own copy. A
          conversation&rsquo;s files stay with that conversation.
        </p>
      </div>

      {/* Files are not in search: listed through the direct query, hence
          searchable={false}. */}
      <ResourceWorkbench<StigmerFile>
        refetchToken={refetchToken}
        listFn={listFn}
        org={org}
        columns={columns}
        getItemId={(item) => item.metadata?.id ?? ""}
        searchable={false}
        defaultViewMode="table"
        viewModes={["table"]}
        emptyIcon={<Files className="size-10" aria-hidden="true" />}
        emptyTitle="No files yet"
        emptyDescription="Upload a file to keep it here and hand it to your routines."
        // One Upload, in the header, which the empty list shows too: a second
        // copy in the empty state would unmount with its uploads' status
        // once the first one fills the list.
        headerAction={uploadButton}
        onItemClick={setPreview}
        aria-label="File workbench"
      />

      {preview && (
        <LibraryFilePreview
          file={preview}
          onClose={() => setPreview(null)}
          onChanged={refreshList}
          onApplied={(skill) => navigateToDetail("skills", skill.org, skill.slug)}
        />
      )}
    </>
  );
}
