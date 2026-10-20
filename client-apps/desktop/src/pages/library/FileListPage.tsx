import { useMemo, useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Files } from "lucide-react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import {
  FileUploadButton,
  LibraryFilePreview,
  ResourceWorkbench,
  createFileColumns,
  createFileListFn,
  useActiveOrgId,
  useCanCreateFile,
  useOrgSlugForId,
  useStigmer,
} from "@stigmer/react-sdk";

/**
 * The organization's Files kept for reuse, wired identically to the web
 * Library's list: a row opens the File's preview (download, share, delete,
 * add a zip as a skill), and Upload is offered to whoever may upload, not
 * before the server has said so.
 */
export default function FileListPage() {
  const org = useActiveOrgId();
  const slugForOrg = useOrgSlugForId();
  const stigmer = useStigmer();
  const navigate = useNavigate();
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
        headerAction={uploadButton}
        emptyAction={uploadButton}
        onItemClick={setPreview}
        aria-label="File workbench"
      />

      {preview && (
        <LibraryFilePreview
          file={preview}
          onClose={() => setPreview(null)}
          onChanged={refreshList}
          onApplied={(skill) => navigate(`/library/skills/${slugForOrg(skill.org)}/${skill.slug}`)}
        />
      )}
    </>
  );
}
