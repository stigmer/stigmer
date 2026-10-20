"use client";

/**
 * The Library's view of one File: the shared preview (text, image,
 * download, "Add as skill" for a zip) with the acts a kept File has beyond a
 * conversation's: who may see it (Manage access, whose general-access
 * section is the File's visibility) and Delete. Both consoles render this
 * one component from their Files page, so the page itself is a list.
 *
 * Trade-offs:
 * - A File has no detail page: it is immutable and has five facts, so a
 *   row opens this preview rather than a route.
 * - Every change reports through `onChanged` (a visibility change, a
 *   delete), so the host re-reads its list and the row's badge follows.
 * - The preview reads the File itself and re-reads it after a visibility
 *   change, so the level it shows is the stored one, not the one of the
 *   row it was opened from.
 */

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { FilePreviewModal } from "../run/FilePreviewModal.js";
import { useFile } from "./useFile.js";
import { ManageAccessButton } from "../access/ManageAccessButton.js";
import type { ApplyResourceResult } from "../library/useApplyResource.js";

/** Props for {@link LibraryFilePreview}. */
export interface LibraryFilePreviewProps {
  /** The File to show. */
  readonly file: StigmerFile;
  /** Called when the preview should close. */
  readonly onClose: () => void;
  /** Called after the File's visibility changes or it is deleted: re-read the list. */
  readonly onChanged: () => void;
  /** Called after a zip File is added as a skill: the host's link to it. */
  readonly onApplied?: (result: ApplyResourceResult) => void;
}

/** One Library File in the preview modal, with Manage access and Delete. */
export function LibraryFilePreview({ file: opened, onClose, onChanged, onApplied }: LibraryFilePreviewProps) {
  const id = opened.metadata?.id ?? "";
  const { file: stored, refetch } = useFile(id || null);
  const file = stored ?? opened;
  const org = file.metadata?.org ?? "";
  return (
    <FilePreviewModal
      file={file}
      org={org}
      isTerminal
      open
      onClose={onClose}
      onApplied={onApplied}
      onDeleted={() => {
        onChanged();
        onClose();
      }}
      accessSlot={
        id && org ? (
          <ManageAccessButton
            resource={{ kind: ApiResourceKind.file, kindString: "file", id, org, name: file.spec?.filename }}
            visibility={{
              kind: "file",
              current: file.metadata?.visibility ?? ApiResourceVisibility.visibility_private,
              org,
              onChanged: () => {
                refetch();
                onChanged();
              },
            }}
            className="stg:text-xs"
          />
        ) : undefined
      }
    />
  );
}
