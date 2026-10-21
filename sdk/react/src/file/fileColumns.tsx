"use client";

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { VisibilityBadge } from "../library/VisibilitySelector.js";
import type { WorkbenchColumnDef } from "../resource-workbench/types.js";
import { formatRelativeTime } from "../activity/format-relative-time.js";
import { FileTypeIcon } from "../internal/file-icons/index.js";
import { formatFileSize } from "./file-size.js";

/** A File's media type in a list's few words: "image/png", or "—" when it has none. */
export function describeFileType(file: StigmerFile): string {
  return file.spec?.mimeType || "—";
}

/** When a File was uploaded, in a list's few words: "3h", "Jul 12". */
export function describeUploaded(file: StigmerFile): string {
  const created = file.status?.audit?.specAudit?.createdAt;
  return created ? formatRelativeTime(timestampDate(created)) : "—";
}

/**
 * Column set for the Library's Files workbench, shared by every console so
 * the list renders identically everywhere: the File's name, its type, its
 * size, who can see it, and when it was uploaded. Each row is a full
 * `File` from the direct query (`createFileListFn`).
 *
 * Columns are not sortable: the direct query has one fixed server-side
 * order (newest first), and a sort affordance that did nothing would lie.
 */
export function createFileColumns(): WorkbenchColumnDef<StigmerFile>[] {
  return [
    {
      id: "name",
      header: "Name",
      cell: (item) => (
        <span className="stg:inline-flex stg:min-w-0 stg:items-center stg:gap-2">
          <span className="stg:shrink-0 stg:text-muted-foreground">
            <FileTypeIcon fileName={item.spec?.filename ?? ""} />
          </span>
          <span className="stg:truncate stg:font-medium stg:text-foreground">{item.spec?.filename}</span>
        </span>
      ),
      flex: 2.5,
    },
    {
      id: "type",
      header: "Type",
      cell: (item) => <span className="stg:truncate stg:text-muted-foreground">{describeFileType(item)}</span>,
      flex: 1.5,
    },
    {
      id: "size",
      header: "Size",
      cell: (item) => (
        <span className="stg:tabular-nums stg:text-muted-foreground">
          {formatFileSize(item.status?.sizeBytes ?? BigInt(0))}
        </span>
      ),
      flex: 0.8,
    },
    {
      id: "visibility",
      header: "Visibility",
      cell: (item) => (item.metadata ? <VisibilityBadge visibility={item.metadata.visibility} /> : null),
      flex: 1,
    },
    {
      id: "uploaded",
      header: "Uploaded",
      cell: (item) => <span className="stg:text-muted-foreground">{describeUploaded(item)}</span>,
      flex: 0.8,
    },
  ];
}
